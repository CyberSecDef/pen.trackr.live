import { lstatSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export class LedgerOwnershipError extends Error {
  readonly code: 'ledger_in_use' | 'locking_unavailable'
  constructor(code: 'ledger_in_use' | 'locking_unavailable', message: string) {
    super(message)
    this.name = 'LedgerOwnershipError'
    this.code = code
  }
}

/** Resolve aliases before choosing a lock identity. An absent ledger is allowed. */
export function canonicalLedgerPath(filename: string): string {
  const absolute = resolve(filename)
  try {
    return realpathSync(absolute)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    try {
      if (lstatSync(absolute).isSymbolicLink())
        throw new LedgerOwnershipError(
          'locking_unavailable',
          'ledger path is a dangling symbolic link',
        )
    } catch (entryError) {
      if ((entryError as NodeJS.ErrnoException).code !== 'ENOENT') throw entryError
    }
    return join(realpathSync(dirname(absolute)), basename(absolute))
  }
}

/**
 * A dedicated SQLite rollback-journal database supplies an OS-held exclusive
 * file lock. Unlike a lockfile containing a PID, its lock is released by the OS
 * when the process dies. Keep the transaction open until every ledger handle
 * has closed. The sidecar is deliberately never unlinked: unlinking a live lock
 * would allow a second inode (and therefore a second owner) at the same path.
 */
export class LedgerOwnership {
  private closed = false
  readonly ledgerPath: string
  private readonly db: DatabaseSync

  private constructor(ledgerPath: string, db: DatabaseSync) {
    this.ledgerPath = ledgerPath
    this.db = db
  }

  static acquire(filename: string): LedgerOwnership {
    const ledgerPath = canonicalLedgerPath(filename)
    const lockPath = `${ledgerPath}.owner.db`
    let db: DatabaseSync | undefined
    try {
      try {
        const entry = lstatSync(lockPath)
        if (!entry.isFile() || entry.isSymbolicLink())
          throw new LedgerOwnershipError(
            'locking_unavailable',
            'ownership path is not a regular file',
          )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      db = new DatabaseSync(lockPath, { timeout: 0 })
      db.exec('PRAGMA journal_mode = DELETE')
      db.exec('BEGIN EXCLUSIVE')
      const probe = new DatabaseSync(lockPath, { timeout: 0 })
      try {
        let excluded = false
        try {
          probe.exec('BEGIN EXCLUSIVE')
          probe.exec('ROLLBACK')
        } catch (error) {
          if (/locked|busy/i.test((error as Error).message)) excluded = true
          else throw error
        }
        if (!excluded)
          throw new LedgerOwnershipError(
            'locking_unavailable',
            'filesystem did not enforce exclusive ownership',
          )
      } finally {
        probe.close()
      }
    } catch (error) {
      if (error instanceof LedgerOwnershipError) throw error
      const message = (error as Error).message
      db?.close()
      if (/locked|busy/i.test(message)) {
        throw new LedgerOwnershipError(
          'ledger_in_use',
          `ledger_in_use: ${ledgerPath} is owned by another process; stop the owning core first`,
        )
      }
      throw new LedgerOwnershipError('locking_unavailable', `locking unavailable: ${message}`)
    }
    return new LedgerOwnership(ledgerPath, db)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.db.exec('ROLLBACK')
    } finally {
      this.db.close()
    }
  }
}
