import { type CborValue, encode, sealEvent, uuidV7, verifyEvent } from '@pentrackr/ledger'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  fromWireEvent,
  fromWireValue,
  toWireEvent,
  toWireValue,
  wireEventSchema,
  wireValueSchema,
} from '../src/wire.js'

const roundTrip = (value: CborValue) =>
  fromWireValue(JSON.parse(JSON.stringify(toWireValue(value))))
const event = (payload: Record<string, CborValue>) =>
  sealEvent({
    event_id: uuidV7(),
    prev_hash: null,
    operator_id: uuidV7(),
    engagement_id: uuidV7(),
    ts_utc: '2026-09-09T12:00:00.000Z',
    ts_local: '2026-09-09T08:00:00.000-04:00',
    tz: 'America/New_York',
    schema_version: 1,
    type: 'manual.logged',
    payload,
  })

describe('lossless JSON ledger transport', () => {
  it.each(
    [
      null,
      true,
      false,
      '',
      '水',
      0,
      -0,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      0n,
      1n,
      2n ** 64n - 1n,
      -(2n ** 64n),
      Uint8Array.of(0, 128, 255),
      [],
      {},
      ['bytes', 'deadbeef'],
      { type: 'bigint', value: '123' },
      new Map([
        ['constructor', 1],
        ['__proto__', 2],
      ]),
    ].map((value) => ({ value })),
  )('preserves CBOR for $value', ({ value }) => {
    expect(encode(roundTrip(value))).toEqual(encode(value))
  })
  it('keeps ordinary arrays and tag-like objects distinct from special values', () => {
    expect(toWireValue(Uint8Array.of(1))).toEqual(['bytes', '01'])
    expect(toWireValue(['bytes', '01'])).toEqual(['array', ['bytes', '01']])
    expect(roundTrip({ tag: 'bigint', value: '1' })).toEqual({ tag: 'bigint', value: '1' })
    const poison = JSON.parse('{"__proto__":{"polluted":true},"constructor":"evidence"}')
    const result = roundTrip(poison)
    expect(Object.hasOwn(result as object, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(encode(result)).toEqual(encode(poison))
  })
  it('sorts maps deterministically and accepts empty byte strings', () => {
    expect(toWireValue({ b: 2, a: 1 })).toEqual(
      toWireValue(
        new Map([
          ['a', 1],
          ['b', 2],
        ]),
      ),
    )
    expect(fromWireValue(['bytes', ''])).toEqual(new Uint8Array())
  })
  it('preserves signed envelope fields and hashes after JSON serialization', () => {
    const original = event({
      bytes: Uint8Array.of(255),
      max: 2n ** 64n - 1n,
      min: -(2n ** 64n),
      nested: ['array', { empty: null }],
    })
    const restored = fromWireEvent(JSON.parse(JSON.stringify(toWireEvent(12, original))))
    expect(restored.seq).toBe(12)
    expect(encode(restored.envelope)).toEqual(encode(original))
    expect(verifyEvent(restored.envelope)).toBe(true)
  })
  it('preserves arbitrary nested CBOR values through real JSON', () => {
    const primitive = fc.oneof(
      fc.boolean(),
      fc.constant(null),
      fc.integer(),
      fc.string(),
      fc.bigInt({ min: -(2n ** 64n), max: 2n ** 64n - 1n }),
      fc.uint8Array(),
    )
    const values = fc.letrec<{ value: CborValue }>((tie) => ({
      value: fc.oneof(
        { depthSize: 'small' },
        primitive,
        fc.array(tie('value'), { maxLength: 5 }),
        fc.dictionary(fc.string(), tie('value'), { maxKeys: 5 }),
      ),
    })).value
    fc.assert(
      fc.property(values, (value) => {
        expect(encode(roundTrip(value))).toEqual(encode(value))
      }),
      { numRuns: 500 },
    )
  })
})

describe('wire rejection boundaries', () => {
  it.each(
    [
      ['bytes', 'f'],
      ['bytes', 'FF'],
      ['bytes', 'gg'],
      ['bytes', '00', 'extra'],
      ['bigint', '+1'],
      ['bigint', '01'],
      ['bigint', '-0'],
      ['bigint', 'invalid'],
      ['bigint', '1.0'],
      ['bigint', '18446744073709551616'],
      ['bigint', '-18446744073709551617'],
      ['bigint', '1'.repeat(100)],
      ['unknown', 'value'],
      [
        'map',
        [
          ['a', 1],
          ['a', 2],
        ],
      ],
      ['array', [undefined]],
      ['map', [[123, true]]],
      { tag: 'bytes', value: 'ff' },
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Infinity,
      '\uD800',
      ['map', [['\uD800', null]]],
    ].map((value) => ({ value })),
  )('rejects malformed wire data $value', ({ value }) => {
    expect(wireValueSchema.safeParse(value).success).toBe(false)
    expect(() => fromWireValue(value)).toThrow()
  })
  it.each(
    [
      undefined,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Infinity,
      '\uD800',
      new Date(),
      new Set(),
      Symbol('x'),
      () => 1,
      new Map([[1, true]]),
    ].map((value) => ({ value })),
  )('rejects values outside the CBOR contract: $value', ({ value }) => {
    expect(() => toWireValue(value as CborValue)).toThrow()
  })
  it('rejects cycles, excessive depth/node counts, sparse arrays and accessor properties', () => {
    const cycle: unknown[] = []
    cycle.push(cycle)
    let deep: unknown = 0
    for (let i = 0; i < 100; i++) deep = ['array', [deep]]
    for (const value of [cycle, deep, ['array', Array(20_001).fill(0)], new Array(2)]) {
      expect(wireValueSchema.safeParse(value).success).toBe(false)
    }
    const getter = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get() {
        throw new Error('getter must not run')
      },
    })
    expect(() => toWireValue(getter)).toThrow(/data/)
    expect(() => toWireValue({ [Symbol('hidden')]: 1 })).toThrow(/data/)
    expect(() => toWireValue(new Map([['\uD800', 1]]))).toThrow(/well-formed/)
  })
  it('allows shared references that are not cycles', () => {
    const shared = { a: 1 }
    expect(roundTrip([shared, shared])).toEqual([shared, shared])
  })
  it('rejects unsupported event versions, scalar payloads and invalid sequence numbers', () => {
    const original = event({ x: 1 })
    const wire = toWireEvent(1, original)
    expect(wireEventSchema.safeParse({ ...wire, wire_version: 2 }).success).toBe(false)
    expect(() =>
      fromWireEvent({ ...wire, envelope: { ...wire.envelope, payload: 'not a map' } }),
    ).toThrow()
    expect(() => toWireEvent(0, original)).toThrow()
  })
  it('publishes the recursive wire schema as JSON Schema', () => {
    const json = z.toJSONSchema(wireEventSchema)
    expect(JSON.stringify(json)).toContain('wire_version')
    expect(JSON.stringify(json)).toContain('bigint')
  })
})
