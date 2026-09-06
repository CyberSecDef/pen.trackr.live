import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { encode, encodeHex } from '../src/cbor.js'
import { CborDecodeError, decode, decodeHex } from '../src/cbor-decode.js'

/**
 * @req FR-SECPL-002
 * @req NFR-009
 */

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'))

describe('RFC 8949 Appendix A vectors, decoded', () => {
  it.each([
    ['00', 0],
    ['01', 1],
    ['17', 23],
    ['1818', 24],
    ['1903e8', 1000],
    ['1a000f4240', 1000000],
    ['20', -1],
    ['3863', -100],
    ['f4', false],
    ['f5', true],
    ['f6', null],
    ['60', ''],
    ['6161', 'a'],
    ['6449455446', 'IETF'],
    ['63e6b0b4', '水'],
  ])('decodes %s', (hex, expected) => {
    expect(decodeHex(hex)).toEqual(expected)
  })

  it('decodes big integers beyond safe range as bigint', () => {
    expect(decodeHex('1bffffffffffffffff')).toBe(18446744073709551615n)
    expect(decodeHex('3bffffffffffffffff')).toBe(-18446744073709551616n)
  })

  it('decodes arrays', () => {
    expect(decodeHex('80')).toEqual([])
    expect(decodeHex('83010203')).toEqual([1, 2, 3])
    expect(decodeHex('8301820203820405')).toEqual([1, [2, 3], [4, 5]])
  })

  it('decodes maps', () => {
    expect(decodeHex('a0')).toEqual({})
    expect(decodeHex('a26161016162820203')).toEqual({ a: 1, b: [2, 3] })
  })

  it('decodes byte strings', () => {
    expect(decodeHex('4401020304')).toEqual(Uint8Array.of(1, 2, 3, 4))
  })
})

describe('strictness: rejects what the encoder would never emit', () => {
  it('rejects a non-shortest one-byte argument', () => {
    // 23 must be encoded inline as 0x17, not as 0x1817.
    expect(() => decode(bytes('1817'))).toThrow(/non-canonical head/)
  })

  it.each([
    ['two-byte', '190017'],
    ['four-byte', '1a00000017'],
    ['eight-byte', '1b0000000000000017'],
  ])('rejects a non-shortest %s argument', (_label, hex) => {
    expect(() => decode(bytes(hex))).toThrow(/non-canonical head/)
  })

  it('rejects indefinite-length items', () => {
    expect(() => decode(bytes('9f01ff'))).toThrow(/indefinite-length/)
  })

  it.each(['1c', '1d', '1e'])('rejects reserved additional information in %s', (hex) => {
    expect(() => decode(bytes(hex))).toThrow(/reserved additional information/)
  })

  it('rejects map keys that are out of canonical order', () => {
    // {"b":1,"a":2} — valid CBOR, but not the order the encoder produces.
    expect(() => decode(bytes('a26162016161 02'.replace(/\s/g, '')))).toThrow(/canonical order/)
  })

  it('rejects duplicate map keys', () => {
    expect(() => decode(bytes('a2616101616102'))).toThrow(/duplicate map key/)
  })

  it('rejects a non-string map key', () => {
    expect(() => decode(bytes('a10101'))).toThrow(/must be text strings/)
  })

  it.each([
    ['half float', 'f93e00'],
    ['single float', 'fa3fc00000'],
    ['double float', 'fb3ff8000000000000'],
  ])('rejects a %s', (_label, hex) => {
    expect(() => decode(bytes(hex))).toThrow(/floating point/)
  })

  it('rejects undefined and says to use an explicit null', () => {
    expect(() => decode(bytes('f7'))).toThrow(/explicit null/)
  })

  it('rejects an unsupported simple value', () => {
    expect(() => decode(bytes('f0'))).toThrow(/unsupported simple value/)
  })

  it('rejects tagged items, which the encoder never produces', () => {
    expect(() => decode(bytes('c11a514b67b0'))).toThrow(CborDecodeError)
  })

  it('rejects trailing bytes after a complete item', () => {
    expect(() => decode(bytes('0000'))).toThrow(/trailing bytes/)
  })

  it('rejects truncated input', () => {
    expect(() => decode(bytes('6449455'))).toThrow(CborDecodeError)
    expect(() => decode(bytes(''))).toThrow(/unexpected end of input/)
  })

  it('rejects text that is not well-formed UTF-8', () => {
    // 0xff is never valid in UTF-8.
    expect(() => decode(bytes('61ff'))).toThrow(/well-formed UTF-8/)
  })

  it('reports the byte offset of the problem', () => {
    // array(3) declaring three items but carrying only two.
    try {
      decode(bytes('83010'.padEnd(6, '2')))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(CborDecodeError)
      expect((error as CborDecodeError).message).toMatch(/at byte \d+/)
      expect((error as CborDecodeError).offset).toBeGreaterThan(0)
    }
  })
})

describe('round-trip with the encoder', () => {
  const canonicalValue = fc.letrec((tie) => ({
    value: fc.oneof(
      { depthSize: 'small' },
      fc.constant(null),
      fc.boolean(),
      fc.integer({ min: -100000, max: 100000 }),
      fc.string().filter((text) => text.isWellFormed()),
      fc.uint8Array(),
      fc.array(tie('value'), { maxLength: 4 }),
      fc.dictionary(
        fc.string().filter((text) => text.isWellFormed()),
        tie('value'),
        { maxKeys: 4 },
      ),
    ),
  })).value

  it('is byte-idempotent: re-encoding a decoded value reproduces the bytes', () => {
    // The right property. encode(5) and encode(5n) are identical bytes, so a
    // decoder cannot recover which type the caller used — canonical encoding is
    // a normalization. Byte idempotence is what actually matters for a preimage.
    fc.assert(
      fc.property(canonicalValue, (value) => {
        const first = encode(value as never)
        expect(encodeHex(decode(first) as never)).toBe(Buffer.from(first).toString('hex'))
      }),
    )
  })

  it('preserves structure through a round trip', () => {
    const value = { b: [1, 2], a: 'x', c: { d: null, e: true } }
    expect(decode(encode(value))).toEqual({ a: 'x', b: [1, 2], c: { d: null, e: true } })
  })

  it('accepts every encoder output as canonical', () => {
    fc.assert(
      fc.property(canonicalValue, (value) => {
        expect(() => decode(encode(value as never))).not.toThrow()
      }),
    )
  })

  it('rejects corruption of the leading structural byte', () => {
    // Scope note: catching corrupted *values* is the hash's job, not the
    // decoder's. The decoder's contribution is refusing structure no encoder
    // would emit, so that is what this asserts rather than a statistical claim
    // about arbitrary bit flips.
    const encoded = encode({ alpha: 'one', beta: [1, 2, 3] })
    const mutated = Uint8Array.from(encoded)
    mutated[0] = 0xff
    expect(() => decode(mutated)).toThrow(CborDecodeError)
  })

  it('rejects a map whose declared size exceeds its contents', () => {
    const encoded = encode({ a: 1 })
    const mutated = Uint8Array.from(encoded)
    mutated[0] = 0xa2 // claim two entries where one was written
    expect(() => decode(mutated)).toThrow(CborDecodeError)
  })
})

/**
 * Regression anchors for a bug found by a property test on a Windows machine,
 * after 20,000 runs on Linux had not sampled it. Property tests find these;
 * explicit examples keep them found.
 */
describe('dangerous key names round-trip as ordinary data', () => {
  const withKey = (key: string, value: unknown) => Object.fromEntries([[key, value]])

  it('preserves a __proto__ key as an own property', () => {
    const decoded = decode(encode(withKey('__proto__', { isAdmin: 1 }) as never)) as Record<
      string,
      unknown
    >
    expect(Object.hasOwn(decoded, '__proto__')).toBe(true)
    expect(Object.keys(decoded)).toEqual(['__proto__'])
  })

  it('does not alter the decoded object prototype', () => {
    // Assignment would set the prototype instead of storing the key, silently
    // dropping data and leaving a mutated object behind.
    const decoded = decode(encode(withKey('__proto__', { isAdmin: 1 }) as never))
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
  })

  it('does not pollute Object.prototype', () => {
    decode(encode(withKey('__proto__', withKey('polluted', 1)) as never))
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('stays byte-idempotent for a __proto__ key', () => {
    // The exact assertion that failed: the decoded value re-encoded to 'a0'
    // because the key had vanished.
    const bytes = encode(withKey('__proto__', {}) as never)
    expect(encodeHex(decode(bytes) as never)).toBe(Buffer.from(bytes).toString('hex'))
  })

  it.each(['constructor', 'prototype', 'toString', '__defineGetter__'])(
    'preserves the %s key',
    (key) => {
      const decoded = decode(encode(withKey(key, 1) as never)) as Record<string, unknown>
      expect(Object.keys(decoded)).toEqual([key])
      expect(decoded[key]).toBe(1)
    },
  )

  it('preserves a __proto__ key nested inside other data', () => {
    // The realistic case: Pen Trackr storing evidence of a prototype-pollution
    // finding, whose captured request body literally contains this key.
    const payload = { request_body: withKey('__proto__', { isAdmin: 1 }) }
    expect(decode(encode(payload as never))).toEqual(payload)
  })
})
