import { type CborValue, compareBytes } from './cbor.js'

/**
 * Strict canonical CBOR decoder.
 *
 * @req FR-SECPL-002
 * @req NFR-009
 *
 * The counterpart to the encoder, needed because verifying a stored event means
 * reconstructing it and recomputing its hash — which catches storage-layer
 * corruption that hashing a stored blob directly would not.
 *
 * It is strict on purpose. Anything the encoder would never emit is rejected
 * rather than accepted leniently:
 *
 * - non-shortest head arguments (0x1817 for 23)
 * - indefinite-length items
 * - unsorted or duplicated map keys
 * - floats, tags, undefined, and other simple values
 * - trailing bytes after a complete item
 * - text that is not well-formed UTF-8
 *
 * Postel's law is wrong here. A lenient decoder would accept a hand-edited blob
 * that no encoder produced, which is exactly the input a tamper check should
 * refuse. Strictness makes the storage layer a second, independent detector of
 * modification rather than a channel that quietly normalizes it away.
 */

export class CborDecodeError extends Error {
  readonly offset: number

  constructor(message: string, offset: number) {
    super(`${message} (at byte ${offset})`)
    this.name = 'CborDecodeError'
    this.offset = offset
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

class ByteReader {
  offset = 0
  private readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  get exhausted(): boolean {
    return this.offset >= this.bytes.length
  }

  byte(): number {
    if (this.exhausted) throw new CborDecodeError('unexpected end of input', this.offset)
    const value = this.bytes[this.offset] ?? 0
    this.offset += 1
    return value
  }

  slice(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) {
      throw new CborDecodeError(`truncated item: needed ${length} bytes`, this.offset)
    }
    const out = this.bytes.slice(this.offset, this.offset + length)
    this.offset += length
    return out
  }
}

interface Head {
  readonly major: number
  /** The low five bits of the initial byte. For major type 7 this *is* the value. */
  readonly additional: number
  readonly argument: bigint
}

function readHead(reader: ByteReader): Head {
  const start = reader.offset
  const initial = reader.byte()
  const major = initial >> 5
  const additional = initial & 0x1f

  if (additional < 24) return { major, additional, argument: BigInt(additional) }

  if (additional === 31) {
    throw new CborDecodeError('indefinite-length items are not canonical', start)
  }
  if (additional > 27) {
    throw new CborDecodeError(`reserved additional information ${additional}`, start)
  }

  const width = 1 << (additional - 24)
  let argument = 0n
  for (const byte of reader.slice(width)) {
    argument = (argument << 8n) | BigInt(byte)
  }

  // Preferred serialization: the argument must not fit in a shorter form. This
  // applies to lengths and integers only. For major type 7 the trailing bytes
  // are a float payload rather than an argument, so the rule does not apply —
  // and floats are rejected outright a moment later regardless.
  if (major !== 7) {
    const minimum = width === 1 ? 24n : 1n << BigInt(8 * (width >> 1))
    if (argument < minimum) {
      throw new CborDecodeError(
        `non-canonical head: ${argument} should use a shorter encoding`,
        start,
      )
    }
  }

  return { major, additional, argument }
}

/** Integers land as number when exactly representable, else bigint. */
function toInteger(value: bigint): number | bigint {
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value
}

function readValue(reader: ByteReader): CborValue {
  const start = reader.offset
  const { major, additional, argument } = readHead(reader)

  switch (major) {
    case 0:
      return toInteger(argument)
    case 1:
      return toInteger(-1n - argument)
    case 2:
      return reader.slice(Number(argument))
    case 3: {
      const bytes = reader.slice(Number(argument))
      try {
        return utf8.decode(bytes)
      } catch {
        throw new CborDecodeError('text string is not well-formed UTF-8', start)
      }
    }
    case 4: {
      const items: CborValue[] = []
      for (let i = 0n; i < argument; i += 1n) items.push(readValue(reader))
      return items
    }
    case 5:
      return readMap(reader, argument)
    case 7:
      return readSimple(additional, start)
    default:
      throw new CborDecodeError(`unsupported major type ${major}`, start)
  }
}

function readMap(reader: ByteReader, size: bigint): CborValue {
  const result: Record<string, CborValue> = {}
  let previousKey: Uint8Array | null = null

  for (let i = 0n; i < size; i += 1n) {
    const keyStart = reader.offset
    const keyHead = readHead(reader)
    if (keyHead.major !== 3) {
      throw new CborDecodeError('map keys must be text strings', keyStart)
    }
    const keyBytes = reader.slice(Number(keyHead.argument))
    let key: string
    try {
      key = utf8.decode(keyBytes)
    } catch {
      throw new CborDecodeError('map key is not well-formed UTF-8', keyStart)
    }

    // Canonical order is bytewise over the full encoded key. For text strings
    // the head sorts by length before content, so comparing (length, bytes) is
    // equivalent and avoids re-encoding each key to compare it.
    if (previousKey !== null) {
      const order =
        previousKey.length !== keyBytes.length
          ? previousKey.length - keyBytes.length
          : compareBytes(previousKey, keyBytes)
      if (order === 0) throw new CborDecodeError('duplicate map key', keyStart)
      if (order > 0) throw new CborDecodeError('map keys are not in canonical order', keyStart)
    }
    previousKey = keyBytes

    result[key] = readValue(reader)
  }

  return result
}

/**
 * Major type 7 is decided by the additional-information bits, not by the bytes
 * that follow them: 25, 26, and 27 mean half, single, and double float, whose
 * trailing bytes are the float payload. Reading those bytes as an argument and
 * switching on the result is a bug that silently disables float rejection,
 * which is how this was written the first time and how a test caught it.
 */
function readSimple(additional: number, start: number): CborValue {
  switch (additional) {
    case 20:
      return false
    case 21:
      return true
    case 22:
      return null
    case 23:
      throw new CborDecodeError('undefined is not encodable: expected an explicit null', start)
    case 25:
    case 26:
    case 27:
      throw new CborDecodeError('floating point is not permitted in a hash preimage', start)
    default:
      throw new CborDecodeError(`unsupported simple value ${additional}`, start)
  }
}

/** Decodes canonical CBOR. Rejects anything the encoder would not produce. */
export function decode(bytes: Uint8Array): CborValue {
  const reader = new ByteReader(bytes)
  const value = readValue(reader)
  if (!reader.exhausted) {
    throw new CborDecodeError('trailing bytes after complete item', reader.offset)
  }
  return value
}

export function decodeHex(hex: string): CborValue {
  return decode(Uint8Array.from(Buffer.from(hex, 'hex')))
}
