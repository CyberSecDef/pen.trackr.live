import { z } from 'zod'

/**
 * The ledger event taxonomy.
 *
 * @req FR-SECPL-001
 *
 * These are the minimum event types listed in SRS section 25.2, transcribed
 * exactly. The SRS is frozen, so this list is a transcription rather than a
 * design: where the spec writes "task.changed / hypothesis-resolved" it means
 * two types sharing a namespace, and that reading is preserved here.
 *
 * Adding a type is a minor change. Changing what an existing type *means* is
 * not — it would silently reinterpret history that has already been written and
 * signed, so a changed meaning requires a new type rather than an edited one.
 */
export const EVENT_TYPES = [
  'engagement.created',
  'engagement.updated',
  'engagement.state-changed',

  'scope.object-added',
  'scope.excluded',
  'scope.evaluated',

  'command.proposed',
  'command.allowed',
  'command.warned',
  'command.blocked',
  'command.started',
  'command.finished',

  'manual.logged',

  'session.opened',
  'session.closed',
  'session.ingested',

  'asset.discovered',
  'asset.updated',
  'asset.merged',

  'secret.created',
  'secret.revealed',
  'secret.validated',
  'secret.rotated',

  'loot.added',

  'finding.drafted',
  'finding.accepted',
  'finding.merged',
  'finding.status-changed',

  'cleanup.recorded',
  'cleanup.verified',
  'cleanup.residual-accepted',

  'evidence.added',
  'evidence.accessed',
  'evidence.exported',
  'evidence.destroyed',

  'traffic.ingested',
  'traffic.flow-correlated',

  'task.changed',
  'task.hypothesis-resolved',

  'report.generated',
  'report.distributed',

  'agent.ran',
  'agent.draft-accepted',
  'agent.draft-rejected',

  'plugin.installed',
  'plugin.capability-granted',

  'guardrail.violation',
  'guardrail.availability-event',
  'guardrail.lockout-risk',

  'project.switched',
  'ledger.sealed',
  'backup.restored',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export const eventTypeSchema = z.enum(EVENT_TYPES)

/** The namespace before the dot, useful for filtering a ledger by subsystem. */
export function eventNamespace(type: EventType): string {
  const [namespace] = type.split('.')
  return namespace ?? type
}

export const EVENT_NAMESPACES = [...new Set(EVENT_TYPES.map(eventNamespace))] as readonly string[]
