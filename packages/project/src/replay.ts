import type { StoredEvent } from '@pentrackr/ledger'
import type { z } from 'zod'
import { type ProjectEvent, parseProjectEvent } from './events.js'
import { metadataV2FromV1, metadataV2Schema } from './metadata-v2.js'
import { projectV2Schema } from './project.js'
import type { scopeObjectSchema } from './scope.js'

export class ProjectReplayError extends Error {
  readonly code: 'invalid_history' | 'unsupported_project'
  constructor(code: 'invalid_history' | 'unsupported_project', message: string) {
    super(message)
    this.name = 'ProjectReplayError'
    this.code = code
  }
}
export type ProjectView = z.infer<typeof projectV2Schema>
type ScopeObject = z.infer<typeof scopeObjectSchema>
type Side = 'included' | 'excluded'

function changeScope(view: ProjectView, event: ProjectEvent): ProjectView {
  if (!event.type.startsWith('scope.')) return view
  const scope = view.metadata.scope ?? { inclusions: [], exclusions: [] }
  const inclusions = [...scope.inclusions]
  const exclusions = [...scope.exclusions]
  const find = (id: string): { side: Side; index: number; object: ScopeObject } | null => {
    const included = inclusions.findIndex((item) => item.id === id)
    if (included >= 0)
      return { side: 'included', index: included, object: inclusions[included] as ScopeObject }
    const excluded = exclusions.findIndex((item) => item.id === id)
    return excluded < 0
      ? null
      : { side: 'excluded', index: excluded, object: exclusions[excluded] as ScopeObject }
  }
  if (event.type === 'scope.object-added' || event.type === 'scope.excluded') {
    if (find(event.payload.object.id))
      throw new ProjectReplayError('invalid_history', 'scope object ID already exists')
    ;(event.type === 'scope.object-added' ? inclusions : exclusions).push(event.payload.object)
  } else if (event.type === 'scope.object-updated') {
    const found = find(event.payload.object.id)
    if (!found || found.object.kind !== event.payload.object.kind)
      throw new ProjectReplayError(
        'invalid_history',
        'scope correction changes missing object or kind',
      )
    ;(found.side === 'included' ? inclusions : exclusions)[found.index] = event.payload.object
  } else if (event.type === 'scope.object-removed') {
    const found = find(event.payload.object_id)
    if (!found)
      throw new ProjectReplayError('invalid_history', 'scope removal targets missing object')
    ;(found.side === 'included' ? inclusions : exclusions).splice(found.index, 1)
  } else if (event.type === 'scope.object-reclassified') {
    const found = find(event.payload.object_id)
    if (!found || found.side !== event.payload.from)
      throw new ProjectReplayError('invalid_history', 'scope reclassification source mismatch')
    ;(found.side === 'included' ? inclusions : exclusions).splice(found.index, 1)
    ;(event.payload.to === 'included' ? inclusions : exclusions).push(found.object)
  }
  return { ...view, metadata: { ...view.metadata, scope: { inclusions, exclusions } } }
}

export function applyProjectEvent(view: ProjectView | null, raw: unknown): ProjectView {
  let event: ProjectEvent
  try {
    event = parseProjectEvent(raw)
  } catch {
    throw new ProjectReplayError('unsupported_project', 'unsupported event type or payload version')
  }
  if (view === null) {
    if (event.type !== 'engagement.created' || event.prev_hash !== null)
      throw new ProjectReplayError('invalid_history', 'project genesis must be engagement.created')
    const metadata =
      event.schema_version === 1 ? metadataV2FromV1(event.payload.metadata) : event.payload.metadata
    return projectV2Schema.parse({
      format_version: 1,
      engagement_id: event.engagement_id,
      metadata,
      lifecycle: event.payload.lifecycle,
      revision: event.this_hash,
    })
  }
  if (event.engagement_id !== view.engagement_id)
    throw new ProjectReplayError('invalid_history', 'event belongs to another engagement')
  if (event.type === 'engagement.created')
    throw new ProjectReplayError('invalid_history', 'duplicate engagement creation')
  if (event.type === 'engagement.updated') {
    if (view.lifecycle.state === 'closed')
      throw new ProjectReplayError('invalid_history', 'closed content changed without reopening')
    const metadata = { ...view.metadata, ...event.payload.patch }
    return projectV2Schema.parse({
      ...view,
      metadata: metadataV2Schema.parse(metadata),
      revision: event.this_hash,
    })
  }
  if (event.type === 'engagement.state-changed') {
    if (
      event.payload.previous.kind !== view.lifecycle.kind ||
      event.payload.previous.state !== view.lifecycle.state ||
      event.payload.previous.resume_state !== view.lifecycle.resume_state ||
      event.payload.previous.closing_origin !== view.lifecycle.closing_origin
    )
      throw new ProjectReplayError('invalid_history', 'lifecycle previous snapshot mismatch')
    return projectV2Schema.parse({
      ...view,
      lifecycle: event.payload.next,
      revision: event.this_hash,
    })
  }
  if (event.type.startsWith('scope.')) {
    if (view.lifecycle.state === 'closed')
      throw new ProjectReplayError('invalid_history', 'closed scope changed without reopening')
    return projectV2Schema.parse({ ...changeScope(view, event), revision: event.this_hash })
  }
  return { ...view, revision: event.this_hash }
}

/** Domain replay follows raw chain/checkpoint verification by the ledger store. */
export function replayProject(entries: readonly StoredEvent[]): ProjectView {
  let view: ProjectView | null = null
  let nextSeq = 1
  for (const entry of entries) {
    if (entry.seq !== nextSeq++)
      throw new ProjectReplayError('invalid_history', 'noncontiguous event sequence')
    view = applyProjectEvent(view, entry.envelope)
  }
  if (view === null) throw new ProjectReplayError('invalid_history', 'empty project history')
  return view
}
