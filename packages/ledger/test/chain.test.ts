import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  appendEvent,
  computeHash,
  DOMAIN_TAG,
  preimage,
  sealEvent,
  unsealed,
  verifyChain,
  verifyEvent,
} from '../src/chain.js'
import type { Envelope, UnhashedEnvelope } from '../src/envelope.js'
import { EVENT_TYPES, type EventType } from '../src/events.js'
import { UuidV7Generator } from '../src/uuid.js'

/**
 * @req FR-SECPL-001
 * @req FR-SECPL-002
 * @req NFR-009
 */

const ids = new UuidV7Generator({ now: () => 1_757_000_000_000, random: () => randomish() })
let entropy = 0
function randomish(): Uint8Array {
  entropy += 1
  const bytes = new Uint8Array(8)
  for (let i = 0; i < 8; i += 1) bytes[i] = (entropy * (i + 7)) % 256
  return bytes
}

const OPERATOR = ids.next()
const ENGAGEMENT = ids.next()

function unhashed(overrides: Partial<UnhashedEnvelope> = {}): UnhashedEnvelope {
  return {
    event_id: ids.next(),
    prev_hash: null,
    ts_utc: '2026-09-05T21:00:00.000Z',
    ts_local: '2026-09-05T17:00:00.000-04:00',
    tz: 'America/New_York',
    operator_id: OPERATOR,
    engagement_id: ENGAGEMENT,
    schema_version: 1,
    type: 'command.started',
    payload: {},
    ...overrides,
  }
}

/** Builds a valid chain of the requested length. */
function buildChain(length: number, types: readonly EventType[] = ['command.started']): Envelope[] {
  const events: Envelope[] = []
  let previous: Envelope | null = null
  for (let i = 0; i < length; i += 1) {
    const type = types[i % types.length] ?? 'command.started'
    const { prev_hash: _drop, ...rest } = unhashed({ type, payload: { index: i } })
    const event = appendEvent(previous, rest)
    events.push(event)
    previous = event
  }
  return events
}

describe('preimage', () => {
  it('is domain separated so an event hash means an event', () => {
    const bytes = preimage(unhashed())
    expect(new TextDecoder().decode(bytes.slice(0, DOMAIN_TAG.length))).toBe(DOMAIN_TAG)
  })

  it('produces a 64-character lowercase hex hash', () => {
    expect(computeHash(unhashed())).toMatch(/^[0-9a-f]{64}$/)
  })

  it('needs no special case for genesis, where prev_hash is null', () => {
    expect(() => computeHash(unhashed({ prev_hash: null }))).not.toThrow()
  })

  it('is stable across repeated computation', () => {
    const event = unhashed()
    expect(computeHash(event)).toBe(computeHash(event))
  })

  it('is insensitive to the key order of the object handed in', () => {
    const forward = unhashed()
    const reversed = Object.fromEntries(
      Object.entries(forward).reverse(),
    ) as unknown as UnhashedEnvelope
    expect(computeHash(reversed)).toBe(computeHash(forward))
  })
})

describe('sealEvent', () => {
  it('attaches a hash that verifies', () => {
    expect(verifyEvent(sealEvent(unhashed()))).toBe(true)
  })

  it('rejects an envelope that fails validation', () => {
    expect(() => sealEvent(unhashed({ tz: 'Mars/Olympus_Mons' }))).toThrow()
  })

  it('round-trips through unsealed()', () => {
    const sealed = sealEvent(unhashed())
    expect(computeHash(unsealed(sealed))).toBe(sealed.this_hash)
  })
})

describe('appendEvent', () => {
  it('links genesis with a null prev_hash', () => {
    const { prev_hash: _drop, ...rest } = unhashed()
    expect(appendEvent(null, rest).prev_hash).toBeNull()
  })

  it('links a successor to its predecessor hash', () => {
    const chain = buildChain(2)
    expect(chain[1]?.prev_hash).toBe(chain[0]?.this_hash)
  })
})

describe('verifyChain on intact chains', () => {
  it('accepts an empty chain and reports a null head', () => {
    expect(verifyChain([])).toEqual({ ok: true, length: 0, head: null })
  })

  it('accepts a single genesis event', () => {
    const chain = buildChain(1)
    expect(verifyChain(chain)).toEqual({ ok: true, length: 1, head: chain[0]?.this_hash })
  })

  it('accepts a long chain and reports its head', () => {
    const chain = buildChain(200)
    const verdict = verifyChain(chain)
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.length).toBe(200)
      expect(verdict.head).toBe(chain[199]?.this_hash)
    }
  })

  it('accepts chains of arbitrary length and event type', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), (length) => {
        expect(verifyChain(buildChain(length, EVENT_TYPES)).ok).toBe(true)
      }),
      { numRuns: 30 },
    )
  })
})

describe('verifyChain detects tampering', () => {
  it('detects a modified payload and names the event', () => {
    const chain = buildChain(5)
    const target = chain[2]
    if (target === undefined) throw new Error('fixture')
    chain[2] = { ...target, payload: { index: 999 } }

    const verdict = verifyChain(chain)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.index).toBe(2)
      expect(verdict.failure).toBe('hash-mismatch')
      expect(verdict.event_id).toBe(target.event_id)
    }
  })

  it.each([
    ['ts_utc', { ts_utc: '2026-09-05T22:00:00.000Z' }],
    ['operator_id', { operator_id: ids.next() }],
    ['type', { type: 'command.finished' as const }],
    ['schema_version', { schema_version: 2 }],
    ['tz', { tz: 'UTC' }],
  ])('detects a modified %s', (_field, change) => {
    const chain = buildChain(3)
    const target = chain[1]
    if (target === undefined) throw new Error('fixture')
    chain[1] = { ...target, ...change }
    const verdict = verifyChain(chain)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.failure).toBe('hash-mismatch')
  })

  it('detects a deleted event in the middle as a broken link', () => {
    const chain = buildChain(5)
    chain.splice(2, 1)
    const verdict = verifyChain(chain)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.failure).toBe('broken-link')
      expect(verdict.index).toBe(2)
    }
  })

  it('detects reordering', () => {
    const chain = buildChain(5)
    const [a, b] = [chain[1], chain[2]]
    if (a === undefined || b === undefined) throw new Error('fixture')
    chain[1] = b
    chain[2] = a
    expect(verifyChain(chain).ok).toBe(false)
  })

  it('detects an inserted foreign event', () => {
    const chain = buildChain(4)
    const { prev_hash: _drop, ...rest } = unhashed({ payload: { forged: true } })
    chain.splice(2, 0, appendEvent(null, rest))
    const verdict = verifyChain(chain)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.failure).toBe('orphaned-event')
  })

  it('detects a genesis event that claims a predecessor', () => {
    const chain = buildChain(2)
    const genesis = chain[0]
    if (genesis === undefined) throw new Error('fixture')
    const forged = sealEvent({ ...unsealed(genesis), prev_hash: 'a'.repeat(64) })
    const verdict = verifyChain([forged, ...chain.slice(1)])
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.failure).toBe('genesis-has-prev')
  })

  it('detects a relinked prev_hash even when the event rehashes cleanly', () => {
    // The subtle attack: rewrite the event AND its hash so the event verifies
    // alone. Only the link to its predecessor gives it away.
    const chain = buildChain(4)
    const target = chain[2]
    if (target === undefined) throw new Error('fixture')
    chain[2] = sealEvent({ ...unsealed(target), prev_hash: 'b'.repeat(64) })
    expect(verifyEvent(chain[2])).toBe(true)
    const verdict = verifyChain(chain)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.failure).toBe('broken-link')
  })

  it('localizes the first divergence in a long chain', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 29 }), (position) => {
        const chain = buildChain(30)
        const target = chain[position]
        if (target === undefined) throw new Error('fixture')
        chain[position] = { ...target, payload: { tampered: true } }
        const verdict = verifyChain(chain)
        expect(verdict.ok).toBe(false)
        if (!verdict.ok) expect(verdict.index).toBe(position)
      }),
      { numRuns: 30 },
    )
  })

  it('detects a single-character change to any stored hash', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9 }), (position) => {
        const chain = buildChain(10)
        const target = chain[position]
        if (target === undefined) throw new Error('fixture')
        const flipped = target.this_hash.startsWith('0')
          ? `1${target.this_hash.slice(1)}`
          : `0${target.this_hash.slice(1)}`
        chain[position] = { ...target, this_hash: flipped }
        expect(verifyChain(chain).ok).toBe(false)
      }),
      { numRuns: 10 },
    )
  })
})

describe('the limitation this design does not fix', () => {
  it('does NOT detect truncation of the tail', () => {
    // Documented in ADR 0012. Every remaining link is intact, so a truncated
    // chain verifies perfectly. This test exists so the gap stays visible: if
    // someone later reads "chain verified" as "nothing is missing", this is the
    // test that says otherwise. Interval signatures over (length, head) in M1.5
    // are what close it.
    const full = buildChain(10)
    const truncated = full.slice(0, 6)

    const verdict = verifyChain(truncated)
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.length).toBe(6)
      expect(verdict.head).toBe(full[5]?.this_hash)
    }
  })

  it('exposes length and head so a signature can bind them', () => {
    const verdict = verifyChain(buildChain(3))
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.length).toBe(3)
      expect(verdict.head).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})
