import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UnhashedEnvelope } from '../src/envelope.js'
import { type LedgerStore, LedgerStoreError, openLedger } from '../src/store.js'
import { uuidV7 } from '../src/uuid.js'

/**
 * @req FR-SECPL-001
 * @req NFR-006
 * @req NFR-009
 */

const OPERATOR = uuidV7()
const ENGAGEMENT = uuidV7()

function event(overrides: Partial<UnhashedEnvelope> = {}): Omit<UnhashedEnvelope, 'prev_hash'> {
  const { prev_hash: _drop, ...rest } = {
    event_id: uuidV7(),
    prev_hash: null,
    ts_utc: '2026-09-05T21:00:00.000Z',
    ts_local: '2026-09-05T17:00:00.000-04:00',
    tz: 'America/New_York',
    operator_id: OPERATOR,
    engagement_id: ENGAGEMENT,
    schema_version: 1,
    type: 'command.started' as const,
    payload: {} as Record<string, never>,
    ...overrides,
  }
  return rest
}

describe('LedgerStore', () => {
  let directory: string
  let path: string
  let store: LedgerStore

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pentrackr-ledger-'))
    path = join(directory, 'ledger.db')
    store = openLedger(path)
  })

  afterEach(() => {
    try {
      store.close()
    } catch {
      // already closed by a test
    }
    rmSync(directory, { recursive: true, force: true })
  })

  describe('appending', () => {
    it('starts empty', () => {
      expect(store.count()).toBe(0)
      expect(store.head()).toBeNull()
      expect(store.verify()).toEqual({ ok: true, length: 0, head: null })
    })

    it('appends a genesis event with no predecessor', () => {
      const appended = store.append(event())
      expect(appended.prev_hash).toBeNull()
      expect(store.count()).toBe(1)
      expect(store.head()?.this_hash).toBe(appended.this_hash)
    })

    it('links each event to the previous head', () => {
      const first = store.append(event())
      const second = store.append(event())
      expect(second.prev_hash).toBe(first.this_hash)
    })

    it('keeps a long chain verifiable', () => {
      for (let i = 0; i < 250; i += 1) store.append(event({ payload: { index: i } }))
      const verdict = store.verify()
      expect(verdict.ok).toBe(true)
      if (verdict.ok) expect(verdict.length).toBe(250)
    })

    it('rejects an event that fails envelope validation', () => {
      expect(() => store.append(event({ tz: 'Mars/Olympus_Mons' }))).toThrow()
      expect(store.count()).toBe(0)
    })

    it('rejects a payload the encoder cannot represent', () => {
      expect(() => store.append(event({ payload: { ratio: 1.5 } as never }))).toThrow()
      expect(store.count()).toBe(0)
    })

    it('refuses a duplicate event id', () => {
      const id = uuidV7()
      store.append(event({ event_id: id }))
      expect(() => store.append(event({ event_id: id }))).toThrow()
      expect(store.count()).toBe(1)
    })
  })

  describe('payload round-trip', () => {
    it('restores nested structures exactly', () => {
      const payload = {
        argv: ['nmap', '-sV', '10.129.1.1'],
        exit_code: 0,
        cwd: '/home/op',
        dead_end: false,
        rationale: null,
        nested: { a: [1, 2, { b: 'c' }] },
      }
      store.append(event({ payload }))
      const [stored] = store.read()
      expect(stored?.envelope.payload).toEqual(payload)
    })

    it('restores byte strings as bytes rather than as text', () => {
      store.append(event({ payload: { digest: Uint8Array.of(0xde, 0xad) } }))
      const [stored] = store.read()
      expect(stored?.envelope.payload.digest).toEqual(Uint8Array.of(0xde, 0xad))
    })

    it('restores large integers as bigint', () => {
      store.append(event({ payload: { bytes_read: 2n ** 60n } }))
      const [stored] = store.read()
      expect(stored?.envelope.payload.bytes_read).toBe(2n ** 60n)
    })

    it('preserves an empty payload', () => {
      store.append(event({ payload: {} }))
      expect(store.read()[0]?.envelope.payload).toEqual({})
    })
  })

  describe('append-only enforcement', () => {
    it('refuses an UPDATE at the database level', () => {
      store.append(event())
      const raw = new DatabaseSync(path)
      expect(() => raw.exec("UPDATE events SET type = 'command.finished'")).toThrow(/append-only/)
      raw.close()
    })

    it('refuses a DELETE at the database level', () => {
      store.append(event())
      const raw = new DatabaseSync(path)
      expect(() => raw.exec('DELETE FROM events')).toThrow(/append-only/)
      raw.close()
    })

    it('refuses edits from a connection that has never seen this code', () => {
      // The point of enforcing in the database: a sqlite3 shell is bound too.
      store.append(event())
      const raw = new DatabaseSync(path)
      expect(() => raw.exec("UPDATE events SET payload = X'a0'")).toThrow(/append-only/)
      raw.close()
      expect(store.verify().ok).toBe(true)
    })

    it('does NOT prevent someone with write access from dropping the triggers', () => {
      // Stated plainly because conflating these two layers would be a mistake:
      // triggers stop accidents, the chain detects intent. This test asserts the
      // limitation exists AND that the second layer catches what gets through.
      store.append(event({ payload: { index: 0 } }))
      store.append(event({ payload: { index: 1 } }))
      store.append(event({ payload: { index: 2 } }))

      const raw = new DatabaseSync(path)
      raw.exec('DROP TRIGGER events_no_delete')
      raw.exec('DELETE FROM events WHERE seq = 2')
      raw.close()

      const verdict = store.verify()
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) expect(verdict.failure).toBe('broken-link')
    })

    it('detects a column edited independently of the payload blob', () => {
      // Verification reconstructs from columns rather than hashing a stored
      // preimage, so a column-only edit is caught rather than trusted.
      store.append(event())
      const raw = new DatabaseSync(path)
      raw.exec('DROP TRIGGER events_no_update')
      raw.exec("UPDATE events SET tz = 'UTC'")
      raw.close()

      const verdict = store.verify()
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) expect(verdict.failure).toBe('hash-mismatch')
    })
  })

  describe('durability', () => {
    it('has committed an event by the time append returns (NFR-006)', () => {
      // A second connection sees it, so a crash of this process after append
      // returns cannot lose an already-finished event.
      const appended = store.append(event())
      const other = new DatabaseSync(path, { readOnly: true })
      const row = other.prepare('SELECT this_hash FROM events').get() as { this_hash: string }
      other.close()
      expect(row.this_hash).toBe(appended.this_hash)
    })

    it('survives closing and reopening the store', () => {
      for (let i = 0; i < 5; i += 1) store.append(event({ payload: { index: i } }))
      const expected = store.head()?.this_hash
      store.close()

      const reopened = openLedger(path)
      expect(reopened.count()).toBe(5)
      expect(reopened.head()?.this_hash).toBe(expected)
      expect(reopened.verify().ok).toBe(true)
      reopened.close()
    })

    it('continues the existing chain after reopening', () => {
      const first = store.append(event())
      store.close()

      const reopened = openLedger(path)
      const second = reopened.append(event())
      expect(second.prev_hash).toBe(first.this_hash)
      expect(reopened.verify().ok).toBe(true)
      reopened.close()
    })
  })

  describe('reading', () => {
    beforeEach(() => {
      store.append(event({ type: 'command.started', payload: { index: 0 } }))
      store.append(event({ type: 'command.finished', payload: { index: 1 } }))
      store.append(event({ type: 'command.started', payload: { index: 2 } }))
    })

    it('returns events in sequence order', () => {
      expect(store.read().map((stored) => stored.envelope.payload.index)).toEqual([0, 1, 2])
    })

    it('filters by type', () => {
      const started = store.read({ type: 'command.started' })
      expect(started).toHaveLength(2)
    })

    it('starts from a sequence number', () => {
      expect(store.read({ fromSeq: 2 }).map((stored) => stored.seq)).toEqual([2, 3])
    })

    it('limits the number of rows', () => {
      expect(store.read({ limit: 2 })).toHaveLength(2)
    })

    it('recomputes the hash of a single event', () => {
      const [stored] = store.read()
      expect(store.recomputeHash(1)).toBe(stored?.envelope.this_hash)
    })

    it('returns null when recomputing a sequence that does not exist', () => {
      expect(store.recomputeHash(9999)).toBeNull()
    })
  })

  describe('schema versioning', () => {
    it('records the schema version on creation', () => {
      expect(store.meta('schema_version')).toBe('1')
    })

    it('refuses to open a ledger written by a future schema', () => {
      store.setMeta('schema_version', '99')
      store.close()
      expect(() => openLedger(path)).toThrow(LedgerStoreError)
    })

    it('round-trips arbitrary metadata', () => {
      store.setMeta('engagement_name', 'Cap')
      expect(store.meta('engagement_name')).toBe('Cap')
      store.setMeta('engagement_name', 'Overwatch')
      expect(store.meta('engagement_name')).toBe('Overwatch')
    })

    it('returns null for metadata that was never set', () => {
      expect(store.meta('absent')).toBeNull()
    })
  })
})
