import { z } from 'zod'
import { type CborValue, collectEncodingIssues } from './cbor.js'
import { eventTypeSchema } from './events.js'
import { isUuidV7 } from './uuid.js'

/**
 * The event envelope every ledger entry carries.
 *
 * @req FR-SECPL-001
 * @req NFR-010
 *
 * Field names are snake_case because SRS section 25.2 names them that way and
 * the SRS is frozen. These are wire and hash-preimage names, not TypeScript
 * ergonomics: introducing a camelCase mapping layer would add a place for the
 * hashed representation and the in-memory one to disagree, which is precisely
 * the bug class this ledger exists to prevent.
 *
 * Envelope fields are exactly the nine the SRS lists, deliberately. Measured
 * clock offset (NFR-010) is a command-ledger field per section 5.3 and lives in
 * payloads, so that a frozen spec's envelope stays the shape it froze at.
 */

/** SHA-256 as lowercase hex. Uppercase is rejected so encodings cannot vary. */
export const HASH_PATTERN = /^[0-9a-f]{64}$/

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:Z|[+-]\d{2}:\d{2})$/

export const uuidV7Schema = z.string().refine(isUuidV7, {
  message: 'expected a UUIDv7',
})

export const hashSchema = z.string().regex(HASH_PATTERN, 'expected lowercase hex SHA-256')

/** Rejects a timezone the host cannot resolve, so a stored name stays meaningful. */
export function isKnownTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export const timeZoneSchema = z.string().min(1).refine(isKnownTimeZone, {
  message: 'expected an IANA time zone name the host can resolve',
})

/**
 * Payload values are restricted to what the deterministic encoder accepts.
 *
 * Validation delegates to the encoder's own rule set rather than restating it,
 * so an encoding-hostile payload is rejected with a precise field path while it
 * is still a value, instead of throwing from inside the hash function once it
 * is already an event.
 */
export const payloadSchema = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  for (const issue of collectEncodingIssues(value)) {
    ctx.addIssue({ code: 'custom', path: [...issue.path], message: issue.message })
  }
}) as unknown as z.ZodType<Record<string, CborValue>>

/** The envelope as it exists before its own hash has been computed. */
export const unhashedEnvelopeSchema = z.object({
  event_id: uuidV7Schema,
  prev_hash: hashSchema.nullable(),
  ts_utc: z.string().regex(ISO_UTC, 'expected ISO-8601 UTC with milliseconds'),
  ts_local: z.string().regex(ISO_OFFSET, 'expected ISO-8601 local time with offset'),
  tz: timeZoneSchema,
  operator_id: uuidV7Schema,
  engagement_id: uuidV7Schema,
  schema_version: z.int().positive(),
  type: eventTypeSchema,
  payload: payloadSchema,
})

/** A sealed envelope: the unhashed fields plus the hash computed over them. */
export const envelopeSchema = unhashedEnvelopeSchema.extend({
  this_hash: hashSchema,
})

export type UnhashedEnvelope = z.infer<typeof unhashedEnvelopeSchema>
export type Envelope = z.infer<typeof envelopeSchema>

/** Field order is irrelevant to the hash — the encoder sorts keys — but is fixed here for readability. */
export const ENVELOPE_FIELDS = [
  'event_id',
  'prev_hash',
  'ts_utc',
  'ts_local',
  'tz',
  'operator_id',
  'engagement_id',
  'schema_version',
  'type',
  'payload',
] as const

export function parseEnvelope(value: unknown): Envelope {
  return envelopeSchema.parse(value)
}

export function parseUnhashedEnvelope(value: unknown): UnhashedEnvelope {
  return unhashedEnvelopeSchema.parse(value)
}
