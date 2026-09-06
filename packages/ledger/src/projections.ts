import type { DatabaseSync } from 'node:sqlite'
import type { Envelope } from './envelope.js'
import { eventNamespace } from './events.js'
import type { LedgerStore } from './store.js'

/**
 * Projection framework: queryable views rebuilt from the ledger.
 *
 * @req FR-SECPL-001
 * @req NFR-009
 *
 * SRS section 2.2 states the principle — "projections are disposable, history is
 * not" — and this is where it becomes testable rather than aspirational. Any
 * projection can be dropped entirely and reconstructed from events alone. If
 * rebuilding ever produced a different answer, something has been recorded in a
 * projection that was never recorded as an event, which is the failure mode the
 * ledger exists to prevent.
 *
 * A projection declares its own version. Bumping it forces a rebuild on next
 * open, so changing a projection's shape is a routine act rather than a
 * migration exercise.
 */

export interface Projection {
  readonly name: string
  /** Bump to force a rebuild when the projection's shape or logic changes. */
  readonly version: number
  /** Idempotent DDL for this projection's tables. */
  readonly schema: string
  /** Tables owned by this projection, dropped and recreated on rebuild. */
  readonly tables: readonly string[]
  /** Applies one event. Must be idempotent for a given seq. */
  apply(db: DatabaseSync, event: Envelope, seq: number): void
}

const STATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS projection_state (
  name     TEXT    PRIMARY KEY,
  version  INTEGER NOT NULL,
  last_seq INTEGER NOT NULL
);
`

interface StateRow {
  readonly name: string
  readonly version: number
  readonly last_seq: number
}

export class ProjectionRunner {
  private readonly store: LedgerStore
  private readonly db: DatabaseSync
  private readonly projections: readonly Projection[]

  constructor(store: LedgerStore, projections: readonly Projection[]) {
    const names = projections.map((projection) => projection.name)
    if (new Set(names).size !== names.length) {
      throw new Error('projection names must be unique')
    }

    this.store = store
    this.db = store.projectionDatabase()
    this.projections = projections
    this.db.exec(STATE_SCHEMA)
    for (const projection of projections) this.db.exec(projection.schema)
  }

  /** How far a projection has consumed the ledger. */
  position(name: string): number {
    const row = this.db.prepare('SELECT last_seq FROM projection_state WHERE name = ?').get(name) as
      | { last_seq: number }
      | undefined
    return row?.last_seq ?? 0
  }

  private state(name: string): StateRow | null {
    return (
      (this.db.prepare('SELECT * FROM projection_state WHERE name = ?').get(name) as
        | StateRow
        | undefined) ?? null
    )
  }

  private setState(name: string, version: number, lastSeq: number): void {
    this.db
      .prepare(`
        INSERT INTO projection_state (name, version, last_seq) VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET version = excluded.version, last_seq = excluded.last_seq
      `)
      .run(name, version, lastSeq)
  }

  /**
   * Applies any events a projection has not yet seen.
   *
   * A projection whose stored version differs from its declared version is
   * rebuilt instead, which is what makes a shape change cost nothing.
   */
  catchUp(): Record<string, number> {
    const applied: Record<string, number> = {}

    for (const projection of this.projections) {
      const state = this.state(projection.name)

      if (state !== null && Number(state.version) !== projection.version) {
        applied[projection.name] = this.rebuild(projection.name)
        continue
      }

      const from = state === null ? 0 : Number(state.last_seq)
      applied[projection.name] = this.applyFrom(projection, from)
    }

    return applied
  }

  private applyFrom(projection: Projection, fromSeq: number): number {
    const pending = this.store.read({ fromSeq: fromSeq + 1 })
    if (pending.length === 0) {
      this.setState(projection.name, projection.version, fromSeq)
      return 0
    }

    this.db.exec('BEGIN')
    try {
      let last = fromSeq
      for (const entry of pending) {
        projection.apply(this.db, entry.envelope, entry.seq)
        last = entry.seq
      }
      this.setState(projection.name, projection.version, last)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    return pending.length
  }

  /** Drops and replays a projection — or all of them — from the ledger. */
  rebuild(name?: string): number {
    const targets =
      name === undefined
        ? this.projections
        : this.projections.filter((projection) => projection.name === name)

    if (name !== undefined && targets.length === 0) {
      throw new Error(`unknown projection: ${name}`)
    }

    let total = 0
    for (const projection of targets) {
      this.db.exec('BEGIN')
      try {
        for (const table of projection.tables) {
          this.db.exec(`DROP TABLE IF EXISTS ${table}`)
        }
        this.db.exec(projection.schema)
        this.setState(projection.name, projection.version, 0)
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
      total += this.applyFrom(projection, 0)
    }

    return total
  }
}

/**
 * A queryable index of the ledger: one row per event, without payloads.
 *
 * Deliberately payload-free. It answers "what happened, when, and by whom" for
 * filtering and navigation; anything needing payload contents reads the event
 * itself. Copying payloads here would duplicate the authoritative bytes into a
 * disposable table, which is exactly the drift this design avoids.
 */
export const timelineProjection: Projection = {
  name: 'timeline',
  version: 1,
  tables: ['timeline'],
  schema: `
    CREATE TABLE IF NOT EXISTS timeline (
      seq           INTEGER PRIMARY KEY,
      event_id      TEXT NOT NULL,
      ts_utc        TEXT NOT NULL,
      ts_local      TEXT NOT NULL,
      tz            TEXT NOT NULL,
      type          TEXT NOT NULL,
      namespace     TEXT NOT NULL,
      operator_id   TEXT NOT NULL,
      engagement_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS timeline_by_type ON timeline (type);
    CREATE INDEX IF NOT EXISTS timeline_by_namespace ON timeline (namespace);
    CREATE INDEX IF NOT EXISTS timeline_by_time ON timeline (ts_utc);
  `,
  apply(db, event, seq) {
    db.prepare(`
      INSERT INTO timeline (
        seq, event_id, ts_utc, ts_local, tz, type, namespace, operator_id, engagement_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(seq) DO NOTHING
    `).run(
      seq,
      event.event_id,
      event.ts_utc,
      event.ts_local,
      event.tz,
      event.type,
      eventNamespace(event.type),
      event.operator_id,
      event.engagement_id,
    )
  },
}
