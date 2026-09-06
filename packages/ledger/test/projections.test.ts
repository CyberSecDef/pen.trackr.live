import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Envelope, UnhashedEnvelope } from '../src/envelope.js'
import { type Projection, ProjectionRunner, timelineProjection } from '../src/projections.js'
import { type LedgerStore, openLedger } from '../src/store.js'
import { uuidV7 } from '../src/uuid.js'

/**
 * @req FR-SECPL-001
 * @req NFR-009
 */

const OPERATOR = uuidV7()
const ENGAGEMENT = uuidV7()

function event(index: number, type: UnhashedEnvelope['type'] = 'command.started') {
  return {
    event_id: uuidV7(),
    ts_utc: `2026-09-05T21:00:${String(index).padStart(2, '0')}.000Z`,
    ts_local: '2026-09-05T17:00:00.000-04:00',
    tz: 'America/New_York',
    operator_id: OPERATOR,
    engagement_id: ENGAGEMENT,
    schema_version: 1,
    type,
    payload: { index },
  }
}

interface TimelineRow {
  readonly seq: number
  readonly type: string
  readonly namespace: string
}

describe('ProjectionRunner', () => {
  let directory: string
  let path: string
  let store: LedgerStore
  let runner: ProjectionRunner

  const rows = (): TimelineRow[] =>
    store
      .projectionDatabase()
      .prepare('SELECT seq, type, namespace FROM timeline ORDER BY seq')
      .all() as TimelineRow[]

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pentrackr-projection-'))
    path = join(directory, 'ledger.db')
    store = openLedger(path)
    runner = new ProjectionRunner(store, [timelineProjection])
  })

  afterEach(() => {
    try {
      store.close()
    } catch {
      // already closed
    }
    rmSync(directory, { recursive: true, force: true })
  })

  describe('catching up', () => {
    it('starts at position zero', () => {
      expect(runner.position('timeline')).toBe(0)
    })

    it('applies events appended before it ran', () => {
      for (let i = 0; i < 3; i += 1) store.append(event(i))
      expect(runner.catchUp()).toEqual({ timeline: 3 })
      expect(rows()).toHaveLength(3)
      expect(runner.position('timeline')).toBe(3)
    })

    it('applies only events it has not seen', () => {
      store.append(event(0))
      runner.catchUp()
      store.append(event(1))
      expect(runner.catchUp()).toEqual({ timeline: 1 })
      expect(rows()).toHaveLength(2)
    })

    it('does nothing when there is nothing new', () => {
      store.append(event(0))
      runner.catchUp()
      expect(runner.catchUp()).toEqual({ timeline: 0 })
    })

    it('handles an empty ledger', () => {
      expect(runner.catchUp()).toEqual({ timeline: 0 })
      expect(rows()).toEqual([])
    })

    it('is idempotent when run repeatedly', () => {
      for (let i = 0; i < 4; i += 1) store.append(event(i))
      runner.catchUp()
      runner.catchUp()
      runner.catchUp()
      expect(rows()).toHaveLength(4)
    })

    it('derives the namespace for filtering', () => {
      store.append(event(0, 'command.started'))
      store.append(event(1, 'guardrail.violation'))
      runner.catchUp()
      expect(rows().map((row) => row.namespace)).toEqual(['command', 'guardrail'])
    })
  })

  describe('projections are disposable, history is not', () => {
    it('rebuilds identical state after the tables are dropped entirely', () => {
      for (let i = 0; i < 20; i += 1) store.append(event(i))
      runner.catchUp()
      const before = rows()

      store.projectionDatabase().exec('DROP TABLE timeline')
      runner.rebuild()

      expect(rows()).toEqual(before)
    })

    it('produces the same result rebuilt as it does incrementally', () => {
      // The property that matters: if these ever diverge, something reached a
      // projection that was never recorded as an event.
      for (let i = 0; i < 10; i += 1) {
        store.append(event(i))
        runner.catchUp()
      }
      const incremental = rows()

      runner.rebuild()
      expect(rows()).toEqual(incremental)
    })

    it('rebuilds deterministically', () => {
      for (let i = 0; i < 8; i += 1) store.append(event(i))
      runner.rebuild()
      const first = rows()
      runner.rebuild()
      expect(rows()).toEqual(first)
    })

    it('discards rows that no event supports', () => {
      // A projection polluted by something outside the ledger is corrected by a
      // rebuild, because the ledger is the only source.
      store.append(event(0))
      runner.catchUp()
      store
        .projectionDatabase()
        .prepare(
          `INSERT INTO timeline (seq, event_id, ts_utc, ts_local, tz, type, namespace, operator_id, engagement_id)
           VALUES (999, 'x', 'y', 'z', 'UTC', 'command.started', 'command', 'a', 'b')`,
        )
        .run()
      expect(rows()).toHaveLength(2)

      runner.rebuild()
      expect(rows()).toHaveLength(1)
    })

    it('leaves the ledger verifiable through rebuilds', () => {
      for (let i = 0; i < 5; i += 1) store.append(event(i))
      runner.rebuild()
      expect(store.verify().ok).toBe(true)
      expect(store.count()).toBe(5)
    })

    it('rejects a rebuild of an unknown projection', () => {
      expect(() => runner.rebuild('nope')).toThrow(/unknown projection/)
    })
  })

  describe('versioning', () => {
    it('rebuilds automatically when a projection version changes', () => {
      for (let i = 0; i < 3; i += 1) store.append(event(i))
      runner.catchUp()

      const upgraded: Projection = { ...timelineProjection, version: 2 }
      const next = new ProjectionRunner(store, [upgraded])
      expect(next.catchUp()).toEqual({ timeline: 3 })
      expect(next.position('timeline')).toBe(3)
      expect(rows()).toHaveLength(3)
    })

    it('does not rebuild when the version is unchanged', () => {
      for (let i = 0; i < 3; i += 1) store.append(event(i))
      runner.catchUp()

      const same = new ProjectionRunner(store, [timelineProjection])
      expect(same.catchUp()).toEqual({ timeline: 0 })
    })

    it('survives closing and reopening the store', () => {
      for (let i = 0; i < 4; i += 1) store.append(event(i))
      runner.catchUp()
      store.close()

      const reopened = openLedger(path)
      const resumed = new ProjectionRunner(reopened, [timelineProjection])
      expect(resumed.position('timeline')).toBe(4)
      expect(resumed.catchUp()).toEqual({ timeline: 0 })
      reopened.close()
    })
  })

  describe('multiple projections', () => {
    const counter: Projection = {
      name: 'type_counts',
      version: 1,
      tables: ['type_counts'],
      schema: `CREATE TABLE IF NOT EXISTS type_counts (type TEXT PRIMARY KEY, n INTEGER NOT NULL);`,
      apply(db: Database.Database, envelope: Envelope) {
        db.prepare(
          `INSERT INTO type_counts (type, n) VALUES (?, 1)
           ON CONFLICT(type) DO UPDATE SET n = n + 1`,
        ).run(envelope.type)
      },
    }

    it('advances each projection independently', () => {
      const multi = new ProjectionRunner(store, [timelineProjection, counter])
      store.append(event(0, 'command.started'))
      store.append(event(1, 'command.started'))
      store.append(event(2, 'manual.logged'))

      expect(multi.catchUp()).toEqual({ timeline: 3, type_counts: 3 })
      const counts = store
        .projectionDatabase()
        .prepare('SELECT type, n FROM type_counts ORDER BY type')
        .all()
      expect(counts).toEqual([
        { type: 'command.started', n: 2 },
        { type: 'manual.logged', n: 1 },
      ])
    })

    it('rebuilds one projection without disturbing another', () => {
      const multi = new ProjectionRunner(store, [timelineProjection, counter])
      for (let i = 0; i < 3; i += 1) store.append(event(i))
      multi.catchUp()

      multi.rebuild('timeline')
      expect(multi.position('timeline')).toBe(3)
      expect(multi.position('type_counts')).toBe(3)
      expect(rows()).toHaveLength(3)
    })

    it('refuses duplicate projection names', () => {
      expect(() => new ProjectionRunner(store, [timelineProjection, timelineProjection])).toThrow(
        /unique/,
      )
    })
  })
})
