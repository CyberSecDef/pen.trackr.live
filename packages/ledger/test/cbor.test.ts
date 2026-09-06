import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CborEncodeError, compareBytes, encode, encodeHex } from '../src/cbor.js'

/**
 * @req FR-SECPL-002
 * @req NFR-009
 *
 * Vectors are RFC 8949 Appendix A. They are the reason this encoder can be
 * trusted: "canonical" is a claim until it matches the specification's own
 * examples byte for byte.
 */
describe('RFC 8949 Appendix A vectors', () => {
  it.each([
    [0, '00'],
    [1, '01'],
    [10, '0a'],
    [23, '17'],
    [24, '1818'],
    [25, '1819'],
    [100, '1864'],
    [1000, '1903e8'],
    [1000000, '1a000f4240'],
    [-1, '20'],
    [-10, '29'],
    [-100, '3863'],
    [-1000, '3903e7'],
  ])('encodes integer %s', (value, expected) => {
    expect(encodeHex(value)).toBe(expected)
  })

  it.each([
    [1000000000000n, '1b000000e8d4a51000'],
    [18446744073709551615n, '1bffffffffffffffff'],
    [-18446744073709551616n, '3bffffffffffffffff'],
  ])('encodes big integer %s', (value, expected) => {
    expect(encodeHex(value)).toBe(expected)
  })

  it.each([
    [false, 'f4'],
    [true, 'f5'],
    [null, 'f6'],
  ])('encodes simple value %s', (value, expected) => {
    expect(encodeHex(value)).toBe(expected)
  })

  it.each([
    ['', '60'],
    ['a', '6161'],
    ['IETF', '6449455446'],
    ['"\\', '62225c'],
    ['ü', '62c3bc'],
    ['水', '63e6b0b4'],
    ['𐅑', '64f0908591'],
  ])('encodes text %j', (value, expected) => {
    expect(encodeHex(value)).toBe(expected)
  })

  it('encodes byte strings', () => {
    expect(encodeHex(new Uint8Array())).toBe('40')
    expect(encodeHex(Uint8Array.of(1, 2, 3, 4))).toBe('4401020304')
  })

  it('encodes arrays', () => {
    expect(encodeHex([])).toBe('80')
    expect(encodeHex([1, 2, 3])).toBe('83010203')
    expect(encodeHex([1, [2, 3], [4, 5]])).toBe('8301820203820405')
  })

  it('encodes a 25-element array with a one-byte length argument', () => {
    const value = Array.from({ length: 25 }, (_, index) => index + 1)
    expect(encodeHex(value)).toBe('98190102030405060708090a0b0c0d0e0f101112131415161718181819')
  })

  it('encodes maps', () => {
    expect(encodeHex({})).toBe('a0')
    expect(encodeHex({ a: 1, b: [2, 3] })).toBe('a26161016162820203')
    expect(encodeHex(['a', { b: 'c' }])).toBe('826161a161626163')
  })
})

describe('deterministic encoding requirements', () => {
  it('sorts map keys by encoded bytes regardless of insertion order', () => {
    // The specific failure that ruled out cbor-x, which preserves insertion order.
    expect(encodeHex({ b: 1, a: 2 })).toBe(encodeHex({ a: 2, b: 1 }))
  })

  it('orders shorter keys before longer ones, per bytewise comparison of encodings', () => {
    // "z" encodes as 617a, "aa" as 626161; 0x61 < 0x62, so "z" sorts first.
    expect(encodeHex({ aa: 1, z: 2 })).toBe('a2617a02626161 01'.replace(/\s/g, ''))
  })

  it('uses the shortest map header, not a padded one', () => {
    // cbor-x emitted b90002 here; canonical requires a2.
    expect(encodeHex({ a: 1, b: 2 })).toMatch(/^a2/)
  })

  it('sorts nested map keys too', () => {
    expect(encodeHex({ outer: { b: 1, a: 2 } })).toBe(encodeHex({ outer: { a: 2, b: 1 } }))
  })

  it('encodes Map and plain object identically for the same entries', () => {
    const asMap = new Map([
      ['b', 1],
      ['a', 2],
    ])
    expect(encodeHex(asMap)).toBe(encodeHex({ a: 2, b: 1 }))
  })
})

describe('rejections that protect determinism', () => {
  it.each([1.5, 0.1, -2.75])('refuses the non-integer %s', (value) => {
    expect(() => encode(value)).toThrow(CborEncodeError)
    expect(() => encode(value)).toThrow(/Floating point is not deterministic/)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses the non-finite %s',
    (value) => {
      expect(() => encode(value)).toThrow(/non-finite/)
    },
  )

  it('refuses an unsafe integer and points at bigint', () => {
    expect(() => encode(Number.MAX_SAFE_INTEGER + 2)).toThrow(/unsafe integer/)
  })

  it('refuses undefined, citing explicit nulls', () => {
    expect(() => encode(undefined as unknown as null)).toThrow(/explicit nulls/)
  })

  it('refuses undefined nested inside a map', () => {
    expect(() => encode({ a: undefined } as unknown as Record<string, null>)).toThrow(
      /explicit nulls/,
    )
  })

  it('refuses a bigint beyond the 64-bit head argument range', () => {
    expect(() => encode(2n ** 64n)).toThrow(/out of range/)
  })

  it('refuses a string containing an unpaired surrogate', () => {
    expect(() => encode('\uD800')).toThrow(/unpaired surrogates/)
  })

  it('refuses ill-formed text nested in a map value', () => {
    expect(() => encode({ note: 'ok\uDC00' })).toThrow(/unpaired surrogates/)
  })

  it('refuses an object key containing an unpaired surrogate', () => {
    // Without this rule '\uD800' and '\uD801' both encode to 63efbfbd, giving
    // two distinct events the same hash preimage for the price of one keystroke.
    expect(() => encode({ '\uD800': 1 })).toThrow(/unpaired surrogates/)
  })

  it('accepts a correctly paired surrogate', () => {
    expect(encodeHex('\uD83D\uDE00')).toBe('64f09f9880')
  })

  it('normalizes negative zero to zero', () => {
    expect(encodeHex(-0)).toBe('00')
  })
})

describe('compareBytes', () => {
  it('orders by first differing byte', () => {
    expect(compareBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBeLessThan(0)
    expect(compareBytes(Uint8Array.of(2), Uint8Array.of(1, 9))).toBeGreaterThan(0)
  })

  it('orders a prefix before its extension', () => {
    expect(compareBytes(Uint8Array.of(1), Uint8Array.of(1, 0))).toBeLessThan(0)
  })

  it('reports equality as zero', () => {
    expect(compareBytes(Uint8Array.of(7, 7), Uint8Array.of(7, 7))).toBe(0)
  })
})

/** The properties that actually matter for a hash preimage. */
describe('encoding properties', () => {
  const cborValue = fc.letrec((tie) => ({
    value: fc.oneof(
      { depthSize: 'small' },
      fc.constant(null),
      fc.boolean(),
      fc.integer({ min: -1_000_000, max: 1_000_000 }),
      fc.string().filter((text) => text.isWellFormed()),
      fc.uint8Array(),
      fc.array(tie('value'), { maxLength: 5 }),
      fc.dictionary(fc.string(), tie('value'), { maxKeys: 5 }),
    ),
  })).value

  it('is deterministic: the same value always encodes to the same bytes', () => {
    fc.assert(
      fc.property(cborValue, (value) => {
        expect(encodeHex(value as never)).toBe(encodeHex(value as never))
      }),
    )
  })

  it('is insensitive to object key insertion order', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string().filter((t) => t.isWellFormed()),
          fc.integer(),
          { maxKeys: 8 },
        ),
        (record) => {
          const shuffled = Object.fromEntries([...Object.entries(record)].reverse())
          expect(encodeHex(shuffled)).toBe(encodeHex(record))
        },
      ),
    )
  })

  it('is injective across distinct integers', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        fc.pre(a !== b)
        expect(encodeHex(a)).not.toBe(encodeHex(b))
      }),
    )
  })

  it('is injective across distinct well-formed strings', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b && a.isWellFormed() && b.isWellFormed())
        expect(encodeHex(a)).not.toBe(encodeHex(b))
      }),
    )
  })

  it('never confuses a text string with a byte string of the same content', () => {
    fc.assert(
      fc.property(
        fc.string().filter((t) => t.isWellFormed()),
        (text) => {
          const bytes = new TextEncoder().encode(text)
          expect(encodeHex(text)).not.toBe(encodeHex(bytes))
        },
      ),
    )
  })

  it('produces the shortest head for every integer boundary', () => {
    const boundaries: Array<[number | bigint, number]> = [
      [23, 1],
      [24, 2],
      [255, 2],
      [256, 3],
      [65535, 3],
      [65536, 5],
      [4294967295n, 5],
      [4294967296n, 9],
    ]
    for (const [value, expectedLength] of boundaries) {
      expect(encode(value).length).toBe(expectedLength)
    }
  })
})
