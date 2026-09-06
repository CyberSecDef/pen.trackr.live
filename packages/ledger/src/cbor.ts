/**
 * Deterministic CBOR encoder (RFC 8949 section 4.2.1 core deterministic
 * encoding), restricted to the value set an evidence envelope needs.
 *
 * @req FR-SECPL-002
 * @req NFR-009
 *
 * This is hand-written rather than delegated to a library, deliberately. The
 * encoder defines the hash preimage for every ledger event, so its output is
 * the thing a dispute would turn on. `cbor-x` was evaluated first and is not
 * canonical: it preserves map insertion order instead of sorting keys, emits
 * non-shortest map headers, and encodes floats at full width. Any of those
 * would make two encodings of the same event differ, which defeats NFR-009's
 * deterministic export.
 *
 * Deliberate restrictions, each of which removes a determinism hazard rather
 * than merely simplifying the code:
 *
 * - **Floating point is rejected.** IEEE-754 shortest-form encoding is the
 *   subtlest part of canonical CBOR, and floats have no business in an evidence
 *   envelope. Payloads needing decimals use strings or integer-scaled values.
 * - **`undefined` is rejected.** CBOR can encode it, but FR-CMD-002 requires
 *   fields that cannot be filled to be explicit nulls rather than silent
 *   omissions. Refusing `undefined` enforces that at the encoder.
 * - **Unsafe integers are rejected.** A number above 2^53 would silently lose
 *   precision; callers must pass a bigint and say what they mean.
 * - **Ill-formed text is rejected.** Unpaired surrogates are replaced by U+FFFD
 *   during UTF-8 encoding, so distinct strings would encode to identical bytes.
 *   Refusing them keeps string encoding injective, which is what makes the
 *   preimage unambiguous.
 */

export class CborEncodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CborEncodeError'
  }
}

export type CborValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Uint8Array
  | readonly CborValue[]
  | ReadonlyMap<string, CborValue>
  | { readonly [key: string]: CborValue }

const MAJOR_UNSIGNED = 0
const MAJOR_NEGATIVE = 1
const MAJOR_BYTES = 2
const MAJOR_TEXT = 3
const MAJOR_ARRAY = 4
const MAJOR_MAP = 5
const MAJOR_SIMPLE = 7

const SIMPLE_FALSE = 0xf4
const SIMPLE_TRUE = 0xf5
const SIMPLE_NULL = 0xf6

/** Largest value representable by a CBOR head argument: 2^64 - 1. */
const MAX_ARGUMENT = 0xffff_ffff_ffff_ffffn

class ByteWriter {
  private readonly chunks: Uint8Array[] = []
  private size = 0

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes)
    this.size += bytes.length
  }

  byte(value: number): void {
    this.push(Uint8Array.of(value))
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.size)
    let offset = 0
    for (const chunk of this.chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }
}

/**
 * Writes a major type and its argument using the shortest form that fits, which
 * is what "preferred serialization" means in RFC 8949.
 */
function writeHead(writer: ByteWriter, major: number, argument: bigint): void {
  if (argument < 0n || argument > MAX_ARGUMENT) {
    throw new CborEncodeError(`argument out of range for CBOR head: ${argument}`)
  }

  const prefix = major << 5

  if (argument < 24n) {
    writer.byte(prefix | Number(argument))
    return
  }

  let width: 1 | 2 | 4 | 8
  let additional: number
  if (argument <= 0xffn) {
    width = 1
    additional = 24
  } else if (argument <= 0xffffn) {
    width = 2
    additional = 25
  } else if (argument <= 0xffff_ffffn) {
    width = 4
    additional = 26
  } else {
    width = 8
    additional = 27
  }

  writer.byte(prefix | additional)
  const bytes = new Uint8Array(width)
  let remaining = argument
  for (let i = width - 1; i >= 0; i -= 1) {
    bytes[i] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  writer.push(bytes)
}

function writeInteger(writer: ByteWriter, value: bigint): void {
  if (value >= 0n) {
    writeHead(writer, MAJOR_UNSIGNED, value)
    return
  }
  // Negative integers encode -1 - n, so -1 becomes argument 0.
  writeHead(writer, MAJOR_NEGATIVE, -1n - value)
}

function toBigInt(value: number): bigint {
  if (!Number.isFinite(value)) {
    throw new CborEncodeError(`refusing to encode non-finite number: ${value}`)
  }
  if (!Number.isInteger(value)) {
    throw new CborEncodeError(
      `refusing to encode non-integer number: ${value}. Floating point is not deterministic enough for a hash preimage; use a string or an integer-scaled value.`,
    )
  }
  if (!Number.isSafeInteger(value)) {
    throw new CborEncodeError(
      `refusing to encode unsafe integer: ${value}. Pass a bigint to be explicit about precision.`,
    )
  }
  // Normalizes -0, which would otherwise be indistinguishable from 0 only by luck.
  return BigInt(value === 0 ? 0 : value)
}

/** Bytewise lexicographic comparison, the ordering canonical CBOR requires for map keys. */
export function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const shared = Math.min(left.length, right.length)
  for (let i = 0; i < shared; i += 1) {
    const a = left[i] ?? 0
    const b = right[i] ?? 0
    if (a !== b) return a < b ? -1 : 1
  }
  return left.length - right.length
}

function entriesOf(value: ReadonlyMap<string, CborValue> | { readonly [key: string]: CborValue }) {
  return value instanceof Map ? [...value.entries()] : Object.entries(value)
}

function writeMap(
  writer: ByteWriter,
  value: ReadonlyMap<string, CborValue> | { readonly [key: string]: CborValue },
): void {
  const encoded = entriesOf(value).map(([key, item]) => {
    if (typeof key !== 'string') {
      throw new CborEncodeError(`map keys must be strings, got ${typeof key}`)
    }
    return { key: encode(key), value: item }
  })

  encoded.sort((a, b) => compareBytes(a.key, b.key))

  // Invariant assertion, unreachable by construction: Map and object keys are
  // already unique, and rejecting ill-formed text above makes string encoding
  // injective, so two distinct keys cannot produce the same bytes. It stays as
  // a tripwire in case either of those properties is ever relaxed.
  /* v8 ignore start */
  for (let i = 1; i < encoded.length; i += 1) {
    const previous = encoded[i - 1]
    const current = encoded[i]
    if (
      previous !== undefined &&
      current !== undefined &&
      compareBytes(previous.key, current.key) === 0
    ) {
      throw new CborEncodeError('duplicate map key in canonical encoding')
    }
  }
  /* v8 ignore stop */

  writeHead(writer, MAJOR_MAP, BigInt(encoded.length))
  for (const entry of encoded) {
    writer.push(entry.key)
    writeValue(writer, entry.value)
  }
}

function writeValue(writer: ByteWriter, value: CborValue): void {
  if (value === null) {
    writer.byte(SIMPLE_NULL)
    return
  }

  if (value === undefined) {
    throw new CborEncodeError(
      'refusing to encode undefined: absent fields must be explicit nulls (FR-CMD-002)',
    )
  }

  switch (typeof value) {
    case 'boolean':
      writer.byte(value ? SIMPLE_TRUE : SIMPLE_FALSE)
      return
    case 'number':
      writeInteger(writer, toBigInt(value))
      return
    case 'bigint':
      writeInteger(writer, value)
      return
    case 'string': {
      // TextEncoder replaces unpaired surrogates with U+FFFD, so '\uD800' and
      // '\uD801' — distinct JS strings — would encode to identical bytes. In a
      // hash preimage that is an encoding collision an attacker can construct
      // for free, so ill-formed text is refused rather than silently mangled.
      if (!value.isWellFormed()) {
        throw new CborEncodeError(
          'refusing to encode a string containing unpaired surrogates: it would not encode injectively. Use a byte string for raw data.',
        )
      }
      const bytes = new TextEncoder().encode(value)
      writeHead(writer, MAJOR_TEXT, BigInt(bytes.length))
      writer.push(bytes)
      return
    }
    default:
      break
  }

  if (value instanceof Uint8Array) {
    writeHead(writer, MAJOR_BYTES, BigInt(value.length))
    writer.push(value)
    return
  }

  if (Array.isArray(value)) {
    writeHead(writer, MAJOR_ARRAY, BigInt(value.length))
    for (const item of value as readonly CborValue[]) writeValue(writer, item)
    return
  }

  if (value instanceof Map || typeof value === 'object') {
    writeMap(writer, value as ReadonlyMap<string, CborValue>)
    return
  }

  throw new CborEncodeError(`unsupported value type: ${typeof value}`)
}

/** Encodes a value as deterministic CBOR. The same value always yields the same bytes. */
export function encode(value: CborValue): Uint8Array {
  const writer = new ByteWriter()
  writeValue(writer, value)
  return writer.toBytes()
}

/** Convenience for tests and diagnostics. */
export function encodeHex(value: CborValue): string {
  return Buffer.from(encode(value)).toString('hex')
}

export const MAJOR_TYPES = {
  MAJOR_UNSIGNED,
  MAJOR_NEGATIVE,
  MAJOR_BYTES,
  MAJOR_TEXT,
  MAJOR_ARRAY,
  MAJOR_MAP,
  MAJOR_SIMPLE,
} as const
