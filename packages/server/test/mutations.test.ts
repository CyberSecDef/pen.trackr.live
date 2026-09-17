import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLedger, uuidV7 } from '@pentrackr/ledger'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectMutationService } from '../src/mutations.js'
import { rebuildProject } from '../src/projections.js'
import { ProjectStorage } from '../src/storage.js'

describe('event-backed project mutations', () => {
  let root: string
  let storage: ProjectStorage
  let service: ProjectMutationService
  const open = () =>
    new ProjectStorage({ dataDir: join(root, 'core'), projectsDir: join(root, 'projects') })
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pentrackr-mutations-'))
    storage = open()
    service = new ProjectMutationService(storage)
  })
  afterEach(() => {
    try {
      storage.close()
    } catch {
      /* already closed */
    }
    rmSync(root, { recursive: true, force: true })
  })
  const command = (
    projectId: string,
    expectedRevision: string,
    command: Parameters<ProjectMutationService['execute']>[0]['command'],
    operationId = uuidV7(),
  ) => ({
    projectId,
    expectedRevision,
    command,
    operationId,
    method: 'PATCH',
    route: `/api/v1/projects/${projectId}`,
  })

  it('persists metadata, scope correction, reclassification, and removal across restart and rebuild', async () => {
    const created = storage.createV2({ kind: 'lab', metadata: { name: 'Case' } })
    const id = created.projectId
    let revision = created.project?.revision as string
    const updated = await service.execute(
      command(id, revision, { type: 'metadata.patch', patch: { client_name: 'Client' } }),
    )
    expect(updated.project.metadata.client_name).toBe('Client')
    revision = updated.project.revision
    const object = { id: uuidV7(), kind: 'domain' as const, value: 'example.com', note: null }
    const added = await service.execute(
      command(id, revision, { type: 'scope.add', side: 'included', object }),
    )
    revision = added.project.revision
    const corrected = await service.execute(
      command(id, revision, { type: 'scope.correct', object: { ...object, note: 'Primary' } }),
    )
    revision = corrected.project.revision
    const moved = await service.execute(
      command(id, revision, {
        type: 'scope.reclassify',
        object_id: object.id,
        from: 'included',
        to: 'excluded',
      }),
    )
    expect(moved.project.metadata.scope?.exclusions[0]?.id).toBe(object.id)
    expect(moved.project.metadata.scope?.inclusions).toEqual([])
    revision = moved.project.revision
    const beforeRebuild = storage
      .ledgerForMutation(id)
      .read()
      .map((entry) => entry.envelope.this_hash)
    const rebuilt = rebuildProject(storage.ledgerForMutation(id))
    expect(rebuilt).toEqual(moved.project)
    expect(
      storage
        .ledgerForMutation(id)
        .read()
        .map((entry) => entry.envelope.this_hash),
    ).toEqual(beforeRebuild)
    expect(storage.ledgerForMutation(id).verifyCheckpoints().ok).toBe(true)
    storage.close()
    storage = open()
    service = new ProjectMutationService(storage)
    expect(storage.open(id)).toEqual(moved.project)
    const removed = await service.execute(
      command(id, revision, { type: 'scope.remove', object_id: object.id }),
    )
    expect(removed.project.metadata.scope?.exclusions).toEqual([])
    expect(storage.ledgerForMutation(id).verify().ok).toBe(true)
  })

  it('deduplicates committed events and no-ops before stale revision checks', async () => {
    const created = storage.create({ kind: 'engagement', metadata: { name: 'Case' } })
    const id = created.projectId
    const original = command(id, created.project?.revision as string, {
      type: 'metadata.patch',
      patch: { name: 'Renamed' },
    })
    const first = await service.execute(original)
    expect(await service.execute(original)).toEqual(first)
    await expect(
      service.execute({
        ...original,
        command: { type: 'metadata.patch', patch: { name: 'Other' } },
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' })
    const noop = command(id, first.project.revision, {
      type: 'metadata.patch',
      patch: { name: 'Renamed' },
    })
    const noChange = await service.execute(noop)
    expect(noChange.changed).toBe(false)
    storage.close()
    storage = open()
    service = new ProjectMutationService(storage)
    expect(await service.execute(noop)).toEqual(noChange)
    await expect(
      service.execute(
        command(id, original.expectedRevision, {
          type: 'metadata.patch',
          patch: { name: 'Stale' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'stale_revision' })
    expect(storage.ledgerForMutation(id).count()).toBe(2)
  })

  it('reports a committed event when projection catch-up fails and repairs on retry', async () => {
    const created = storage.createV2({ kind: 'lab', metadata: { name: 'Repair' } })
    const id = created.projectId
    const ledger = storage.ledgerForMutation(id)
    ledger
      .projectionDatabase()
      .exec(
        "CREATE TRIGGER fail_projection BEFORE UPDATE ON engagement_view BEGIN SELECT RAISE(ABORT, 'projection unavailable'); END",
      )
    const input = command(id, created.project?.revision as string, {
      type: 'metadata.patch',
      patch: { name: 'Committed' },
    })
    await expect(service.execute(input)).rejects.toMatchObject({
      code: 'projection_repair_required',
    })
    expect(ledger.count()).toBe(2)
    expect(ledger.verify().ok).toBe(true)
    ledger.projectionDatabase().exec('DROP TRIGGER fail_projection')
    const result = await service.execute(input)
    expect(result.project.metadata.name).toBe('Committed')
    expect(ledger.count()).toBe(2)
  })

  it('does not consume an operation key when the ledger append fails', async () => {
    const created = storage.create({ kind: 'lab', metadata: { name: 'Append failure' } })
    const id = created.projectId
    const ledger = storage.ledgerForMutation(id)
    ledger
      .projectionDatabase()
      .exec(
        "CREATE TRIGGER fail_append BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'disk error'); END",
      )
    const input = command(id, created.project?.revision as string, {
      type: 'metadata.patch',
      patch: { code_name: 'Retried' },
    })
    await expect(service.execute(input)).rejects.toThrow()
    expect(ledger.count()).toBe(1)
    ledger.projectionDatabase().exec('DROP TRIGGER fail_append')
    expect((await service.execute(input)).project.metadata.code_name).toBe('Retried')
    expect(ledger.count()).toBe(2)
  })

  it('serializes two writers, rejects a simultaneous key retry, and detects cross-project key reuse', async () => {
    const first = storage.create({ kind: 'lab', metadata: { name: 'First' } })
    const second = storage.create({ kind: 'lab', metadata: { name: 'Second' } })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const one = command(first.projectId, first.project?.revision as string, {
      type: 'metadata.patch',
      patch: { name: 'Winner' },
    })
    const pending = service.execute({ ...one, admit: () => gate })
    await expect(service.execute(one)).rejects.toMatchObject({ code: 'operation_in_progress' })
    const two = service.execute(
      command(first.projectId, one.expectedRevision, {
        type: 'metadata.patch',
        patch: { name: 'Loser' },
      }),
    )
    release()
    await pending
    await expect(two).rejects.toMatchObject({ code: 'stale_revision' })
    await expect(
      service.execute(
        command(
          second.projectId,
          second.project?.revision as string,
          { type: 'metadata.patch', patch: { name: 'Wrong project' } },
          one.operationId,
        ),
      ),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' })
  })

  it('preserves a transferred roster mapping until an explicit reassignment event', async () => {
    const priorMember = {
      id: uuidV7(),
      name: 'Former local',
      role: 'Lead',
      identity: 'local_operator' as const,
    }
    const nextMember = {
      id: uuidV7(),
      name: 'New local',
      role: 'Lead',
      identity: 'external' as const,
    }
    const created = storage.createV2({
      kind: 'engagement',
      metadata: { name: 'Portable', roster: [priorMember, nextMember] },
    })
    const originalOperator = storage.operatorId
    storage.close()
    storage = new ProjectStorage({
      dataDir: join(root, 'another-core'),
      projectsDir: join(root, 'another-projects'),
    })
    storage.register(created.directory)
    service = new ProjectMutationService(storage)
    const before = storage.open(created.projectId)
    expect(before.metadata.roster[0]?.operator_id).toBe(originalOperator)
    const result = await service.execute(
      command(created.projectId, before.revision, {
        type: 'roster.reassign',
        member_id: nextMember.id,
      }),
    )
    expect(
      result.project.metadata.roster.find((member) => member.id === nextMember.id)?.operator_id,
    ).toBe(storage.operatorId)
    expect(
      result.project.metadata.roster.find((member) => member.id === priorMember.id)?.identity,
    ).toBe('external')
    expect(
      storage.ledgerForMutation(created.projectId).read({ limit: 1 })[0]?.envelope.operator_id,
    ).toBe(originalOperator)
  })

  it('keeps unsupported or invalid history unavailable instead of projecting it as current', () => {
    const created = storage.create({ kind: 'lab', metadata: { name: 'Future' } })
    storage.close()
    const ledger = openLedger(join(created.directory, 'ledger.db'))
    ledger.append({
      event_id: uuidV7(),
      ts_utc: '2026-09-17T12:00:00.000Z',
      ts_local: '2026-09-17T12:00:00.000Z',
      tz: 'UTC',
      operator_id: uuidV7(),
      engagement_id: created.projectId,
      schema_version: 99,
      type: 'engagement.updated',
      payload: { operation_id: uuidV7(), command_hash: 'a'.repeat(64), patch: { name: 'Future' } },
    })
    ledger.close()
    storage = open()
    expect(storage.get(created.projectId).availability).toBe('unsupported')
  })
})
