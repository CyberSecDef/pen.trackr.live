import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isUuidV7, timestampOf, UuidV7Generator, uuidV7 } from '../src/uuid.js'

/** @req FR-SECPL-001 */

/** Deterministic entropy so layout assertions are exact rather than probabilistic. */
const fixedRandom = (fill: number) => (size: number) => new Uint8Array(size).fill(fill)

describe('UuidV7Generator layout', () => {
  it('encodes the timestamp in the leading 48 bits, big-endian', () => {
    const generator = new UuidV7Generator({ now: () => 0x0123456789ab, random: fixedRandom(0) })
    expect(generator.next().startsWith('01234567-89ab-')).toBe(true)
  })

  it('sets version 7', () => {
    const generator = new UuidV7Generator({ now: () => 1, random: fixedRandom(0xff) })
    expect(generator.next()[14]).toBe('7')
  })

  it('sets the RFC 9562 variant bits', () => {
    const generator = new UuidV7Generator({ now: () => 1, random: fixedRandom(0xff) })
    expect(['8', '9', 'a', 'b']).toContain(generator.next()[19])
  })

  it('produces a well-formed UUIDv7 for arbitrary clock values', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 44 }), (millis) => {
        const generator = new UuidV7Generator({ now: () => millis, random: fixedRandom(0x5a) })
        expect(isUuidV7(generator.next())).toBe(true)
      }),
    )
  })
})

describe('ordering', () => {
  it('increments the counter within a single millisecond so a burst stays ordered', () => {
    const generator = new UuidV7Generator({ now: () => 1000, random: fixedRandom(0) })
    const ids = Array.from({ length: 50 }, () => generator.next())
    expect([...ids].sort()).toEqual(ids)
  })

  it('keeps identifiers ordered across advancing milliseconds', () => {
    let millis = 1000
    const generator = new UuidV7Generator({ now: () => millis, random: fixedRandom(0) })
    const ids: string[] = []
    for (let i = 0; i < 20; i += 1) {
      ids.push(generator.next())
      millis += 1
    }
    expect([...ids].sort()).toEqual(ids)
  })

  it('waits for the next millisecond rather than wrapping a saturated counter', () => {
    // Wrapping would emit an identifier that sorts before its predecessor, so a
    // ledger under burst load would silently reorder its own events.
    let calls = 0
    const generator = new UuidV7Generator({
      // Holds still long enough to saturate the counter, then advances.
      now: () => {
        calls += 1
        return calls <= 2100 ? 5 : 5 + (calls - 2100)
      },
      random: () => new Uint8Array(8).fill(0xff),
    })
    const ids = Array.from({ length: 4200 }, () => generator.next())
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never goes backwards or repeats when the clock steps backwards', () => {
    // Reachable in practice: NTP correcting a drifted attack host mid-engagement.
    // Fixed entropy makes the failure exact — a reseeded counter would collide.
    const clock = [2000, 1000, 1001, 1000, 2000]
    let index = 0
    const generator = new UuidV7Generator({
      now: () => clock[index++] ?? 1500,
      random: fixedRandom(0),
    })
    const ids = Array.from({ length: 5 }, () => generator.next())
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('stays ordered and unique under an adversarial clock', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 2, maxLength: 60 }),
        (readings) => {
          let index = 0
          const generator = new UuidV7Generator({
            now: () => readings[index++] ?? 0,
            random: fixedRandom(0),
          })
          const ids = readings.map(() => generator.next())
          expect([...ids].sort()).toEqual(ids)
          expect(new Set(ids).size).toBe(ids.length)
        },
      ),
    )
  })
})

describe('uniqueness', () => {
  it('does not repeat across a large batch from the shared generator', () => {
    const ids = Array.from({ length: 10_000 }, () => uuidV7())
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('produces valid identifiers from the shared generator', () => {
    expect(isUuidV7(uuidV7())).toBe(true)
  })
})

describe('isUuidV7', () => {
  it.each([
    ['0189d6e4-0000-7000-8000-000000000000', true],
    ['0189d6e4-0000-4000-8000-000000000000', false], // version 4
    ['0189d6e4-0000-7000-0000-000000000000', false], // bad variant
    ['not-a-uuid', false],
    ['', false],
    ['0189D6E4-0000-7000-8000-000000000000', false], // uppercase not accepted
  ])('classifies %s as %s', (value, expected) => {
    expect(isUuidV7(value)).toBe(expected)
  })
})

describe('timestampOf', () => {
  it('recovers the millisecond the identifier was created', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 44 }), (millis) => {
        const generator = new UuidV7Generator({ now: () => millis, random: fixedRandom(1) })
        expect(timestampOf(generator.next())).toBe(millis)
      }),
    )
  })

  it('refuses a value that is not a UUIDv7', () => {
    expect(() => timestampOf('nope')).toThrow(TypeError)
  })
})
