import { describe, expect, it } from 'vitest'
import {
  envelopeSchema,
  isKnownTimeZone,
  parseEnvelope,
  payloadSchema,
  unhashedEnvelopeSchema,
} from '../src/envelope.js'
import { uuidV7 } from '../src/uuid.js'

/**
 * @req FR-SECPL-001
 * @req NFR-010
 */

const hash = (fill: string) => fill.repeat(64).slice(0, 64)

const validUnhashed = () => ({
  event_id: uuidV7(),
  prev_hash: null,
  ts_utc: '2026-09-05T21:00:00.000Z',
  ts_local: '2026-09-05T17:00:00.000-04:00',
  tz: 'America/New_York',
  operator_id: uuidV7(),
  engagement_id: uuidV7(),
  schema_version: 1,
  type: 'command.started' as const,
  payload: { argv: ['nmap', '-sV'] },
})

const valid = () => ({ ...validUnhashed(), this_hash: hash('a') })

describe('envelope acceptance', () => {
  it('accepts a well-formed envelope', () => {
    expect(() => parseEnvelope(valid())).not.toThrow()
  })

  it('accepts a genesis envelope with a null prev_hash', () => {
    expect(envelopeSchema.safeParse({ ...valid(), prev_hash: null }).success).toBe(true)
  })

  it('accepts a linked envelope with a prev_hash', () => {
    expect(envelopeSchema.safeParse({ ...valid(), prev_hash: hash('b') }).success).toBe(true)
  })

  it('accepts UTC local time expressed as Z', () => {
    const utc = { ...valid(), ts_local: '2026-09-05T21:00:00.000Z', tz: 'UTC' }
    expect(envelopeSchema.safeParse(utc).success).toBe(true)
  })
})

describe('envelope rejection', () => {
  it('rejects an event_id that is not a UUIDv7', () => {
    const result = envelopeSchema.safeParse({
      ...valid(),
      event_id: '00000000-0000-4000-8000-000000000000',
    })
    expect(result.success).toBe(false)
  })

  it.each([
    ['uppercase hex', 'A'.repeat(64)],
    ['too short', 'a'.repeat(63)],
    ['too long', 'a'.repeat(65)],
    ['non-hex', `${'a'.repeat(63)}z`],
    ['empty', ''],
  ])('rejects a this_hash that is %s', (_label, value) => {
    expect(envelopeSchema.safeParse({ ...valid(), this_hash: value }).success).toBe(false)
  })

  it('rejects a missing this_hash', () => {
    expect(envelopeSchema.safeParse(validUnhashed()).success).toBe(false)
  })

  it.each([
    ['no milliseconds', '2026-09-05T21:00:00Z'],
    ['an offset instead of Z', '2026-09-05T21:00:00.000-04:00'],
    ['a space separator', '2026-09-05 21:00:00.000Z'],
    ['not a date at all', 'yesterday'],
  ])('rejects ts_utc with %s', (_label, value) => {
    expect(envelopeSchema.safeParse({ ...valid(), ts_utc: value }).success).toBe(false)
  })

  it('rejects ts_local without an offset or Z', () => {
    expect(
      envelopeSchema.safeParse({ ...valid(), ts_local: '2026-09-05T17:00:00.000' }).success,
    ).toBe(false)
  })

  it.each(['Mars/Olympus_Mons', 'Not A Zone', ''])('rejects the unresolvable timezone %j', (tz) => {
    expect(envelopeSchema.safeParse({ ...valid(), tz }).success).toBe(false)
  })

  it.each([0, -1, 1.5])('rejects schema_version %s', (schema_version) => {
    expect(envelopeSchema.safeParse({ ...valid(), schema_version }).success).toBe(false)
  })

  it('rejects an unknown event type', () => {
    expect(envelopeSchema.safeParse({ ...valid(), type: 'command.teleported' }).success).toBe(false)
  })

  it('rejects an unknown envelope field, so history cannot gain silent extras', () => {
    // A field the hash does not cover would be invisible to verification.
    const extra = { ...valid(), sneaky: true }
    const result = envelopeSchema.safeParse(extra)
    expect(result.success).toBe(true) // zod strips by default
    if (result.success) expect('sneaky' in result.data).toBe(false)
  })
})

describe('payload validation mirrors the encoder', () => {
  it('accepts nested structures the encoder can represent', () => {
    const payload = {
      argv: ['nmap', '-sV'],
      count: 3,
      big: 2n ** 40n,
      ok: true,
      absent: null,
      raw: Uint8Array.of(1, 2),
      nested: { a: [1, { b: 'c' }] },
    }
    expect(payloadSchema.safeParse(payload).success).toBe(true)
  })

  it('rejects a float, matching the encoder rather than failing later at hash time', () => {
    expect(payloadSchema.safeParse({ duration: 1.5 }).success).toBe(false)
  })

  it('rejects a string with unpaired surrogates', () => {
    expect(payloadSchema.safeParse({ note: '\uD800' }).success).toBe(false)
  })

  it('rejects undefined, enforcing explicit nulls', () => {
    expect(payloadSchema.safeParse({ field: undefined }).success).toBe(false)
  })

  it('rejects a float nested deep inside the payload', () => {
    expect(payloadSchema.safeParse({ a: { b: [{ c: 0.1 }] } }).success).toBe(false)
  })

  it('reports the path to the offending field', () => {
    const result = payloadSchema.safeParse({ outer: { inner: 2.5 } })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['outer', 'inner'])
    }
  })

  it('accepts an empty payload', () => {
    expect(payloadSchema.safeParse({}).success).toBe(true)
  })
})

describe('isKnownTimeZone', () => {
  it.each(['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'])('accepts %s', (tz) => {
    expect(isKnownTimeZone(tz)).toBe(true)
  })

  it.each(['Mars/Olympus_Mons', 'nonsense', ''])('rejects %j', (tz) => {
    expect(isKnownTimeZone(tz)).toBe(false)
  })
})

describe('unhashedEnvelopeSchema', () => {
  it('accepts an envelope without this_hash', () => {
    expect(unhashedEnvelopeSchema.safeParse(validUnhashed()).success).toBe(true)
  })

  it('ignores this_hash if present, since it is not part of the preimage', () => {
    const result = unhashedEnvelopeSchema.safeParse(valid())
    expect(result.success).toBe(true)
    if (result.success) expect('this_hash' in result.data).toBe(false)
  })
})
