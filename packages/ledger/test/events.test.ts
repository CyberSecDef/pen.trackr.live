import { describe, expect, it } from 'vitest'
import { EVENT_NAMESPACES, EVENT_TYPES, eventNamespace, eventTypeSchema } from '../src/events.js'

/** @req FR-SECPL-001 */
describe('event taxonomy', () => {
  it('transcribes every type SRS section 25.2 requires', () => {
    // Guards against a type being quietly dropped during a refactor. Each entry
    // is named explicitly rather than counted, so a deletion fails loudly.
    const required = [
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
    ]
    for (const type of required) expect(EVENT_TYPES).toContain(type)
    expect(EVENT_TYPES).toHaveLength(required.length)
  })

  it('has no duplicate types', () => {
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length)
  })

  it('names every type as namespace.action', () => {
    for (const type of EVENT_TYPES) expect(type).toMatch(/^[a-z]+\.[a-z-]+$/)
  })

  it('accepts a known type and rejects an unknown one', () => {
    expect(eventTypeSchema.safeParse('command.started').success).toBe(true)
    expect(eventTypeSchema.safeParse('command.exploded').success).toBe(false)
    expect(eventTypeSchema.safeParse('').success).toBe(false)
  })

  it('extracts the namespace', () => {
    expect(eventNamespace('command.started')).toBe('command')
    expect(eventNamespace('backup.restored')).toBe('backup')
  })

  it('exposes each namespace once', () => {
    expect(EVENT_NAMESPACES).toContain('command')
    expect(EVENT_NAMESPACES).toContain('guardrail')
    expect(new Set(EVENT_NAMESPACES).size).toBe(EVENT_NAMESPACES.length)
  })
})
