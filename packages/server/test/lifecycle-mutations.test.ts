import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateSigningKeyPair, uuidV7 } from '@pentrackr/ledger'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectMutationService } from '../src/mutations.js'
import { rebuildProject } from '../src/projections.js'
import { ProjectStorage } from '../src/storage.js'

describe('M2.6 audited lifecycle transitions', () => {
  let root: string
  let storage: ProjectStorage
  let service: ProjectMutationService
  const open = () =>
    new ProjectStorage({ dataDir: join(root, 'core'), projectsDir: join(root, 'projects') })
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pentrackr-lifecycle-'))
    storage = open()
    service = new ProjectMutationService(storage)
  })
  afterEach(() => {
    storage.close()
    rmSync(root, { recursive: true, force: true })
  })
  const input = (
    projectId: string,
    expectedRevision: string,
    command:
      | 'activate'
      | 'pause'
      | 'resume'
      | 'begin_closing'
      | 'cancel_closing'
      | 'close'
      | 'reopen',
    reason: string | null = command === 'activate' ? null : 'Operator decision',
    operationId = uuidV7(),
  ) => ({
    projectId,
    expectedRevision,
    operationId,
    method: 'POST',
    route: `/api/v1/projects/${projectId}/transitions`,
    command: { type: 'lifecycle.transition' as const, command, reason },
  })

  it('writes auditable transitions, blocks Closed content, and replays after restart', async () => {
    const created = storage.createV2({ kind: 'engagement', metadata: { name: 'Case' } })
    const id = created.projectId
    let revision = created.project?.revision as string
    const initialCheckpoint = storage
      .ledgerForMutation(id)
      .checkpoint(generateSigningKeyPair().privateKey)
    for (const [command, state] of [
      ['pause', 'paused'],
      ['begin_closing', 'closing'],
      ['cancel_closing', 'draft'],
      ['activate', 'active'],
      ['begin_closing', 'closing'],
      ['close', 'closed'],
    ] as const) {
      const result = await service.execute(input(id, revision, command))
      expect(result.project.lifecycle.state).toBe(state)
      expect(result.changed).toBe(true)
      revision = result.project.revision
    }
    const ledger = storage.ledgerForMutation(id)
    const events = ledger.read()
    expect(events).toHaveLength(7)
    expect(events[1]?.envelope.payload).toMatchObject({
      command: 'pause',
      previous: { state: 'draft' },
      next: { state: 'paused', resume_state: 'draft' },
    })
    expect(events[6]?.envelope.payload).toMatchObject({
      command: 'close',
      next: { state: 'closed', resume_state: null, closing_origin: null },
    })
    await expect(
      service.execute({
        ...input(id, revision, 'close'),
        command: { type: 'metadata.patch', patch: { name: 'Blocked' } },
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' })
    expect(
      service.availableTransitions(id).commands.find((entry) => entry.command === 'reopen'),
    ).toMatchObject({ allowed: true, reason: null })
    const hashes = events.map((entry) => entry.envelope.this_hash)
    expect(rebuildProject(ledger).lifecycle.state).toBe('closed')
    expect(ledger.read().map((entry) => entry.envelope.this_hash)).toEqual(hashes)
    expect(ledger.verifyCheckpoints().ok).toBe(true)
    expect(ledger.verifyCheckpoints()).toEqual({ ok: true, checkpoints: 1 })
    expect(initialCheckpoint.event_count).toBe(1)
    storage.close()
    storage = open()
    service = new ProjectMutationService(storage)
    expect(storage.open(id).lifecycle.state).toBe('closed')
    const reopened = await service.execute(input(id, revision, 'reopen'))
    expect(reopened.project.lifecycle.state).toBe('active')
    expect(
      (
        await service.execute({
          ...input(id, reopened.project.revision, 'activate'),
          command: { type: 'metadata.patch', patch: { name: 'Editable' } },
        })
      ).project.metadata.name,
    ).toBe('Editable')
  })

  it('deduplicates committed transitions and no-ops before stale checks', async () => {
    const created = storage.create({ kind: 'lab', metadata: { name: 'Lab' } })
    const id = created.projectId
    const initial = created.project?.revision as string
    const pausedInput = input(id, initial, 'pause', '  Break  ')
    const paused = await service.execute(pausedInput)
    expect(paused.project.lifecycle.resume_state).toBe('lab')
    expect(await service.execute(pausedInput)).toEqual(paused)
    await expect(
      service.execute({ ...pausedInput, command: { ...pausedInput.command, reason: 'Other' } }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' })
    const noOpInput = input(id, paused.project.revision, 'pause')
    const noOp = await service.execute(noOpInput)
    expect(noOp.changed).toBe(false)
    expect(storage.ledgerForMutation(id).count()).toBe(2)
    storage.close()
    storage = open()
    service = new ProjectMutationService(storage)
    expect(await service.execute(noOpInput)).toEqual(noOp)
    await expect(service.execute(input(id, initial, 'resume'))).rejects.toMatchObject({
      code: 'stale_revision',
    })
    const resumed = await service.execute(input(id, paused.project.revision, 'resume'))
    expect(resumed.project.lifecycle.state).toBe('lab')
    await expect(
      service.execute(input(id, resumed.project.revision, 'activate')),
    ).rejects.toMatchObject({ code: 'invalid_transition' })
    await expect(
      service.execute(input(id, resumed.project.revision, 'pause', null)),
    ).rejects.toThrow()
  })

  it('serializes competing writers and repairs a committed projection failure', async () => {
    const created = storage.create({ kind: 'lab', metadata: { name: 'Lab' } })
    const id = created.projectId
    const initial = created.project?.revision as string
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const firstInput = input(id, initial, 'pause')
    const first = service.execute({ ...firstInput, admit: () => gate })
    const second = service.execute(input(id, initial, 'begin_closing'))
    release()
    const paused = await first
    await expect(second).rejects.toMatchObject({ code: 'stale_revision' })
    const ledger = storage.ledgerForMutation(id)
    ledger
      .projectionDatabase()
      .exec(
        "CREATE TRIGGER fail_projection BEFORE UPDATE ON engagement_view BEGIN SELECT RAISE(ABORT, 'projection unavailable'); END",
      )
    const closingInput = input(id, paused.project.revision, 'begin_closing')
    await expect(service.execute(closingInput)).rejects.toMatchObject({
      code: 'projection_repair_required',
    })
    expect(ledger.count()).toBe(3)
    ledger.projectionDatabase().exec('DROP TRIGGER fail_projection')
    expect((await service.execute(closingInput)).project.lifecycle).toMatchObject({
      state: 'closing',
      closing_origin: 'lab',
    })
    expect(ledger.count()).toBe(3)
  })

  it('leaves a lifecycle operation retryable when append fails', async () => {
    const created = storage.create({ kind: 'lab', metadata: { name: 'Lab' } })
    const id = created.projectId
    const ledger = storage.ledgerForMutation(id)
    ledger
      .projectionDatabase()
      .exec(
        "CREATE TRIGGER fail_append BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'disk error'); END",
      )
    const transition = input(id, created.project?.revision as string, 'pause')
    await expect(service.execute(transition)).rejects.toThrow()
    expect(ledger.count()).toBe(1)
    ledger.projectionDatabase().exec('DROP TRIGGER fail_append')
    expect((await service.execute(transition)).project.lifecycle.state).toBe('paused')
    expect(ledger.count()).toBe(2)
  })
})
