import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalLedgerPath, LedgerOwnership, LedgerOwnershipError } from '../src/ownership.js'

describe('canonical ledger ownership', () => {
  it('excludes a second owner until the first closes', () => {
    const root = mkdtempSync(join(tmpdir(), 'pt-lock-'))
    try {
      const path = join(root, 'ledger.db')
      const owner = LedgerOwnership.acquire(path)
      expect(() => LedgerOwnership.acquire(path)).toThrow(LedgerOwnershipError)
      owner.close()
      owner.close()
      expect(() => LedgerOwnership.acquire(path).close()).not.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('excludes another process using the same canonical path', () => {
    const root = mkdtempSync(join(tmpdir(), 'pt-lock-process-'))
    try {
      const path = join(root, 'ledger.db')
      const owner = LedgerOwnership.acquire(path)
      try {
        const moduleUrl = new URL('../dist/ownership.js', import.meta.url).href
        const child = spawnSync(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `import {LedgerOwnership} from ${JSON.stringify(moduleUrl)}; try { LedgerOwnership.acquire(${JSON.stringify(path)}); process.exitCode = 2 } catch (error) { process.exitCode = error.code === 'ledger_in_use' ? 75 : 3 }`,
          ],
          { timeout: 5000 },
        )
        expect(child.status).toBe(75)
      } finally {
        owner.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('resolves a symlink alias to the same lock', () => {
    const root = mkdtempSync(join(tmpdir(), 'pt-lock-alias-'))
    try {
      const path = join(root, 'ledger.db')
      const alias = join(root, 'alias.db')
      writeFileSync(path, '')
      symlinkSync(path, alias)
      expect(canonicalLedgerPath(alias)).toBe(realpathSync(path))
      const owner = LedgerOwnership.acquire(path)
      expect(() => LedgerOwnership.acquire(alias)).toThrow(LedgerOwnershipError)
      owner.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('reclaims the OS lock after process death', () => {
    const root = mkdtempSync(join(tmpdir(), 'pt-lock-crash-'))
    try {
      const path = join(root, 'ledger.db')
      const moduleUrl = new URL('../dist/ownership.js', import.meta.url).href
      const child = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import {LedgerOwnership} from ${JSON.stringify(moduleUrl)}; LedgerOwnership.acquire(${JSON.stringify(path)}); process.kill(process.pid, 'SIGKILL')`,
        ],
        { timeout: 5000 },
      )
      expect(child.signal).toBe('SIGKILL')
      expect(() => LedgerOwnership.acquire(path).close()).not.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
