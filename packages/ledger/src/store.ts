import { DatabaseSync } from 'node:sqlite'
import { type CborValue, encode } from './cbor.js'
import { decode } from './cbor-decode.js'
import { appendEvent, type ChainVerdict, computeHash, unsealed, verifyChain } from './chain.js'
import { type Envelope, parseEnvelope, type UnhashedEnvelope } from './envelope.js'
import {
  type CheckpointClaim,
  publicKeyOf,
  signCheckpoint,
  verifyCheckpointSignature,
} from './signing.js'

/**
 * SQLite-backed append-only event store.
 *
 * @req FR-SECPL-001
 * @req NFR-006
 * @req NFR-009
 *
 * Append-only is enforced by database triggers rather than by application
 * discipline, so an UPDATE or DELETE fails even from a `sqlite3` shell that has
 * never seen this code. Convention would only bind callers who agreed to be
 * bound, which is not the useful set.
 *
 * TRIGGERS ARE NOT TAMPER-PROOFING, and it matters not to confuse the two.
 * Anyone who can write the file can also DROP the triggers. What they cannot do
 * is make the resulting chain verify — that is the hash chain's job, and the two
 * layers answer different questions. Triggers prevent accidents and casual
 * edits; the chain detects deliberate ones.
 *
 * Storage is Node's built-in `node:sqlite` rather than a native addon (ADR
 * 0013). It is the same SQLite engine, statically linked into Node, with no
 * compile step on any platform.
 *
 * Payloads are stored as canonical CBOR blobs, and reads reconstruct the
 * envelope and recompute its hash. That is deliberately more work than hashing
 * a stored preimage would be: it means verification also exercises the scalar
 * columns, so a column corrupted independently of the blob is caught rather
 * than trusted.
 */

export const SCHEMA_VERSION = 1

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       TEXT    NOT NULL UNIQUE,
  prev_hash      TEXT,
  this_hash      TEXT    NOT NULL UNIQUE,
  ts_utc         TEXT    NOT NULL,
  ts_local       TEXT    NOT NULL,
  tz             TEXT    NOT NULL,
  operator_id    TEXT    NOT NULL,
  engagement_id  TEXT    NOT NULL,
  schema_version INTEGER NOT NULL,
  type           TEXT    NOT NULL,
  payload        BLOB    NOT NULL
);

CREATE INDEX IF NOT EXISTS events_by_type ON events (type);
CREATE INDEX IF NOT EXISTS events_by_time ON events (ts_utc);
CREATE INDEX IF NOT EXISTS events_by_engagement ON events (engagement_id);

-- The ledger is append-only (FR-SECPL-001). Corrections are compensating
-- events; there is no in-place edit of history.
CREATE TRIGGER IF NOT EXISTS events_no_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'ledger is append-only: events cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS events_no_delete
BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'ledger is append-only: events cannot be deleted');
END;

-- Signed statements of the form "at this moment the ledger held N events whose
-- head was H". This is what makes tail truncation detectable (ADR 0012).
CREATE TABLE IF NOT EXISTS checkpoints (
  seq                       INTEGER PRIMARY KEY AUTOINCREMENT,
  event_count               INTEGER NOT NULL,
  head_hash                 TEXT,
  prev_checkpoint_signature TEXT,
  ts_utc                    TEXT NOT NULL,
  public_key                TEXT NOT NULL,
  signature                 TEXT NOT NULL UNIQUE
);

CREATE TRIGGER IF NOT EXISTS checkpoints_no_update
BEFORE UPDATE ON checkpoints
BEGIN
  SELECT RAISE(ABORT, 'checkpoints are append-only');
END;

CREATE TRIGGER IF NOT EXISTS checkpoints_no_delete
BEFORE DELETE ON checkpoints
BEGIN
  SELECT RAISE(ABORT, 'checkpoints are append-only');
END;
`

interface EventRow {
  readonly seq: number
  readonly event_id: string
  readonly prev_hash: string | null
  readonly this_hash: string
  readonly ts_utc: string
  readonly ts_local: string
  readonly tz: string
  readonly operator_id: string
  readonly engagement_id: string
  readonly schema_version: number
  readonly type: string
  readonly payload: Uint8Array
}

export interface ReadOptions {
  /** Inclusive sequence number to start from. */
  readonly fromSeq?: number
  readonly limit?: number
  readonly type?: string
}

export interface StoredEvent {
  readonly seq: number
  readonly envelope: Envelope
}

interface CheckpointRow {
  readonly seq: number
  readonly event_count: number
  readonly head_hash: string | null
  readonly prev_checkpoint_signature: string | null
  readonly ts_utc: string
  readonly public_key: string
  readonly signature: string
}

export interface StoredCheckpoint extends CheckpointClaim {
  readonly seq: number
  readonly signature: string
}

export type CheckpointFailure =
  /** The signature does not verify: the claim was altered or forged. */
  | 'bad-signature'
  /** Fewer events exist now than a signature says existed: the tail was truncated. */
  | 'truncated'
  /** The event at the checkpointed position is not the one that was signed. */
  | 'head-mismatch'
  /** A checkpoint does not link to its predecessor: a checkpoint was removed. */
  | 'broken-checkpoint-link'
  /** Signed by a key other than the one the caller expects: checkpoints were replaced. */
  | 'unexpected-key'

export interface CheckpointVerdictOk {
  readonly ok: true
  readonly checkpoints: number
}

export interface CheckpointVerdictBroken {
  readonly ok: false
  readonly seq: number
  readonly failure: CheckpointFailure
  readonly detail: string
}

export type CheckpointVerdict = CheckpointVerdictOk | CheckpointVerdictBroken

export class LedgerStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LedgerStoreError'
  }
}

/**
 * True only for a decoded CBOR map.
 *
 * `typeof x === 'object'` alone is not that test: a byte string decodes to a
 * Uint8Array, which is an object and not an Array, and would pass. Zod rejected
 * it downstream, so nothing invalid was ever accepted — but the guard read as
 * though it were the enforcement when it was not, and the resulting failure was
 * a raw ZodError thrown out of verify() rather than a verdict.
 */
function isCborMap(value: unknown): value is Record<string, CborValue> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !ArrayBuffer.isView(value) &&
    !(value instanceof Map)
  )
}

function rowToEnvelope(row: EventRow): Envelope {
  let payload: unknown
  try {
    payload = decode(row.payload)
  } catch (error) {
    throw new LedgerStoreError(
      `event ${row.event_id} has a payload that is not decodable: ${(error as Error).message}`,
    )
  }

  if (!isCborMap(payload)) {
    const kind = payload === null ? 'null' : (payload?.constructor?.name ?? typeof payload)
    throw new LedgerStoreError(
      `event ${row.event_id} has a payload that is not a map (decoded as ${kind})`,
    )
  }

  return parseEnvelope({
    event_id: row.event_id,
    prev_hash: row.prev_hash,
    ts_utc: row.ts_utc,
    ts_local: row.ts_local,
    tz: row.tz,
    operator_id: row.operator_id,
    engagement_id: row.engagement_id,
    schema_version: Number(row.schema_version),
    type: row.type,
    payload,
    this_hash: row.this_hash,
  })
}

export class LedgerStore {
  private readonly db: DatabaseSync

  constructor(filename: string) {
    this.db = new DatabaseSync(filename)

    // Everything after the open must release the handle if it throws. Without
    // this, a rejected ledger — wrong schema version, corrupt file — leaks an
    // open connection that no one holds a reference to. On Windows that makes
    // the file undeletable for the life of the process, which is how this was
    // found: CI could not clean up its own temp directory.
    try {
      // WAL for concurrent readers; FULL so a completed append survives a
      // process death rather than sitting in an OS buffer (NFR-006).
      this.db.exec('PRAGMA journal_mode = WAL')
      this.db.exec('PRAGMA synchronous = FULL')
      this.db.exec('PRAGMA foreign_keys = ON')
      this.db.exec(SCHEMA)

      const existing = this.meta('schema_version')
      if (existing === null) {
        this.setMeta('schema_version', String(SCHEMA_VERSION))
      } else if (Number(existing) !== SCHEMA_VERSION) {
        throw new LedgerStoreError(
          `ledger schema version ${existing} is not supported by this build (expected ${SCHEMA_VERSION})`,
        )
      }
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  meta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
      )
      .run(key, value, value)
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }
    return Number(row.n)
  }

  head(): Envelope | null {
    const row = this.db.prepare('SELECT * FROM events ORDER BY seq DESC LIMIT 1').get() as
      | EventRow
      | undefined
    return row === undefined ? null : rowToEnvelope(row)
  }

  /**
   * Appends an event, linking it to the current head.
   *
   * The read of the head and the insert share one transaction, so two callers
   * cannot both link to the same predecessor and produce a fork.
   */
  append(event: Omit<UnhashedEnvelope, 'prev_hash'>): Envelope {
    const insert = this.db.prepare(`
      INSERT INTO events (
        event_id, prev_hash, this_hash, ts_utc, ts_local, tz,
        operator_id, engagement_id, schema_version, type, payload
      ) VALUES (
        @event_id, @prev_hash, @this_hash, @ts_utc, @ts_local, @tz,
        @operator_id, @engagement_id, @schema_version, @type, @payload
      )
    `)

    return this.inTransaction(() => {
      const sealed = appendEvent(this.head(), event)
      insert.run({
        event_id: sealed.event_id,
        prev_hash: sealed.prev_hash,
        this_hash: sealed.this_hash,
        ts_utc: sealed.ts_utc,
        ts_local: sealed.ts_local,
        tz: sealed.tz,
        operator_id: sealed.operator_id,
        engagement_id: sealed.engagement_id,
        schema_version: sealed.schema_version,
        type: sealed.type,
        payload: encode(sealed.payload as CborValue),
      })
      return sealed
    })
  }

  /**
   * Runs a function inside a transaction.
   *
   * node:sqlite provides no transaction helper, so this is the five lines it
   * would have given us. Rollback on throw is the point: a partially applied
   * append would leave a chain whose head does not match its contents.
   */
  private inTransaction<T>(body: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = body()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  read(options: ReadOptions = {}): StoredEvent[] {
    const clauses: string[] = []
    const parameters: (string | number)[] = []

    if (options.fromSeq !== undefined) {
      clauses.push('seq >= ?')
      parameters.push(options.fromSeq)
    }
    if (options.type !== undefined) {
      clauses.push('type = ?')
      parameters.push(options.type)
    }

    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''
    const limit = options.limit === undefined ? '' : ' LIMIT ?'
    if (options.limit !== undefined) parameters.push(options.limit)

    const rows = this.db
      .prepare(`SELECT * FROM events${where} ORDER BY seq ASC${limit}`)
      .all(...parameters) as unknown as EventRow[]

    return rows.map((row) => ({ seq: Number(row.seq), envelope: rowToEnvelope(row) }))
  }

  /**
   * Verifies the whole chain as stored, reconstructing each event from its
   * columns.
   *
   * A row that cannot be reconstructed is reported as a verdict, not thrown. An
   * operator running `verify` on a damaged ledger needs an answer naming the
   * event, not a stack trace — and a corrupt ledger is exactly when the tool is
   * being relied upon.
   */
  verify(): ChainVerdict {
    const rows = this.db
      .prepare('SELECT * FROM events ORDER BY seq ASC')
      .all() as unknown as EventRow[]

    const events: Envelope[] = []
    for (const [index, row] of rows.entries()) {
      try {
        events.push(rowToEnvelope(row))
      } catch (error) {
        return {
          ok: false,
          index,
          event_id: row.event_id,
          failure: 'unreadable-event',
          detail: (error as Error).message,
        }
      }
    }

    return verifyChain(events)
  }

  /** True when the stored hash of every event matches its reconstructed content. */
  recomputeHash(seq: number): string | null {
    const row = this.db.prepare('SELECT * FROM events WHERE seq = ?').get(seq) as
      | EventRow
      | undefined
    return row === undefined ? null : computeHash(unsealed(rowToEnvelope(row)))
  }

  /**
   * Signs a statement about the ledger's current length and head.
   *
   * Called at intervals and at seal. Each checkpoint references the previous
   * one's signature, so deleting an inconvenient checkpoint breaks the
   * checkpoint chain rather than quietly removing the evidence.
   */
  checkpoint(privateKeyHex: string, now: () => Date = () => new Date()): StoredCheckpoint {
    const publicKey = publicKeyOf(privateKeyHex)
    const previous = this.latestCheckpoint()
    const head = this.head()

    const claim: CheckpointClaim = {
      event_count: this.count(),
      head_hash: head?.this_hash ?? null,
      prev_checkpoint_signature: previous?.signature ?? null,
      ts_utc: now()
        .toISOString()
        .replace(/\.\d{3}Z$/, '.000Z'),
      public_key: publicKey,
    }

    const signature = signCheckpoint(claim, privateKeyHex)
    const info = this.db
      .prepare(`
        INSERT INTO checkpoints (
          event_count, head_hash, prev_checkpoint_signature, ts_utc, public_key, signature
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        claim.event_count,
        claim.head_hash,
        claim.prev_checkpoint_signature,
        claim.ts_utc,
        claim.public_key,
        signature,
      )

    return { ...claim, seq: Number(info.lastInsertRowid), signature }
  }

  checkpoints(): StoredCheckpoint[] {
    const rows = this.db
      .prepare('SELECT * FROM checkpoints ORDER BY seq ASC')
      .all() as unknown as CheckpointRow[]
    return rows.map((row) => ({
      seq: Number(row.seq),
      event_count: row.event_count,
      head_hash: row.head_hash,
      prev_checkpoint_signature: row.prev_checkpoint_signature,
      ts_utc: row.ts_utc,
      public_key: row.public_key,
      signature: row.signature,
    }))
  }

  latestCheckpoint(): StoredCheckpoint | null {
    return this.checkpoints().at(-1) ?? null
  }

  /**
   * Verifies every checkpoint against the events actually present.
   *
   * This is the half of tamper-evidence the hash chain cannot provide: it
   * answers "is anything missing from the end", which is the question an
   * operator faces when proving what they did NOT do.
   *
   * Pass the operator's known public key. Verification without it proves only
   * that the checkpoints present are internally consistent — which an attacker
   * who replaced them all can also arrange.
   */
  verifyCheckpoints(expectedPublicKey?: string): CheckpointVerdict {
    const stored = this.checkpoints()
    const events = this.read().map((entry) => entry.envelope)
    let previousSignature: string | null = null

    for (const checkpoint of stored) {
      const { seq, signature, ...claim } = checkpoint

      if (!verifyCheckpointSignature(claim, signature)) {
        return {
          ok: false,
          seq,
          failure: 'bad-signature',
          detail: 'checkpoint signature does not verify against its claim',
        }
      }

      // Without pinning, an attacker who can write the file can delete every
      // checkpoint and sign replacements with their own key: the result
      // verifies mathematically while attesting to nothing. A caller who knows
      // whose ledger this is must say so.
      if (expectedPublicKey !== undefined && claim.public_key !== expectedPublicKey) {
        return {
          ok: false,
          seq,
          failure: 'unexpected-key',
          detail: `checkpoint signed by ${claim.public_key}, expected ${expectedPublicKey}`,
        }
      }

      if (claim.prev_checkpoint_signature !== previousSignature) {
        return {
          ok: false,
          seq,
          failure: 'broken-checkpoint-link',
          detail: 'checkpoint does not reference the preceding checkpoint',
        }
      }
      previousSignature = signature

      if (events.length < claim.event_count) {
        return {
          ok: false,
          seq,
          failure: 'truncated',
          detail: `signature attests ${claim.event_count} events but only ${events.length} are present`,
        }
      }

      const attested =
        claim.event_count === 0 ? null : (events[claim.event_count - 1]?.this_hash ?? null)
      if (attested !== claim.head_hash) {
        return {
          ok: false,
          seq,
          failure: 'head-mismatch',
          detail: `event ${claim.event_count} is ${attested ?? 'absent'}, but the signature attests ${claim.head_hash ?? 'none'}`,
        }
      }
    }

    return { ok: true, checkpoints: stored.length }
  }

  /**
   * The underlying connection, for projection tables only.
   *
   * Handing out the handle is safe precisely because immutability is enforced
   * by database triggers rather than by keeping the connection private: a
   * projection that tried to rewrite history would be refused by the same
   * mechanism that refuses a sqlite3 shell. Encapsulation here would be
   * theatre, since anything with the file path can open its own connection.
   */
  projectionDatabase(): DatabaseSync {
    return this.db
  }

  close(): void {
    this.db.close()
  }
}

export function openLedger(filename: string): LedgerStore {
  return new LedgerStore(filename)
}
