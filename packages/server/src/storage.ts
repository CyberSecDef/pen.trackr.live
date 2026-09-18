import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  type Stats,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, platform } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  LedgerOwnership,
  LedgerOwnershipError,
  type LedgerStore,
  openLedger,
  openLedgerReadOnly,
  uuidV7,
} from '@pentrackr/ledger'
import {
  applyProjectEvent,
  completeMetadataV2Input,
  ProjectReplayError,
  type ProjectView,
  replayProject,
} from '@pentrackr/project'
import {
  type CreateProjectRequest,
  type CreateProjectV2Request,
  createProjectRequestSchema,
  createProjectV2RequestSchema,
} from './contracts.js'
import { catchUpProject } from './projections.js'

export class ProjectStorageError extends Error {
  readonly code: string
  readonly field?: string
  constructor(code: string, message: string, field?: string) {
    super(message)
    this.name = 'ProjectStorageError'
    this.code = code
    if (field !== undefined) this.field = field
  }
}

export interface StoragePaths {
  dataDir: string
  projectsDir: string
}
export interface Registration {
  projectId: string
  directory: string
  availability: 'available' | 'missing' | 'inaccessible' | 'corrupt' | 'unsupported' | 'in_use'
  project: ProjectView | null
  errorCode: string | null
}
interface RegistrationRow {
  project_id: string
  directory: string
}
interface IntentRow {
  project_id: string
  staging: string
  destination: string
}

export function resolveStoragePaths(
  options: {
    dataDir?: string
    projectsDir?: string
    env?: NodeJS.ProcessEnv
    hostPlatform?: NodeJS.Platform
  } = {},
): StoragePaths {
  const env = options.env ?? process.env
  const host = options.hostPlatform ?? platform()
  const fallback =
    host === 'win32'
      ? join(env.LOCALAPPDATA ?? homedir(), 'PenTrackr')
      : host === 'darwin'
        ? join(homedir(), 'Library', 'Application Support', 'PenTrackr')
        : join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'pentrackr')
  const dataDir = validateLocalPath(
    options.dataDir ?? env.PENTRACKR_DATA_DIR ?? fallback,
    'data_dir',
    host,
  )
  const projectsDir = validateLocalPath(
    options.projectsDir ?? env.PENTRACKR_PROJECTS_DIR ?? join(dataDir, 'projects'),
    'projects_dir',
    host,
  )
  return { dataDir, projectsDir }
}

export function validateLocalPath(
  value: string,
  field: string,
  host: NodeJS.Platform = platform(),
): string {
  const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value)
  const wrong = host === 'win32' ? !windowsAbsolute : !isAbsolute(value) || windowsAbsolute
  if (wrong || value.includes('\0') || value.split(/[\\/]/).includes('..'))
    throw new ProjectStorageError('invalid_path', `invalid path for ${host}`, field)
  return resolve(value)
}

function canonicalDirectory(path: string): string {
  return realpathSync(path)
}
function pathEntry(path: string): Stats | null {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
function isSymbolicLink(path: string): boolean {
  return pathEntry(path)?.isSymbolicLink() ?? false
}
function hasOnlyCreationArtifacts(staging: string): boolean {
  const allowed = new Set([
    '.pentrackr-creation-intent',
    'ledger.db',
    'ledger.db-wal',
    'ledger.db-shm',
    'project.toml',
    'blobs',
    'vault',
    'files',
  ])
  for (const name of readdirSync(staging)) {
    if (!allowed.has(name) || isSymbolicLink(join(staging, name))) return false
    if (['blobs', 'vault', 'files'].includes(name) && readdirSync(join(staging, name)).length > 0)
      return false
  }
  return true
}
function assertPrivateDirectory(path: string): void {
  const info = statSync(path)
  if (!info.isDirectory()) throw new ProjectStorageError('invalid_path', 'expected a directory')
  if (platform() !== 'win32') {
    if (
      (info.mode & 0o077) !== 0 ||
      (process.getuid !== undefined && info.uid !== process.getuid())
    )
      throw new ProjectStorageError(
        'unsafe_permissions',
        `directory is not private to this operator: ${path}`,
      )
  }
}
function mirror(project: ProjectView): string {
  const lines = [
    'format_version = 1',
    `engagement_id = ${JSON.stringify(project.engagement_id)}`,
    `name = ${JSON.stringify(project.metadata.name)}`,
    `kind = ${JSON.stringify(project.lifecycle.kind)}`,
    `state = ${JSON.stringify(project.lifecycle.state)}`,
    `revision = ${JSON.stringify(project.revision)}`,
  ]
  return `${lines.join('\n')}\n`
}
function parseMirror(content: string): Record<string, string | number> {
  const result: Record<string, string | number> = {}
  for (const line of content.split('\n')) {
    if (line === '') continue
    const match = /^([a-z_]+) = (.+)$/.exec(line)
    if (!match || match[1] === undefined || match[2] === undefined || match[1] in result)
      throw new ProjectStorageError('corrupt_project', 'invalid project.toml')
    try {
      result[match[1]] = JSON.parse(match[2]) as string | number
    } catch {
      throw new ProjectStorageError('corrupt_project', 'invalid project.toml value')
    }
  }
  return result
}
function writeMirror(path: string, project: ProjectView): void {
  const temporary = `${path}.${uuidV7()}.tmp`
  try {
    writeFileSync(temporary, mirror(project), { flag: 'wx', mode: 0o600 })
    const handle = openSync(temporary, 'r+')
    try {
      fsyncSync(handle)
    } finally {
      closeSync(handle)
    }
    renameSync(temporary, path)
    syncDirectory(dirname(path))
  } finally {
    if (existsSync(temporary)) rmSync(temporary)
  }
}
function syncDirectory(path: string): void {
  if (platform() === 'win32') return // Node does not expose Windows directory flush handles.
  const handle = openSync(path, 'r')
  try {
    fsyncSync(handle)
  } finally {
    closeSync(handle)
  }
}
export function eventTime(now: Date): { ts_utc: string; ts_local: string; tz: string } {
  const minutes = -now.getTimezoneOffset()
  const sign = minutes < 0 ? '-' : '+'
  const absolute = Math.abs(minutes)
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
  return {
    ts_utc: now.toISOString(),
    ts_local: `${new Date(now.getTime() + minutes * 60_000).toISOString().slice(0, -1)}${offset}`,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

/** Local installation state. Engagement truth remains in each project's ledger. */
export class ProjectStorage {
  private readonly db: DatabaseSync
  private readonly coreLock: LedgerOwnership
  private readonly owned = new Map<string, { lock: LedgerOwnership; ledger: LedgerStore }>()
  readonly paths: StoragePaths
  readonly operatorId: string

  constructor(paths: StoragePaths) {
    this.paths = {
      dataDir: validateLocalPath(paths.dataDir, 'data_dir'),
      projectsDir: validateLocalPath(paths.projectsDir, 'projects_dir'),
    }
    mkdirSync(this.paths.dataDir, { recursive: true, mode: 0o700 })
    mkdirSync(this.paths.projectsDir, { recursive: true, mode: 0o700 })
    assertPrivateDirectory(this.paths.dataDir)
    assertPrivateDirectory(this.paths.projectsDir)
    this.coreLock = LedgerOwnership.acquire(join(this.paths.dataDir, 'registry.db'))
    try {
      this.db = new DatabaseSync(join(this.paths.dataDir, 'registry.db'))
    } catch (error) {
      this.coreLock.close()
      throw error
    }
    try {
      const hasMeta = this.db
        .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
        .get()
      if (hasMeta) {
        const savedVersion = this.db
          .prepare("SELECT value FROM meta WHERE key = 'format_version'")
          .get() as { value: string } | undefined
        if (savedVersion?.value !== '1')
          throw new ProjectStorageError(
            'unsupported_registry',
            `registry version ${savedVersion?.value ?? '(missing)'} is unsupported`,
          )
      }
      this.db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS registrations (project_id TEXT PRIMARY KEY, directory TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS intents (project_id TEXT PRIMARY KEY, staging TEXT NOT NULL, destination TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS switch_intents (operation_id TEXT PRIMARY KEY, from_project_id TEXT, to_project_id TEXT, generation INTEGER NOT NULL, stage TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mutation_noops (operation_id TEXT PRIMARY KEY, command_hash TEXT NOT NULL, response_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS core_audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts_utc TEXT NOT NULL, operator_id TEXT NOT NULL, operation_id TEXT NOT NULL, type TEXT NOT NULL, details TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS core_audit_no_update BEFORE UPDATE ON core_audit BEGIN SELECT RAISE(ABORT, 'core audit is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS core_audit_no_delete BEFORE DELETE ON core_audit BEGIN SELECT RAISE(ABORT, 'core audit is append-only'); END;`)
      const version = this.meta('format_version')
      if (version === null) this.setMeta('format_version', '1')
      if (this.meta('active_project_id') === null) this.setMeta('active_project_id', '')
      if (this.meta('context_generation') === null) this.setMeta('context_generation', '0')
      this.operatorId = this.meta('operator_id') ?? uuidV7()
      if (this.meta('operator_id') === null) this.setMeta('operator_id', this.operatorId)
      this.audit('core.started', uuidV7(), {})
      this.recover()
      for (const row of this.rows()) {
        try {
          this.open(row.project_id)
        } catch (error) {
          this.audit('project.unavailable', uuidV7(), {
            project_id: row.project_id,
            code:
              error instanceof LedgerOwnershipError || error instanceof ProjectStorageError
                ? error.code
                : 'storage_error',
          })
        }
      }
    } catch (error) {
      for (const owner of this.owned.values()) {
        owner.ledger.close()
        owner.lock.close()
      }
      this.db.close()
      this.coreLock.close()
      throw error
    }
  }

  private meta(key: string): string | null {
    return (
      (
        this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
          | { value: string }
          | undefined
      )?.value ?? null
    )
  }
  private setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value)
  }
  private rows(): RegistrationRow[] {
    return this.db
      .prepare('SELECT project_id, directory FROM registrations ORDER BY project_id')
      .all() as unknown as RegistrationRow[]
  }
  private audit(type: string, operationId: string, details: unknown): void {
    this.db
      .prepare(
        'INSERT INTO core_audit (ts_utc, operator_id, operation_id, type, details) VALUES (?, ?, ?, ?, ?)',
      )
      .run(new Date().toISOString(), this.operatorId, operationId, type, JSON.stringify(details))
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = fn()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private recover(): void {
    const intents = this.db.prepare('SELECT * FROM intents').all() as unknown as IntentRow[]
    for (const intent of intents) {
      const expectedStage = join(
        dirname(intent.destination),
        `.pentrackr-${intent.project_id}.staging`,
      )
      if (intent.staging !== expectedStage) continue
      if (existsSync(intent.destination)) {
        try {
          this.register(intent.destination, intent.project_id)
        } catch {
          /* retain intent for explicit repair */ continue
        }
      } else if (existsSync(intent.staging)) {
        const marker = join(intent.staging, '.pentrackr-creation-intent')
        if (!pathEntry(intent.staging)?.isDirectory() || isSymbolicLink(marker)) continue
        if (!existsSync(marker)) {
          if (readdirSync(intent.staging).length !== 0) continue
          rmSync(intent.staging, { recursive: true, force: true })
          this.db.prepare('DELETE FROM intents WHERE project_id = ?').run(intent.project_id)
          continue
        }
        let claim: unknown
        try {
          claim = JSON.parse(readFileSync(marker, 'utf8'))
        } catch {
          continue
        }
        if (
          JSON.stringify(claim) !==
          JSON.stringify({ project_id: intent.project_id, destination: intent.destination })
        )
          continue
        if (!hasOnlyCreationArtifacts(intent.staging)) continue
        rmSync(intent.staging, { recursive: true, force: true })
      }
      if (existsSync(intent.destination)) {
        const marker = join(intent.destination, '.pentrackr-creation-intent')
        if (existsSync(marker) && !isSymbolicLink(marker)) rmSync(marker)
      }
      this.db.prepare('DELETE FROM intents WHERE project_id = ?').run(intent.project_id)
    }
  }

  create(input: CreateProjectRequest): Registration {
    const request = createProjectRequestSchema.parse(input)
    return this.createInternal(request, 1)
  }

  createV2(input: CreateProjectV2Request): Registration {
    const request = createProjectV2RequestSchema.parse(input)
    return this.createInternal(request, 2)
  }

  private createInternal(
    request: CreateProjectRequest | CreateProjectV2Request,
    version: 1 | 2,
  ): Registration {
    const destination =
      request.destination === undefined
        ? join(this.paths.projectsDir, uuidV7())
        : validateLocalPath(request.destination, 'destination')
    if (pathEntry(destination) !== null)
      throw new ProjectStorageError('path_exists', 'destination already exists', 'destination')
    let parent: string
    try {
      parent = canonicalDirectory(dirname(destination))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new ProjectStorageError(
          'invalid_path',
          'destination parent does not exist',
          'destination',
        )
      throw error
    }
    const finalPath = join(parent, basename(destination))
    const id = request.destination === undefined ? basename(destination) : uuidV7()
    const staging = join(parent, `.pentrackr-${id}.staging`)
    if (pathEntry(staging) !== null)
      throw new ProjectStorageError('path_exists', 'staging path already exists')
    this.transaction(() => {
      this.db.prepare('INSERT INTO intents VALUES (?, ?, ?)').run(id, staging, finalPath)
      this.audit('project.create-intent', id, { destination: finalPath })
    })
    let published = false
    try {
      mkdirSync(staging, { mode: 0o700 })
      writeFileSync(
        join(staging, '.pentrackr-creation-intent'),
        JSON.stringify({ project_id: id, destination: finalPath }),
        { flag: 'wx', mode: 0o600 },
      )
      for (const sub of ['blobs', 'vault', 'files']) mkdirSync(join(staging, sub), { mode: 0o700 })
      const ledger = openLedger(join(staging, 'ledger.db'))
      let project: ProjectView
      try {
        const lifecycle = {
          kind: request.kind,
          state: request.kind === 'lab' ? 'lab' : 'draft',
          resume_state: null,
          closing_origin: null,
        }
        const metadata =
          version === 2
            ? completeMetadataV2Input(request.metadata, this.operatorId)
            : {
                name: request.metadata.name,
                client_name: request.metadata.client_name ?? null,
                code_name: request.metadata.code_name ?? null,
              }
        const event = ledger.append({
          event_id: uuidV7(),
          ...eventTime(new Date()),
          operator_id: this.operatorId,
          engagement_id: id,
          schema_version: version,
          type: 'engagement.created',
          payload: {
            operation_id: uuidV7(),
            command_hash: createHash('sha256')
              .update(JSON.stringify({ kind: request.kind, metadata, destination: finalPath }))
              .digest('hex'),
            metadata,
            lifecycle,
          },
        })
        project = applyProjectEvent(null, event)
      } finally {
        ledger.close()
      }
      writeMirror(join(staging, 'project.toml'), project)
      if (pathEntry(finalPath) !== null)
        throw new ProjectStorageError('path_exists', 'destination appeared during creation')
      syncDirectory(staging)
      renameSync(staging, finalPath)
      published = true
      syncDirectory(parent)
      this.register(finalPath, id)
      rmSync(join(finalPath, '.pentrackr-creation-intent'))
      this.db.prepare('DELETE FROM intents WHERE project_id = ?').run(id)
      return this.get(id)
    } catch (error) {
      if (!published && existsSync(staging)) rmSync(staging, { recursive: true, force: true })
      if (!published) this.db.prepare('DELETE FROM intents WHERE project_id = ?').run(id)
      throw error
    }
  }

  private inspect(directory: string): ProjectView {
    assertPrivateDirectory(directory)
    for (const name of ['blobs', 'vault', 'files']) {
      const path = join(directory, name)
      const entry = pathEntry(path)
      if (!entry?.isDirectory() || entry.isSymbolicLink())
        throw new ProjectStorageError(
          'corrupt_project',
          `missing or unsafe project directory: ${name}`,
        )
    }
    const file = join(directory, 'ledger.db')
    const before = pathEntry(file)
    if (before?.isSymbolicLink())
      throw new ProjectStorageError('unsafe_path', 'project ledger is a symbolic link')
    if (before === null || !before.isFile())
      throw new ProjectStorageError('missing_ledger', 'project ledger is missing')
    for (const path of [file, join(directory, 'project.toml'), join(directory, 'vault')]) {
      if (isSymbolicLink(path))
        throw new ProjectStorageError('unsafe_path', `project entry is a symbolic link: ${path}`)
    }
    const ledger = openLedgerReadOnly(file)
    try {
      const after = statSync(file)
      if (after.dev !== before.dev || after.ino !== before.ino)
        throw new ProjectStorageError('unsafe_path', 'ledger changed while opening')
      const verdict = ledger.verify()
      if (!verdict.ok)
        throw new ProjectStorageError('corrupt_project', `ledger chain broken: ${verdict.failure}`)
      const checkpoints = ledger.verifyCheckpoints()
      if (!checkpoints.ok)
        throw new ProjectStorageError(
          'corrupt_project',
          `ledger checkpoints broken: ${checkpoints.failure}`,
        )
      const events = ledger.read()
      const first = events[0]?.envelope
      if (first?.type !== 'engagement.created' || first.prev_hash !== null)
        throw new ProjectStorageError(
          'unsupported_project',
          'recognized engagement.created genesis is required',
        )
      const id = first.engagement_id
      if (events.some((entry) => entry.envelope.engagement_id !== id))
        throw new ProjectStorageError(
          'corrupt_project',
          'project contains another engagement identity',
        )
      let project: ProjectView
      try {
        project = replayProject(events)
      } catch (error) {
        if (error instanceof ProjectReplayError)
          throw new ProjectStorageError(error.code, error.message)
        throw error
      }
      const markerPath = join(directory, 'project.toml')
      if (existsSync(markerPath)) {
        const saved = parseMirror(readFileSync(markerPath, 'utf8'))
        if (saved.format_version !== 1)
          throw new ProjectStorageError('unsupported_project', 'unsupported project format')
        if (saved.engagement_id !== id)
          throw new ProjectStorageError(
            'identity_conflict',
            'project marker identity conflicts with ledger',
          )
      }
      return project
    } finally {
      ledger.close()
    }
  }

  register(path: string, expectedId?: string): Registration {
    const directory = canonicalDirectory(validateLocalPath(path, 'directory'))
    const existing = this.rows().find((row) => row.directory === directory)
    if (existing && this.owned.has(existing.project_id)) {
      if (expectedId !== undefined && expectedId !== existing.project_id)
        throw new ProjectStorageError('identity_conflict', 'project identity changed')
      return this.get(existing.project_id)
    }
    const lock = LedgerOwnership.acquire(join(directory, 'ledger.db'))
    let project: ProjectView
    try {
      project = this.inspect(directory)
    } catch (error) {
      lock.close()
      throw error
    }
    const id = project.engagement_id
    if (expectedId !== undefined && id !== expectedId) {
      lock.close()
      throw new ProjectStorageError('identity_conflict', 'created project identity changed')
    }
    const duplicate = this.rows().find(
      (row) => row.project_id === id || row.directory === directory,
    )
    if (duplicate && (duplicate.project_id !== id || duplicate.directory !== directory)) {
      lock.close()
      throw new ProjectStorageError(
        'registration_conflict',
        'project ID or path is already registered',
      )
    }
    let ledger: LedgerStore | undefined
    try {
      ledger = openLedger(join(directory, 'ledger.db'))
      if (ledger.head()?.this_hash !== project.revision)
        throw new ProjectStorageError('unsafe_path', 'ledger changed after verification')
      const projected = catchUpProject(ledger)
      if (JSON.stringify(projected) !== JSON.stringify(project))
        throw new ProjectStorageError(
          'invalid_history',
          'project projection differs from verified history',
        )
      const markerPath = join(directory, 'project.toml')
      if (!existsSync(markerPath) || readFileSync(markerPath, 'utf8') !== mirror(project))
        writeMirror(markerPath, project)
      if (!duplicate)
        this.transaction(() => {
          this.db.prepare('INSERT INTO registrations VALUES (?, ?)').run(id, directory)
          this.audit('project.registered', uuidV7(), { project_id: id, directory })
        })
      const previous = this.owned.get(id)
      if (previous) {
        ledger.close()
        lock.close()
      } else this.owned.set(id, { lock, ledger })
      return {
        projectId: id,
        directory,
        availability: 'available',
        project,
        errorCode: null,
      }
    } catch (error) {
      ledger?.close()
      lock.close()
      throw error
    }
  }

  open(id: string): ProjectView {
    const row = this.rows().find((item) => item.project_id === id)
    if (!row) throw new ProjectStorageError('project_not_found', 'project is not registered')
    if (this.owned.has(id)) return this.inspectRead(id)
    return this.register(row.directory, id).project as ProjectView
  }
  private inspectRead(id: string): ProjectView {
    const owned = this.owned.get(id)
    if (!owned) throw new ProjectStorageError('project_not_found', 'project not open')
    try {
      return catchUpProject(owned.ledger)
    } catch (error) {
      if (error instanceof ProjectReplayError)
        throw new ProjectStorageError(error.code, error.message)
      throw error
    }
  }
  /** The mutation service uses the already-owned ledger, never a fresh path open. */
  ledgerForMutation(id: string): LedgerStore {
    const owned = this.owned.get(id)
    if (!owned) this.open(id)
    const current = this.owned.get(id)
    if (!current) throw new ProjectStorageError('project_not_found', 'project is not open')
    return current.ledger
  }
  findMutationEvent(
    operationId: string,
  ): { projectId: string; seq: number; event: ReturnType<LedgerStore['head']> } | null {
    for (const [projectId, owned] of this.owned) {
      for (const entry of owned.ledger.read()) {
        const payload = entry.envelope.payload
        if (
          payload !== null &&
          typeof payload === 'object' &&
          'operation_id' in payload &&
          payload.operation_id === operationId
        )
          return { projectId, seq: entry.seq, event: entry.envelope }
      }
    }
    return null
  }
  readMutationNoop(operationId: string): { commandHash: string; response: unknown } | null {
    const row = this.db
      .prepare('SELECT command_hash, response_json FROM mutation_noops WHERE operation_id = ?')
      .get(operationId) as { command_hash: string; response_json: string } | undefined
    return row ? { commandHash: row.command_hash, response: JSON.parse(row.response_json) } : null
  }
  saveMutationNoop(operationId: string, commandHash: string, response: unknown): void {
    this.transaction(() => {
      this.db
        .prepare('INSERT INTO mutation_noops VALUES (?, ?, ?)')
        .run(operationId, commandHash, JSON.stringify(response))
    })
  }
  get(id: string): Registration {
    const row = this.rows().find((item) => item.project_id === id)
    if (!row) throw new ProjectStorageError('project_not_found', 'project is not registered')
    try {
      return {
        projectId: id,
        directory: row.directory,
        availability: 'available',
        project: this.open(id),
        errorCode: null,
      }
    } catch (error) {
      const code =
        error instanceof LedgerOwnershipError
          ? 'in_use'
          : error instanceof ProjectStorageError
            ? error.code
            : 'inaccessible'
      const availability = !existsSync(row.directory)
        ? 'missing'
        : code === 'in_use'
          ? 'in_use'
          : code === 'unsupported_project'
            ? 'unsupported'
            : code === 'inaccessible' || code === 'unsafe_permissions'
              ? 'inaccessible'
              : 'corrupt'
      return {
        projectId: id,
        directory: row.directory,
        availability,
        project: null,
        errorCode: code,
      }
    }
  }
  list(): Registration[] {
    return this.rows().map((row) => this.get(row.project_id))
  }
  unregister(id: string): {
    operation_id: string
    project_id: string
    warnings: Array<{ code: 'files_preserved' | 'path_unavailable'; path: string; message: string }>
  } {
    const row = this.rows().find((item) => item.project_id === id)
    if (!row) throw new ProjectStorageError('project_not_found', 'project is not registered')
    if (this.meta('active_project_id') === id)
      throw new ProjectStorageError('project_active', 'switch away before unregistering')
    const operationId = uuidV7()
    this.transaction(() => {
      this.db.prepare('DELETE FROM registrations WHERE project_id = ?').run(id)
      this.audit('project.unregistered', operationId, { project_id: id, directory: row.directory })
    })
    const owned = this.owned.get(id)
    if (owned) {
      owned.ledger.close()
      owned.lock.close()
      this.owned.delete(id)
    }
    const warnings: Array<{
      code: 'files_preserved' | 'path_unavailable'
      path: string
      message: string
    }> = [
      {
        code: 'files_preserved',
        path: row.directory,
        message: `Project files remain at ${row.directory}. Register this directory again to restore access.`,
      },
    ]
    if (!existsSync(row.directory))
      warnings.push({
        code: 'path_unavailable',
        path: row.directory,
        message: 'The registered directory is unavailable.',
      })
    return { operation_id: operationId, project_id: id, warnings }
  }
  close(): void {
    for (const owned of this.owned.values()) {
      owned.ledger.close()
      owned.lock.close()
    }
    this.owned.clear()
    this.db.close()
    this.coreLock.close()
  }
}
