import Database from 'better-sqlite3'
import { decode } from './cbor-decode.js'
import { type CborValue, encode } from './cbor.js'
import { type ChainVerdict, appendEvent, computeHash, unsealed, verifyChain } from './chain.js'
import { type Envelope, type UnhashedEnvelope, parseEnvelope } from './envelope.js'
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
  readonly payload: Buffer
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

function rowToEnvelope(row: EventRow): Envelope {
  const payload = decode(new Uint8Array(row.payload))
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new LedgerStoreError(`event ${row.event_id} has a payload that is not a map`)
  }

  return parseEnvelope({
    event_id: row.event_id,
    prev_hash: row.prev_hash,
    ts_utc: row.ts_utc,
    ts_local: row.ts_local,
    tz: row.tz,
    operator_id: row.operator_id,
    engagement_id: row.engagement_id,
    schema_version: row.schema_version,
    type: row.type,
    payload: payload as Record<string, CborValue>,
    this_hash: row.this_hash,
  })
}

export class LedgerStore {
  private readonly db: Database.Database

  constructor(filename: string) {
    this.db = new Database(filename)
    // WAL for concurrent readers; FULL so a completed append survives a process
    // death rather than sitting in an OS buffer (NFR-006).
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = FULL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(SCHEMA)

    const existing = this.meta('schema_version')
    if (existing === null) {
      this.setMeta('schema_version', String(SCHEMA_VERSION))
    } else if (Number(existing) !== SCHEMA_VERSION) {
      throw new LedgerStoreError(
        `ledger schema version ${existing} is not supported by this build (expected ${SCHEMA_VERSION})`,
      )
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
    return row.n
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

    const transaction = this.db.transaction((candidate: Omit<UnhashedEnvelope, 'prev_hash'>) => {
      const sealed = appendEvent(this.head(), candidate)
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
        payload: Buffer.from(encode(sealed.payload as CborValue)),
      })
      return sealed
    })

    return transaction(event)
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
      .all(...parameters) as EventRow[]

    return rows.map((row) => ({ seq: row.seq, envelope: rowToEnvelope(row) }))
  }

  /** Verifies the whole chain as stored, reconstructing each event from its columns. */
  verify(): ChainVerdict {
    return verifyChain(this.read().map((stored) => stored.envelope))
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
      .all() as CheckpointRow[]
    return rows.map((row) => ({
      seq: row.seq,
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

  close(): void {
    this.db.close()
  }
}

export function openLedger(filename: string): LedgerStore {
  return new LedgerStore(filename)
}
