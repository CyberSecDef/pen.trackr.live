import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UnhashedEnvelope } from '../src/envelope.js'
import { generateSigningKeyPair } from '../src/signing.js'
import { type LedgerStore, openLedger } from '../src/store.js'
import { uuidV7 } from '../src/uuid.js'

/**
 * @req FR-SECPL-002
 *
 * The gap this closes: a hash chain cannot detect truncation of the tail,
 * because every remaining link stays intact (ADR 0012). These tests are the
 * evidence that checkpoints close it.
 */

const keys = generateSigningKeyPair()
const OPERATOR = uuidV7()
const ENGAGEMENT = uuidV7()

function event(index: number): Omit<UnhashedEnvelope, 'prev_hash'> {
  return {
    event_id: uuidV7(),
    ts_utc: '2026-09-05T21:00:00.000Z',
    ts_local: '2026-09-05T17:00:00.000-04:00',
    tz: 'America/New_York',
    operator_id: OPERATOR,
    engagement_id: ENGAGEMENT,
    schema_version: 1,
    type: 'command.started',
    payload: { index },
  }
}

describe('checkpoints', () => {
  let directory: string
  let path: string
  let store: LedgerStore

  const drop = (sql: string): void => {
    const raw = new Database(path)
    raw.exec('DROP TRIGGER IF EXISTS events_no_delete')
    raw.exec('DROP TRIGGER IF EXISTS events_no_update')
    raw.exec('DROP TRIGGER IF EXISTS checkpoints_no_delete')
    raw.exec('DROP TRIGGER IF EXISTS checkpoints_no_update')
    raw.exec(sql)
    raw.close()
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pentrackr-checkpoint-'))
    path = join(directory, 'ledger.db')
    store = openLedger(path)
  })

  afterEach(() => {
    try {
      store.close()
    } catch {
      // already closed
    }
    rmSync(directory, { recursive: true, force: true })
  })

  describe('creating', () => {
    it('records the current length and head', () => {
      for (let i = 0; i < 3; i += 1) store.append(event(i))
      const checkpoint = store.checkpoint(keys.privateKey)
      expect(checkpoint.event_count).toBe(3)
      expect(checkpoint.head_hash).toBe(store.head()?.this_hash)
    })

    it('can checkpoint an empty ledger', () => {
      const checkpoint = store.checkpoint(keys.privateKey)
      expect(checkpoint.event_count).toBe(0)
      expect(checkpoint.head_hash).toBeNull()
      expect(store.verifyCheckpoints()).toEqual({ ok: true, checkpoints: 1 })
    })

    it('links each checkpoint to the previous signature', () => {
      const first = store.checkpoint(keys.privateKey)
      store.append(event(0))
      const second = store.checkpoint(keys.privateKey)
      expect(second.prev_checkpoint_signature).toBe(first.signature)
    })

    it('verifies a series of checkpoints', () => {
      for (let round = 0; round < 4; round += 1) {
        store.append(event(round))
        store.checkpoint(keys.privateKey)
      }
      expect(store.verifyCheckpoints()).toEqual({ ok: true, checkpoints: 4 })
    })

    it('reports no checkpoints as trivially valid', () => {
      store.append(event(0))
      expect(store.verifyCheckpoints()).toEqual({ ok: true, checkpoints: 0 })
    })
  })

  describe('truncation, the failure the chain alone cannot see', () => {
    it('detects events removed from the tail after a checkpoint', () => {
      for (let i = 0; i < 10; i += 1) store.append(event(i))
      store.checkpoint(keys.privateKey)

      drop('DELETE FROM events WHERE seq > 6')

      // The chain still verifies perfectly — this is the whole problem.
      expect(store.verify().ok).toBe(true)

      // The signature does not.
      const verdict = store.verifyCheckpoints()
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) {
        expect(verdict.failure).toBe('truncated')
        expect(verdict.detail).toContain('attests 10 events but only 6')
      }
    })

    it('detects truncation down to an empty ledger', () => {
      store.append(event(0))
      store.checkpoint(keys.privateKey)
      drop('DELETE FROM events')

      const verdict = store.verifyCheckpoints()
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) expect(verdict.failure).toBe('truncated')
    })

    it('detects a rewritten tail of the same length', () => {
      // Subtler than truncation: remove the last events and append replacements,
      // so the count matches again. The head hash does not.
      for (let i = 0; i < 5; i += 1) store.append(event(i))
      store.checkpoint(keys.privateKey)

      drop('DELETE FROM events WHERE seq > 3')
      store.append(event(98))
      store.append(event(99))

      expect(store.count()).toBe(5)
      const verdict = store.verifyCheckpoints()
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) expect(verdict.failure).toBe('head-mismatch')
    })
  })

  describe('attacking the checkpoints themselves', () => {
    it('detects a removed checkpoint through the checkpoint chain', () => {
      for (let i = 0; i < 3; i += 1) {
        store.append(event(i))
        store.checkpoint(keys.privateKey)
      }
      drop('DELETE FROM checkpoints WHERE seq = 2')

      const verdict = store.verifyCheckpoints()
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) expect(verdict.failure).toBe('broken-checkpoint-link')
    })

    it('detects an edited claim', () => {
      for (let i = 0; i < 4; i += 1) store.append(event(i))
      store.checkpoint(keys.privateKey)
      drop('UPDATE checkpoints SET event_count = 2')

      const verdict = store.verifyCheckpoints()
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) expect(verdict.failure).toBe('bad-signature')
    })

    it('detects checkpoints replaced wholesale with an attacker key, when the key is pinned', () => {
      for (let i = 0; i < 3; i += 1) store.append(event(i))
      store.checkpoint(keys.privateKey)

      const attacker = generateSigningKeyPair()
      drop('DELETE FROM checkpoints')
      store.checkpoint(attacker.privateKey)

      // Unpinned, the replacement is internally consistent and passes. This is
      // the limitation, asserted so it cannot quietly stop being true.
      expect(store.verifyCheckpoints().ok).toBe(true)

      // Pinned to the operator's key, the substitution is caught.
      const verdict = store.verifyCheckpoints(keys.publicKey)
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) {
        expect(verdict.failure).toBe('unexpected-key')
        expect(verdict.detail).toContain(attacker.publicKey)
      }
    })

    it('accepts checkpoints signed by the pinned key', () => {
      store.append(event(0))
      store.checkpoint(keys.privateKey)
      expect(store.verifyCheckpoints(keys.publicKey).ok).toBe(true)
    })

    it('refuses to update or delete checkpoints through the normal triggers', () => {
      store.append(event(0))
      store.checkpoint(keys.privateKey)
      const raw = new Database(path)
      expect(() => raw.exec('UPDATE checkpoints SET event_count = 0')).toThrow(/append-only/)
      expect(() => raw.exec('DELETE FROM checkpoints')).toThrow(/append-only/)
      raw.close()
    })
  })

  describe('checkpoints plus chain together', () => {
    it('catches a middle deletion by chain and a tail deletion by signature', () => {
      for (let i = 0; i < 8; i += 1) store.append(event(i))
      store.checkpoint(keys.privateKey)

      drop('DELETE FROM events WHERE seq = 4')

      expect(store.verify().ok).toBe(false) // chain sees the hole
      expect(store.verifyCheckpoints().ok).toBe(false) // signature sees the count
    })

    it('accepts an honest ledger that grew after its last checkpoint', () => {
      for (let i = 0; i < 3; i += 1) store.append(event(i))
      store.checkpoint(keys.privateKey)
      for (let i = 3; i < 6; i += 1) store.append(event(i))

      expect(store.verify().ok).toBe(true)
      expect(store.verifyCheckpoints().ok).toBe(true)
    })
  })
})
