import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { LedgerOwnership, LedgerOwnershipError, openLedger, uuidV7 } from '@pentrackr/ledger'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../../cli/src/run.js'
import { unregisterResponseSchema } from '../src/contracts.js'
import { ProjectStorage, ProjectStorageError, validateLocalPath } from '../src/storage.js'

describe('project storage', () => {
  let root: string
  let storage: ProjectStorage
  const open = (root: string) =>
    new ProjectStorage({ dataDir: join(root, 'core'), projectsDir: join(root, 'projects') })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pentrackr-project-'))
    storage = open(root)
  })
  afterEach(() => {
    try {
      storage.close()
    } catch {
      /* already closed */
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('creates an isolated, verified Lab project and preserves its identity across restart', () => {
    const created = storage.create({ kind: 'lab', metadata: { name: '  Lab case  ' } })
    expect(created.project?.metadata.name).toBe('Lab case')
    expect(created.project?.lifecycle.state).toBe('lab')
    for (const path of ['ledger.db', 'project.toml', 'blobs', 'vault', 'files'])
      expect(existsSync(join(created.directory, path))).toBe(true)
    const operatorId = storage.operatorId
    storage.close()
    const ledger = openLedger(join(created.directory, 'ledger.db'))
    expect(ledger.read({ limit: 1 })[0]?.envelope.operator_id).toBe(operatorId)
    expect(ledger.verify().ok).toBe(true)
    ledger.close()
    storage = open(root)
    expect(storage.operatorId).toBe(operatorId)
    expect(storage.get(created.projectId).project).toEqual(created.project)
    expect(storage.list()).toHaveLength(1)
  })

  it('keeps project files after unregister and permits re-registration', () => {
    const created = storage.create({ kind: 'engagement', metadata: { name: 'Client' } })
    const result = storage.unregister(created.projectId)
    expect(unregisterResponseSchema.safeParse(result).success).toBe(true)
    expect(result.warnings[0]?.code).toBe('files_preserved')
    expect(result.warnings[0]?.path).toBe(created.directory)
    expect(existsSync(join(created.directory, 'ledger.db'))).toBe(true)
    expect(storage.list()).toEqual([])
    expect(storage.register(created.directory).projectId).toBe(created.projectId)
  })

  it.skipIf(process.platform === 'win32')(
    'rejects ledger substitution and conflicting registration identities',
    () => {
      const first = storage.create({ kind: 'lab', metadata: { name: 'First' } })
      const second = storage.create({ kind: 'lab', metadata: { name: 'Second' } })
      expect(() => storage.register(second.directory, first.projectId)).toThrow(ProjectStorageError)
      storage.close()
      const ledger = join(first.directory, 'ledger.db')
      renameSync(ledger, `${ledger}.saved`)
      symlinkSync(`${ledger}.saved`, ledger)
      storage = open(root)
      expect(storage.get(first.projectId).errorCode).toBe('unsafe_path')
    },
  )

  it('recovers a published project from an outstanding creation intent', () => {
    const created = storage.create({ kind: 'lab', metadata: { name: 'Recover' } })
    storage.close()
    const db = new DatabaseSync(join(root, 'core', 'registry.db'))
    db.prepare('DELETE FROM registrations WHERE project_id = ?').run(created.projectId)
    db.prepare('INSERT INTO intents VALUES (?, ?, ?)').run(
      created.projectId,
      join(dirname(created.directory), `.pentrackr-${created.projectId}.staging`),
      created.directory,
    )
    db.close()
    storage = open(root)
    expect(storage.get(created.projectId).availability).toBe('available')
  })

  it('does not remove a directory named by a malformed recovery intent', () => {
    storage.close()
    const unrelated = join(root, 'important')
    mkdirSync(unrelated)
    writeFileSync(join(unrelated, 'notes.txt'), 'keep')
    const db = new DatabaseSync(join(root, 'core', 'registry.db'))
    db.prepare('INSERT INTO intents VALUES (?, ?, ?)').run(
      '01999999-0000-7000-8000-000000000001',
      unrelated,
      join(root, 'absent'),
    )
    db.close()
    storage = open(root)
    expect(readFileSync(join(unrelated, 'notes.txt'), 'utf8')).toBe('keep')
  })

  it('cleans only an empty staging directory named by a valid intent', () => {
    storage.close()
    const id = '01999999-0000-7000-8000-000000000001'
    const destination = join(root, 'projects', id)
    const staging = join(root, 'projects', `.pentrackr-${id}.staging`)
    mkdirSync(staging)
    const db = new DatabaseSync(join(root, 'core', 'registry.db'))
    db.prepare('INSERT INTO intents VALUES (?, ?, ?)').run(id, staging, destination)
    db.close()
    storage = open(root)
    expect(existsSync(staging)).toBe(false)
    expect(existsSync(destination)).toBe(false)
  })

  it('retains unexpected files in a staged directory for manual recovery', () => {
    storage.close()
    const id = '01999999-0000-7000-8000-000000000001'
    const destination = join(root, 'projects', id)
    const staging = join(root, 'projects', `.pentrackr-${id}.staging`)
    mkdirSync(staging)
    writeFileSync(
      join(staging, '.pentrackr-creation-intent'),
      JSON.stringify({ project_id: id, destination }),
    )
    writeFileSync(join(staging, 'operator-notes.txt'), 'keep')
    const db = new DatabaseSync(join(root, 'core', 'registry.db'))
    db.prepare('INSERT INTO intents VALUES (?, ?, ?)').run(id, staging, destination)
    db.close()
    storage = open(root)
    expect(readFileSync(join(staging, 'operator-notes.txt'), 'utf8')).toBe('keep')
  })

  it('keeps core audit rows append-only', () => {
    storage.create({ kind: 'lab', metadata: { name: 'Audit' } })
    const db = new DatabaseSync(join(root, 'core', 'registry.db'))
    try {
      expect(() => db.exec('DELETE FROM core_audit')).toThrow('core audit is append-only')
    } finally {
      db.close()
    }
  })

  it.skipIf(process.platform === 'win32')('refuses a shared core data directory', () => {
    storage.close()
    chmodSync(join(root, 'core'), 0o755)
    expect(() => open(root)).toThrow(ProjectStorageError)
  })

  it('rejects an unsupported registry before changing its schema', () => {
    const other = mkdtempSync(join(root, 'unsupported-'))
    const db = new DatabaseSync(join(other, 'registry.db'))
    db.exec(
      "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('format_version', '99')",
    )
    db.close()
    expect(
      () => new ProjectStorage({ dataDir: other, projectsDir: join(other, 'projects') }),
    ).toThrow(ProjectStorageError)
    const check = new DatabaseSync(join(other, 'registry.db'))
    expect(
      check.prepare("SELECT name FROM sqlite_master WHERE name = 'registrations'").get(),
    ).toBeUndefined()
    check.close()
  })

  it('reports missing registered paths without manufacturing an empty ledger', () => {
    const created = storage.create({ kind: 'lab', metadata: { name: 'Gone' } })
    storage.close()
    renameSync(created.directory, `${created.directory}.moved`)
    storage = open(root)
    expect(storage.get(created.projectId).availability).toBe('missing')
    expect(existsSync(created.directory)).toBe(false)
  })

  it('reports a missing reserved directory rather than silently replacing it', () => {
    const created = storage.create({ kind: 'lab', metadata: { name: 'Incomplete' } })
    storage.close()
    rmSync(join(created.directory, 'vault'), { recursive: true })
    storage = open(root)
    expect(storage.get(created.projectId).availability).toBe('corrupt')
    expect(existsSync(join(created.directory, 'vault'))).toBe(false)
  })

  it('does not treat a standalone M1 ledger as an engagement project', () => {
    const directory = join(root, 'projects', 'standalone')
    mkdirSync(directory)
    for (const name of ['blobs', 'vault', 'files']) mkdirSync(join(directory, name))
    const ledger = openLedger(join(directory, 'ledger.db'))
    ledger.close()
    expect(() => storage.register(directory)).toThrow(ProjectStorageError)
    expect(storage.list()).toEqual([])
  })

  it('refuses later history until typed replay is implemented', () => {
    const created = storage.create({ kind: 'lab', metadata: { name: 'Future' } })
    storage.close()
    const ledger = openLedger(join(created.directory, 'ledger.db'))
    ledger.append({
      event_id: uuidV7(),
      ts_utc: '2026-09-17T18:00:00.000Z',
      ts_local: '2026-09-17T18:00:00.000Z',
      tz: 'UTC',
      operator_id: created.projectId,
      engagement_id: created.projectId,
      schema_version: 1,
      type: 'manual.logged',
      payload: {},
    })
    ledger.close()
    storage = open(root)
    expect(storage.get(created.projectId).availability).toBe('unsupported')
  })

  it('rejects marker identity conflicts and repairs a stale mirror', () => {
    const created = storage.create({ kind: 'lab', metadata: { name: 'Source' } })
    storage.close()
    const marker = join(created.directory, 'project.toml')
    writeFileSync(marker, readFileSync(marker, 'utf8').replace('Source', 'Stale'))
    storage = open(root)
    expect(readFileSync(marker, 'utf8')).toContain('Source')
    storage.close()
    writeFileSync(
      marker,
      readFileSync(marker, 'utf8').replace(
        created.projectId,
        '01999999-0000-7000-8000-000000000001',
      ),
    )
    storage = open(root)
    expect(storage.get(created.projectId).errorCode).toBe('identity_conflict')
  })

  it('resolves directory aliases and refuses another core for the same data directory', () => {
    const created = storage.create({ kind: 'lab', metadata: { name: 'Alias' } })
    const alias = join(root, 'alias')
    symlinkSync(created.directory, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(storage.register(alias).projectId).toBe(created.projectId)
    expect(storage.list()).toHaveLength(1)
    expect(() => open(root)).toThrow(LedgerOwnershipError)
  })

  it('excludes offline CLI maintenance while the core owns a project', () => {
    const created = storage.create({ kind: 'lab', metadata: { name: 'Owned' } })
    const result = run(['verify', join(created.directory, 'ledger.db')], { openLedger, env: {} })
    expect(result.exitCode).toBe(75)
    expect(result.stdout).toContain('ledger_in_use')
    storage.close()
    const lock = LedgerOwnership.acquire(join(created.directory, 'ledger.db'))
    try {
      storage = open(root)
      expect(storage.get(created.projectId).availability).toBe('in_use')
    } finally {
      lock.close()
    }
    expect(storage.open(created.projectId).engagement_id).toBe(created.projectId)
  })

  it('rejects invalid destinations before creating a project', () => {
    expect(() =>
      storage.create({ kind: 'lab', metadata: { name: 'Bad' }, destination: 'C:\\tmp\\case' }),
    ).toThrow(ProjectStorageError)
    expect(storage.list()).toEqual([])
    expect(() => validateLocalPath('C:\\tmp\\case', 'destination', 'linux')).toThrow(
      ProjectStorageError,
    )
    expect(() => validateLocalPath(`${root}/projects/../elsewhere`, 'destination')).toThrow(
      ProjectStorageError,
    )
    const dangling = join(root, 'projects', 'dangling')
    if (process.platform !== 'win32') {
      symlinkSync(join(root, 'absent'), dangling)
      expect(() =>
        storage.create({ kind: 'lab', metadata: { name: 'Bad' }, destination: dangling }),
      ).toThrow(ProjectStorageError)
    }
  })
})

describe('ledger ownership', () => {
  it('excludes a second owner and releases the lock when closed', () => {
    const root = mkdtempSync(join(tmpdir(), 'pentrackr-owner-'))
    try {
      const path = join(root, 'ledger.db')
      const first = LedgerOwnership.acquire(path)
      expect(() => LedgerOwnership.acquire(path)).toThrow(LedgerOwnershipError)
      first.close()
      expect(() => LedgerOwnership.acquire(path).close()).not.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('recovers after the owning process is killed', () => {
    const root = mkdtempSync(join(tmpdir(), 'pentrackr-owner-crash-'))
    const path = join(root, 'ledger.db')
    const moduleUrl = new URL('../../ledger/dist/ownership.js', import.meta.url).href
    try {
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

describe('core crash recovery', () => {
  it.skipIf(process.platform === 'win32')(
    'reopens a project after the owning core process dies',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'pentrackr-core-crash-'))
      try {
        const moduleUrl = new URL('../dist/storage.js', import.meta.url).href
        const script = `import {ProjectStorage} from ${JSON.stringify(moduleUrl)}; const core = new ProjectStorage({dataDir:${JSON.stringify(join(root, 'core'))},projectsDir:${JSON.stringify(join(root, 'projects'))}}); core.create({kind:'lab',metadata:{name:'Crash recovery'}}); process.kill(process.pid,'SIGKILL')`
        const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
          timeout: 5000,
        })
        expect(child.signal).toBe('SIGKILL')
        const core = new ProjectStorage({
          dataDir: join(root, 'core'),
          projectsDir: join(root, 'projects'),
        })
        try {
          expect(core.list()).toHaveLength(1)
          expect(core.list()[0]?.project?.metadata.name).toBe('Crash recovery')
        } finally {
          core.close()
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
})
