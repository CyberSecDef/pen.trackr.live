import { createHash } from 'node:crypto'
import { encode } from './cbor.js'
import { type Envelope, type UnhashedEnvelope, parseUnhashedEnvelope } from './envelope.js'

/**
 * Hash chaining over the event log.
 *
 * @req FR-SECPL-001
 * @req FR-SECPL-002
 * @req NFR-009
 *
 * Preimage construction is ADR 0012:
 *
 *     preimage  = utf8("pentrackr/event/1") || canonical_cbor(envelope minus this_hash)
 *     this_hash = lowercase_hex(SHA-256(preimage))
 *
 * `prev_hash` is an ordinary envelope field, so the link is part of the hashed
 * content and genesis needs no special case.
 *
 * WHAT THIS DETECTS: modification of any field of any event, reordering,
 * insertion, and deletion from anywhere except the tail.
 *
 * WHAT THIS DOES NOT DETECT: truncation of the tail. Dropping the last N events
 * leaves a shorter chain in which every remaining link is still intact, so it
 * verifies perfectly. That is a property of hash chains, not a defect here, and
 * it is why interval signatures over (count, head) exist. Anyone reading a
 * verification result must not read "chain intact" as "nothing is missing".
 */

/** Versioned so a future preimage change increments rather than reinterprets. */
export const DOMAIN_TAG = 'pentrackr/event/1'

const DOMAIN_BYTES = new TextEncoder().encode(DOMAIN_TAG)

/** The exact bytes hashed for an event. Exposed so a verifier can be audited. */
export function preimage(unhashed: UnhashedEnvelope): Uint8Array {
  const body = encode(unhashed as never)
  const out = new Uint8Array(DOMAIN_BYTES.length + body.length)
  out.set(DOMAIN_BYTES, 0)
  out.set(body, DOMAIN_BYTES.length)
  return out
}

export function computeHash(unhashed: UnhashedEnvelope): string {
  return createHash('sha256').update(preimage(unhashed)).digest('hex')
}

/** Strips the hash field so a sealed envelope can be re-hashed for verification. */
export function unsealed(envelope: Envelope): UnhashedEnvelope {
  const { this_hash: _ignored, ...rest } = envelope
  return rest
}

/** Computes and attaches the hash, producing a sealed envelope. */
export function sealEvent(unhashed: UnhashedEnvelope): Envelope {
  const validated = parseUnhashedEnvelope(unhashed)
  return { ...validated, this_hash: computeHash(validated) }
}

/**
 * Links a new event onto a chain.
 *
 * Taking the predecessor rather than a bare hash means a caller cannot
 * accidentally link to a hash that never belonged to an event.
 */
export function appendEvent(
  previous: Envelope | null,
  unhashed: Omit<UnhashedEnvelope, 'prev_hash'>,
): Envelope {
  return sealEvent({ ...unhashed, prev_hash: previous?.this_hash ?? null } as UnhashedEnvelope)
}

export type ChainFailure =
  /** The event's own hash does not match its contents: the event was modified. */
  | 'hash-mismatch'
  /** prev_hash does not point at the preceding event: reordered, inserted, or deleted. */
  | 'broken-link'
  /** The first event claims a predecessor. */
  | 'genesis-has-prev'
  /** A later event claims no predecessor. */
  | 'orphaned-event'

export interface ChainOk {
  readonly ok: true
  readonly length: number
  /** Hash of the last event, or null for an empty chain. Sign this with the length. */
  readonly head: string | null
}

export interface ChainBroken {
  readonly ok: false
  readonly index: number
  readonly event_id: string
  readonly failure: ChainFailure
  readonly detail: string
}

export type ChainVerdict = ChainOk | ChainBroken

/**
 * Walks the chain and reports the first divergence.
 *
 * Reporting the first divergence by index rather than a bare boolean is the
 * difference between "this ledger is untrustworthy" and "this ledger is
 * trustworthy up to event 4,812" — which is the answer an operator actually
 * needs when a dispute is about one afternoon.
 */
export function verifyChain(events: readonly Envelope[]): ChainVerdict {
  let previous: Envelope | null = null

  for (const [index, event] of events.entries()) {
    const expected = computeHash(unsealed(event))
    if (expected !== event.this_hash) {
      return {
        ok: false,
        index,
        event_id: event.event_id,
        failure: 'hash-mismatch',
        detail: `event content does not match its hash (expected ${expected}, stored ${event.this_hash})`,
      }
    }

    if (previous === null) {
      if (event.prev_hash !== null) {
        return {
          ok: false,
          index,
          event_id: event.event_id,
          failure: 'genesis-has-prev',
          detail: `first event claims predecessor ${event.prev_hash}`,
        }
      }
    } else if (event.prev_hash === null) {
      return {
        ok: false,
        index,
        event_id: event.event_id,
        failure: 'orphaned-event',
        detail: 'event claims no predecessor but is not first',
      }
    } else if (event.prev_hash !== previous.this_hash) {
      return {
        ok: false,
        index,
        event_id: event.event_id,
        failure: 'broken-link',
        detail: `prev_hash ${event.prev_hash} does not match preceding event ${previous.this_hash}`,
      }
    }

    previous = event
  }

  return { ok: true, length: events.length, head: previous?.this_hash ?? null }
}

/** True only when the event's stored hash matches its own contents. */
export function verifyEvent(envelope: Envelope): boolean {
  return computeHash(unsealed(envelope)) === envelope.this_hash
}
