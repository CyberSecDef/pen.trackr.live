import { createHash } from 'node:crypto'
import { type CborValue, encode, sealEvent, uuidV7, uuidV7Schema } from '@pentrackr/ledger'
import {
  allowedTransitions,
  applyProjectEvent,
  completeMetadataV2Patch,
  type ProjectView,
  reasonSchema,
  scopeObjectSchema,
  TransitionPolicyError,
  transitionCommandSchema,
  transitionLifecycle,
} from '@pentrackr/project'
import { z } from 'zod'
import { catchUpProject } from './projections.js'
import { eventTime, type ProjectStorage } from './storage.js'

const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('metadata.patch'), patch: z.unknown() }),
  z.strictObject({
    type: z.literal('scope.add'),
    side: z.enum(['included', 'excluded']),
    object: scopeObjectSchema,
  }),
  z.strictObject({ type: z.literal('scope.correct'), object: scopeObjectSchema }),
  z.strictObject({ type: z.literal('scope.remove'), object_id: uuidV7Schema }),
  z
    .strictObject({
      type: z.literal('scope.reclassify'),
      object_id: uuidV7Schema,
      from: z.enum(['included', 'excluded']),
      to: z.enum(['included', 'excluded']),
    })
    .refine((value) => value.from !== value.to),
  z.strictObject({ type: z.literal('roster.reassign'), member_id: uuidV7Schema }),
  z
    .strictObject({
      type: z.literal('lifecycle.transition'),
      command: transitionCommandSchema,
      reason: reasonSchema.nullable(),
    })
    .refine((value) => value.command === 'activate' || value.reason !== null, {
      path: ['reason'],
      message: 'transition requires a reason',
    }),
])
export type MutationCommand = z.infer<typeof commandSchema>
export interface MutationInput {
  projectId: string
  operationId: string
  expectedRevision: string
  method: string
  route: string
  command: MutationCommand
  admit?: () => void | Promise<void>
}
export interface MutationResult {
  operationId: string
  eventId: string | null
  changed: boolean
  project: ProjectView
}
export class MutationError extends Error {
  readonly code: string
  readonly eventId?: string
  readonly revision?: string
  constructor(code: string, message: string, eventId?: string, revision?: string) {
    super(message)
    this.name = 'MutationError'
    this.code = code
    if (eventId !== undefined) this.eventId = eventId
    if (revision !== undefined) this.revision = revision
  }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
function findScope(view: ProjectView, id: string) {
  const included = view.metadata.scope?.inclusions.find((object) => object.id === id)
  if (included) return { side: 'included' as const, object: included }
  const excluded = view.metadata.scope?.exclusions.find((object) => object.id === id)
  return excluded ? { side: 'excluded' as const, object: excluded } : null
}

export class ProjectMutationService {
  private readonly inFlight = new Set<string>()
  private readonly tails = new Map<string, Promise<void>>()
  private readonly storage: ProjectStorage
  constructor(storage: ProjectStorage) {
    this.storage = storage
  }

  availableTransitions(projectId: string) {
    const project = this.storage.open(projectId)
    return {
      lifecycle: project.lifecycle,
      revision: project.revision,
      commands: allowedTransitions(project.lifecycle),
    }
  }

  async execute(input: MutationInput): Promise<MutationResult> {
    uuidV7Schema.parse(input.projectId)
    uuidV7Schema.parse(input.operationId)
    const command = commandSchema.parse(input.command)
    if (this.inFlight.has(input.operationId))
      throw new MutationError('operation_in_progress', 'operation is already running')
    this.inFlight.add(input.operationId)
    const previous = this.tails.get(input.projectId) ?? Promise.resolve()
    let release!: () => void
    const tail = new Promise<void>((resolve) => {
      release = resolve
    })
    this.tails.set(input.projectId, tail)
    try {
      await previous
      return await this.executeSerial({ ...input, command })
    } finally {
      release()
      if (this.tails.get(input.projectId) === tail) this.tails.delete(input.projectId)
      this.inFlight.delete(input.operationId)
    }
  }

  private async executeSerial(input: MutationInput): Promise<MutationResult> {
    const command = commandSchema.parse(input.command)
    const ledger = this.storage.ledgerForMutation(input.projectId)
    const operatorId = this.storage.operatorId
    const normalized =
      command.type === 'metadata.patch'
        ? { ...command, patch: completeMetadataV2Patch(command.patch, operatorId) }
        : command
    const commandHash = createHash('sha256')
      .update(
        encode({
          operator_id: operatorId,
          project_id: input.projectId,
          method: input.method,
          route: input.route,
          command: normalized,
        } as unknown as CborValue),
      )
      .digest('hex')
    const noop = this.storage.readMutationNoop(input.operationId)
    if (noop) {
      if (noop.commandHash !== commandHash)
        throw new MutationError('idempotency_conflict', 'operation ID was used for another command')
      return noop.response as MutationResult
    }
    const priorGlobal = this.storage.findMutationEvent(input.operationId)
    if (priorGlobal && priorGlobal.projectId !== input.projectId)
      throw new MutationError('idempotency_conflict', 'operation ID was used for another project')
    const entries = ledger.read()
    const prior = entries.find((entry) => entry.seq === priorGlobal?.seq)
    if (prior) {
      if (prior.envelope.payload.command_hash !== commandHash)
        throw new MutationError('idempotency_conflict', 'operation ID was used for another command')
      let original: ProjectView | null = null
      for (const entry of entries) {
        original = applyProjectEvent(original, entry.envelope)
        if (entry.seq === prior.seq) break
      }
      if (!original)
        throw new MutationError('invalid_history', 'committed operation has no project view')
      try {
        catchUpProject(ledger)
      } catch {
        throw new MutationError(
          'projection_repair_required',
          'committed event requires projection repair',
          prior.envelope.event_id,
          prior.envelope.this_hash,
        )
      }
      return {
        operationId: input.operationId,
        eventId: prior.envelope.event_id,
        changed: true,
        project: original,
      }
    }
    await input.admit?.()
    let current: ProjectView
    try {
      current = catchUpProject(ledger)
    } catch {
      throw new MutationError('projection_repair_required', 'project projection requires repair')
    }
    if (current.revision !== input.expectedRevision)
      throw new MutationError('stale_revision', 'expected ledger revision does not match')
    if (ledger.head()?.this_hash !== current.revision)
      throw new MutationError('projection_repair_required', 'projection does not match ledger head')
    if (current.lifecycle.state === 'closed' && normalized.type !== 'lifecycle.transition')
      throw new MutationError('invalid_transition', 'closed project content requires reopening')
    const payloadBase = { operation_id: input.operationId, command_hash: commandHash }
    let type:
      | 'engagement.updated'
      | 'engagement.state-changed'
      | 'scope.object-added'
      | 'scope.excluded'
      | 'scope.object-updated'
      | 'scope.object-removed'
      | 'scope.object-reclassified' = 'engagement.updated'
    let payload: Record<string, unknown>
    let noChange = false
    if (normalized.type === 'lifecycle.transition') {
      try {
        const decision = transitionLifecycle(current.lifecycle, normalized.command)
        noChange = !decision.changed
        type = 'engagement.state-changed'
        payload = {
          ...payloadBase,
          command: normalized.command,
          previous: current.lifecycle,
          next: decision.next,
          reason: normalized.reason,
        }
      } catch (error) {
        if (error instanceof TransitionPolicyError)
          throw new MutationError(error.code, error.message)
        throw error
      }
    } else if (normalized.type === 'metadata.patch') {
      const patch = normalized.patch as ReturnType<typeof completeMetadataV2Patch>
      if ('scope' in patch)
        throw new MutationError('invalid_command', 'scope changes require scope operations')
      noChange =
        Object.keys(patch).length === 0 || same({ ...current.metadata, ...patch }, current.metadata)
      payload = { ...payloadBase, patch }
    } else if (normalized.type === 'roster.reassign') {
      const member = current.metadata.roster.find((entry) => entry.id === normalized.member_id)
      if (!member) throw new MutationError('project_not_found', 'roster member not found')
      noChange = member.identity === 'local_operator' && member.operator_id === operatorId
      const roster = current.metadata.roster.map((entry) =>
        entry.id === member.id
          ? { ...entry, identity: 'local_operator', operator_id: operatorId }
          : entry.identity === 'local_operator'
            ? { ...entry, identity: 'external', operator_id: null }
            : entry,
      )
      payload = { ...payloadBase, patch: { roster } }
    } else if (normalized.type === 'scope.add') {
      if (findScope(current, normalized.object.id))
        throw new MutationError('scope_conflict', 'scope object ID already exists')
      type = normalized.side === 'included' ? 'scope.object-added' : 'scope.excluded'
      payload = { ...payloadBase, object: normalized.object }
    } else if (normalized.type === 'scope.correct') {
      const found = findScope(current, normalized.object.id)
      if (!found || found.object.kind !== normalized.object.kind)
        throw new MutationError('scope_conflict', 'scope object missing or kind changed')
      noChange = same(found.object, normalized.object)
      type = 'scope.object-updated'
      payload = { ...payloadBase, object: normalized.object }
    } else if (normalized.type === 'scope.remove') {
      if (!findScope(current, normalized.object_id))
        throw new MutationError('scope_conflict', 'scope object not found')
      type = 'scope.object-removed'
      payload = { ...payloadBase, object_id: normalized.object_id }
    } else {
      const found = findScope(current, normalized.object_id)
      if (!found || found.side !== normalized.from)
        throw new MutationError('scope_conflict', 'scope classification mismatch')
      type = 'scope.object-reclassified'
      payload = {
        ...payloadBase,
        object_id: normalized.object_id,
        from: normalized.from,
        to: normalized.to,
      }
    }
    if (noChange) {
      const result = {
        operationId: input.operationId,
        eventId: null,
        changed: false,
        project: current,
      }
      this.storage.saveMutationNoop(input.operationId, commandHash, result)
      return result
    }
    const event = sealEvent({
      event_id: uuidV7(),
      prev_hash: current.revision,
      ...eventTime(new Date()),
      operator_id: operatorId,
      engagement_id: input.projectId,
      schema_version: type === 'engagement.updated' ? 2 : 1,
      type,
      payload: payload as Record<string, CborValue>,
    })
    applyProjectEvent(current, event)
    const committed = ledger.append({
      event_id: event.event_id,
      ts_utc: event.ts_utc,
      ts_local: event.ts_local,
      tz: event.tz,
      operator_id: operatorId,
      engagement_id: input.projectId,
      schema_version: event.schema_version,
      type,
      payload: payload as Record<string, CborValue>,
    })
    try {
      const project = catchUpProject(ledger)
      return { operationId: input.operationId, eventId: committed.event_id, changed: true, project }
    } catch {
      throw new MutationError(
        'projection_repair_required',
        'event committed; projection repair is required',
        committed.event_id,
        committed.this_hash,
      )
    }
  }
}
