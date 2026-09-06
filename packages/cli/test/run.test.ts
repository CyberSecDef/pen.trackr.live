import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { type LedgerStore, generateSigningKeyPair, openLedger } from '@pentrackr/ledger'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { USAGE, run } from '../src/run.js'
import { buildInfo, formatVersion } from '../src/version.js'

const keys = generateSigningKeyPair()

describe('argv handling', () => {
  const deps = { openLedger, env: {} }

  it('prints usage with no arguments', () => {
    expect(run([], deps)).toEqual({ stdout: USAGE, exitCode: 0 })
  })

  it.each(['-h', '--help', 'help'])('prints usage for %s', (flag) => {
    expect(run([flag], deps).exitCode).toBe(0)
  })

  it.each(['-V', '--version', 'version'])('prints version for %s', (flag) => {
    const result = run([flag], deps)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/^pentrackr \d+\.\d+\.\d+ /)
  })

  it('exits EX_USAGE on an unknown command', () => {
    const result = run(['nope'], deps)
    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain("unknown command 'nope'")
  })

  it.each(['verify', 'seal', 'log'])('requires a ledger path for %s', (command) => {
    const result = run([command], { openLedger, env: { PENTRACKR_SIGNING_KEY: keys.privateKey } })
    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain('ledger path is required')
  })

  it('does not mistake an option for a path', () => {
    expect(run(['verify', '--limit', '3'], deps).exitCode).toBe(64)
  })
})

describe('formatVersion', () => {
  it('reports a working-tree build when no commit is stamped', () => {
    expect(formatVersion({ ...buildInfo(), commit: null })).toContain('(working tree)')
  })

  it('truncates a stamped commit to 12 characters', () => {
    expect(formatVersion({ ...buildInfo(), commit: 'a'.repeat(40) })).toContain(
      `(${'a'.repeat(12)})`,
    )
  })

  it('reports the running node version and platform', () => {
    const text = formatVersion(buildInfo())
    expect(text).toContain(`node ${process.versions.node}`)
    expect(text).toContain(`${process.platform}/${process.arch}`)
  })
})

describe('keygen', () => {
  it('emits a usable key pair and says how to store it', () => {
    const result = run(['keygen'], { openLedger, env: {} })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/public {2}[0-9a-f]{64}/)
    expect(result.stdout).toMatch(/private [0-9a-f]{64}/)
    expect(result.stdout).toContain('PENTRACKR_SIGNING_KEY')
  })
})

describe('ledger commands', () => {
  let directory: string
  let path: string
  let store: LedgerStore

  const deps = (env: Record<string, string | undefined> = {}) => ({ openLedger, env })

  const appendEvents = (count: number): void => {
    const operator = '01999999-0000-7000-8000-000000000001'
    for (let i = 0; i < count; i += 1) {
      store.append({
        event_id: `0199${String(i).padStart(4, '0')}-0000-7000-8000-00000000000${i % 10}`,
        ts_utc: '2026-09-05T21:00:00.000Z',
        ts_local: '2026-09-05T17:00:00.000-04:00',
        tz: 'UTC',
        operator_id: operator,
        engagement_id: operator,
        schema_version: 1,
        type: i % 2 === 0 ? 'command.started' : 'command.finished',
        payload: { index: i },
      })
    }
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pentrackr-cli-'))
    path = join(directory, 'ledger.db')
    store = openLedger(path)
  })

  afterEach(() => {
    try {
      store.close()
    } catch {
      // already closed
    }
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  describe('verify', () => {
    it('reports an empty ledger as ok', () => {
      store.close()
      const result = run(['verify', path], deps())
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('chain ok: 0 events')
    })

    it('reports a healthy chain with its head', () => {
      appendEvents(3)
      const head = store.head()?.this_hash
      store.close()

      const result = run(['verify', path], deps())
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('chain ok: 3 events')
      expect(result.stdout).toContain(head ?? 'missing')
    })

    it('warns that truncation is undetectable without checkpoints', () => {
      appendEvents(2)
      store.close()
      expect(run(['verify', path], deps()).stdout).toContain(
        'truncation of the tail is undetectable',
      )
    })

    it('suggests pinning a key when checkpoints exist but none was given', () => {
      appendEvents(2)
      store.checkpoint(keys.privateKey)
      store.close()
      expect(run(['verify', path], deps()).stdout).toContain('pass --public-key')
    })

    it('accepts a pinned public key', () => {
      appendEvents(2)
      store.checkpoint(keys.privateKey)
      store.close()
      const result = run(['verify', path, '--public-key', keys.publicKey], deps())
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('checkpoints ok: 1 signed')
    })

    it('fails when checkpoints were signed by another key', () => {
      appendEvents(2)
      store.checkpoint(generateSigningKeyPair().privateKey)
      store.close()
      const result = run(['verify', path, '--public-key', keys.publicKey], deps())
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('unexpected-key')
    })

    it('reports a broken chain with the failing event', () => {
      appendEvents(4)
      store.close()
      const raw = new DatabaseSync(path)
      raw.exec('DROP TRIGGER events_no_delete')
      raw.exec('DELETE FROM events WHERE seq = 2')
      raw.close()

      const result = run(['verify', path], deps())
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('chain BROKEN at event 1')
      expect(result.stdout).toContain('broken-link')
    })

    it('reports truncation detected by a checkpoint', () => {
      appendEvents(6)
      store.checkpoint(keys.privateKey)
      store.close()
      const raw = new DatabaseSync(path)
      raw.exec('DROP TRIGGER events_no_delete')
      raw.exec('DELETE FROM events WHERE seq > 3')
      raw.close()

      const result = run(['verify', path], deps())
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('truncated')
    })

    it('reports a data error for a path that is not a ledger', () => {
      const result = run(['verify', join(directory, 'nope', 'x.db')], deps())
      expect(result.exitCode).toBe(65)
      expect(result.stdout).toContain('cannot open ledger')
    })
  })

  describe('seal', () => {
    it('refuses to take a signing key from the command line', () => {
      // The key would land in shell history, ps output, and eventually this
      // tool's own command ledger.
      appendEvents(1)
      store.close()
      const result = run(['seal', path], deps({}))
      expect(result.exitCode).toBe(64)
      expect(result.stdout).toContain('PENTRACKR_SIGNING_KEY is not set')
      expect(result.stdout).toContain('shell history')
    })

    it('treats an empty key variable as unset', () => {
      expect(run(['seal', path], deps({ PENTRACKR_SIGNING_KEY: '' })).exitCode).toBe(64)
    })

    it('signs a checkpoint from the environment key', () => {
      appendEvents(3)
      const head = store.head()?.this_hash
      store.close()

      const result = run(['seal', path], deps({ PENTRACKR_SIGNING_KEY: keys.privateKey }))
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('events    3')
      expect(result.stdout).toContain(head ?? 'missing')
      expect(result.stdout).toContain(keys.publicKey)
    })

    it('reports a malformed key as a data error', () => {
      appendEvents(1)
      store.close()
      const result = run(['seal', path], deps({ PENTRACKR_SIGNING_KEY: 'not-a-key' }))
      expect(result.exitCode).toBe(65)
    })

    it('makes the ledger verify against the sealed key afterwards', () => {
      appendEvents(2)
      store.close()
      run(['seal', path], deps({ PENTRACKR_SIGNING_KEY: keys.privateKey }))
      expect(run(['verify', path, '--public-key', keys.publicKey], deps()).exitCode).toBe(0)
    })
  })

  describe('log', () => {
    it('reports an empty ledger', () => {
      store.close()
      expect(run(['log', path], deps()).stdout).toBe('(no events)')
    })

    it('lists events oldest first', () => {
      appendEvents(3)
      store.close()
      const lines = run(['log', path], deps()).stdout.split('\n')
      expect(lines).toHaveLength(3)
      expect(lines[0]).toContain('command.started')
    })

    it('builds the projection on demand', () => {
      // No explicit rebuild step: the projection is derived, so the command
      // just catches it up.
      appendEvents(2)
      store.close()
      expect(run(['log', path], deps()).stdout.split('\n')).toHaveLength(2)
    })

    it('filters by type', () => {
      appendEvents(4)
      store.close()
      const lines = run(['log', path, '--type', 'command.finished'], deps()).stdout.split('\n')
      expect(lines).toHaveLength(2)
      for (const line of lines) expect(line).toContain('command.finished')
    })

    it('limits the number of rows', () => {
      appendEvents(10)
      store.close()
      expect(run(['log', path, '--limit', '4'], deps()).stdout.split('\n')).toHaveLength(4)
    })

    it.each(['0', '-1', 'abc'])('rejects the invalid limit %s', (limit) => {
      appendEvents(1)
      store.close()
      expect(run(['log', path, '--limit', limit], deps()).exitCode).toBe(64)
    })
  })
})

/**
 * Regression tests for review findings on PR #2.
 *
 * The first is the one that mattered: a flag present without its value was
 * treated as absent, so key pinning was silently skipped.
 */
describe('an option present without a value is a usage error', () => {
  const deps = { openLedger, env: {} }
  let scratch: string
  let ledger: string

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'pentrackr-usage-'))
    ledger = join(scratch, 'x.db')
  })

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  it.each([
    ['verify', (p: string) => ['verify', p, '--public-key']],
    ['log --limit', (p: string) => ['log', p, '--limit']],
    ['log --type', (p: string) => ['log', p, '--type']],
  ])('rejects %s with no value', (_label, build) => {
    const result = run(build(ledger), deps)
    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain('requires a value')
  })

  it('rejects a flag followed by another flag', () => {
    const result = run(['log', ledger, '--type', '--limit', '5'], deps)
    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain('--limit')
  })

  it('names the offending option', () => {
    expect(run(['verify', ledger, '--public-key'], deps).stdout).toContain('--public-key')
  })

  it.each([
    ['verify', (p: string) => ['verify', p, '--public-key']],
    ['log', (p: string) => ['log', p, '--limit']],
  ])('does not create a ledger file when %s is malformed', (_label, build) => {
    // Opening a ledger creates it. Validating options afterwards meant a
    // mistyped command left an empty database behind — which is also how a
    // stray x.db reached a commit in this repository.
    run(build(ledger), deps)
    expect(existsSync(ledger)).toBe(false)
  })

  it('does not create a ledger file for an invalid --limit', () => {
    expect(run(['log', ledger, '--limit', '0'], deps).exitCode).toBe(64)
    expect(existsSync(ledger)).toBe(false)
  })
})
