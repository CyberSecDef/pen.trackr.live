import { randomBytes } from 'node:crypto'

/**
 * UUIDv7 (RFC 9562 section 5.7): a 48-bit big-endian Unix millisecond timestamp
 * followed by random bits, so identifiers sort in creation order.
 *
 * @req FR-SECPL-001
 *
 * Hand-written rather than taken as a dependency. It is forty lines, it lives in
 * the module that identifies evidence, and a generator is exactly the kind of
 * component where "it looked fine" is not good enough — the clock source and
 * the counter both need to be injectable to be tested at all.
 *
 * Time ordering matters here beyond tidiness. The chain establishes order
 * cryptographically, but a ledger whose identifiers also sort by creation time
 * makes "what happened next" answerable without walking the chain.
 */

/** Layout: 48 bits of milliseconds, 4 version, 12 counter, 2 variant, 62 random. */
const COUNTER_BITS = 12
const COUNTER_MAX = (1 << COUNTER_BITS) - 1

export interface UuidV7Options {
  /** Injectable clock, in Unix milliseconds. Defaults to Date.now. */
  readonly now?: () => number
  /** Injectable entropy source, for deterministic tests. */
  readonly random?: (size: number) => Uint8Array
}

export class UuidV7Generator {
  private readonly now: () => number
  private readonly random: (size: number) => Uint8Array
  private lastMillis = -1
  private counter = 0

  constructor(options: UuidV7Options = {}) {
    this.now = options.now ?? Date.now
    this.random = options.random ?? ((size) => new Uint8Array(randomBytes(size)))
  }

  /**
   * Generates the next identifier.
   *
   * Within a single millisecond the 12-bit counter increments, so identifiers
   * created in a burst still sort in creation order rather than randomly. If the
   * counter saturates, generation waits for the next millisecond instead of
   * wrapping — wrapping would silently produce out-of-order identifiers, and a
   * ledger that reorders its own events under load is worse than a slow one.
   */
  next(): string {
    // Clamp before comparing. A clock that steps backwards is then handled by
    // exactly the same path as a repeated millisecond — the counter increments.
    // Reseeding instead would draw a fresh random counter that may be lower than
    // the one already issued for this millisecond, producing an identifier that
    // sorts before its predecessor, or with a fixed entropy source an outright
    // duplicate. NTP correction during an engagement makes this reachable, not
    // theoretical.
    let millis = Math.max(this.now(), this.lastMillis)

    if (millis === this.lastMillis) {
      if (this.counter >= COUNTER_MAX) {
        do {
          millis = Math.max(this.now(), this.lastMillis)
        } while (millis === this.lastMillis)
        this.counter = this.seedCounter()
      } else {
        this.counter += 1
      }
    } else {
      this.counter = this.seedCounter()
    }

    this.lastMillis = millis
    return format(millis, this.counter, this.random(8))
  }

  /** Starts each millisecond partway up the counter space, leaving room to increment. */
  private seedCounter(): number {
    const [high, low] = this.random(2)
    return (((high ?? 0) << 8) | (low ?? 0)) & (COUNTER_MAX >> 1)
  }
}

function format(millis: number, counter: number, entropy: Uint8Array): string {
  const bytes = new Uint8Array(16)

  // 48-bit big-endian timestamp.
  const time = BigInt(millis)
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((time >> BigInt(8 * (5 - i))) & 0xffn)
  }

  // Version 7 in the high nibble of byte 6, then the 12-bit counter.
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f)
  bytes[7] = counter & 0xff

  // Variant 0b10 in the top bits of byte 8, then 62 bits of entropy.
  bytes[8] = 0x80 | ((entropy[0] ?? 0) & 0x3f)
  for (let i = 9; i < 16; i += 1) {
    bytes[i] = entropy[i - 8] ?? 0
  }

  const hex = Buffer.from(bytes).toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function isUuidV7(value: string): boolean {
  return UUID_PATTERN.test(value)
}

/** Recovers the embedded creation time, which makes identifiers self-describing. */
export function timestampOf(uuid: string): number {
  if (!isUuidV7(uuid)) throw new TypeError(`not a UUIDv7: ${uuid}`)
  return Number(BigInt(`0x${uuid.slice(0, 8)}${uuid.slice(9, 13)}`))
}

const shared = new UuidV7Generator()

/** Generates a UUIDv7 from the shared generator. */
export function uuidV7(): string {
  return shared.next()
}
