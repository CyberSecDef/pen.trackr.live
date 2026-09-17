import { sealEvent, uuidV7 } from '@pentrackr/ledger'
import { describe, expect, it } from 'vitest'
import { emptyMetadataV2 } from '../src/metadata-v2.js'
import { applyProjectEvent, replayProject } from '../src/replay.js'

const engagementId = uuidV7()
const operatorId = uuidV7()
let previous: string | null = null
const event = (type: string, payload: Record<string, unknown>, schema_version = 1) => {
  const sealed = sealEvent({
    event_id: uuidV7(),
    prev_hash: previous,
    ts_utc: '2026-09-17T12:00:00.000Z',
    ts_local: '2026-09-17T12:00:00.000Z',
    tz: 'UTC',
    operator_id: operatorId,
    engagement_id: engagementId,
    schema_version,
    type,
    payload: payload as never,
  })
  previous = sealed.this_hash
  return sealed
}
const operation = () => ({ operation_id: uuidV7(), command_hash: 'a'.repeat(64) })
const lifecycle = { kind: 'lab', state: 'lab', resume_state: null, closing_origin: null }
const genesis = (version: 1 | 2 = 1) => {
  previous = null
  return event(
    'engagement.created',
    {
      ...operation(),
      lifecycle,
      metadata:
        version === 1
          ? { name: 'Case', client_name: null, code_name: null }
          : { name: 'Case', client_name: null, code_name: null, ...emptyMetadataV2 },
    },
    version,
  )
}
const object = () => ({ id: uuidV7(), kind: 'domain', value: 'example.com', note: null })

describe('project domain replay', () => {
  it('upgrades both genesis versions, applies scope changes and metadata, and replays sequence', () => {
    for (const version of [1, 2] as const) {
      const created = genesis(version)
      const item = object()
      const entries = [created]
      for (const [type, payload] of [
        ['scope.object-added', { object: item }],
        ['scope.object-updated', { object: { ...item, note: 'Updated' } }],
        ['scope.object-reclassified', { object_id: item.id, from: 'included', to: 'excluded' }],
        ['scope.object-removed', { object_id: item.id }],
        ['scope.excluded', { object: item }],
      ] as const)
        entries.push(event(type, { ...operation(), ...payload }))
      const update = event(
        'engagement.updated',
        { ...operation(), patch: { client_name: 'Client' } },
        2,
      )
      entries.push(update)
      let view = null
      for (const entry of entries) view = applyProjectEvent(view, entry)
      expect(view?.metadata.client_name).toBe('Client')
      expect(view?.metadata.scope?.exclusions[0]?.id).toBe(item.id)
      expect(
        replayProject(entries.map((envelope, index) => ({ seq: index + 1, envelope })) as never),
      ).toEqual(view)
    }
  })

  it('rejects malformed genesis, duplicates, foreign identities, and unsupported payloads', () => {
    const created = genesis()
    expect(() => applyProjectEvent(null, { ...created, type: 'scope.excluded' })).toThrow()
    expect(() => applyProjectEvent(null, { ...created, prev_hash: 'a'.repeat(64) })).toThrow()
    const view = applyProjectEvent(null, created)
    expect(() => applyProjectEvent(view, created)).toThrow('duplicate')
    const update = event('engagement.updated', { ...operation(), patch: { name: 'Next' } }, 2)
    expect(() => applyProjectEvent(view, { ...update, engagement_id: uuidV7() })).toThrow(
      'another engagement',
    )
    expect(() => applyProjectEvent(view, { ...update, schema_version: 99 })).toThrow('unsupported')
    expect(() => replayProject([])).toThrow('empty')
    expect(() => replayProject([{ seq: 2, envelope: created }] as never)).toThrow('noncontiguous')
  })

  it('rejects invalid scope changes and lifecycle snapshots', () => {
    const view = applyProjectEvent(null, genesis())
    const item = object()
    const added = applyProjectEvent(
      view,
      event('scope.object-added', { ...operation(), object: item }),
    )
    expect(() =>
      applyProjectEvent(added, event('scope.excluded', { ...operation(), object: item })),
    ).toThrow('already exists')
    expect(() =>
      applyProjectEvent(view, event('scope.object-updated', { ...operation(), object: item })),
    ).toThrow('missing object')
    expect(() =>
      applyProjectEvent(
        added,
        event('scope.object-updated', {
          ...operation(),
          object: { ...item, kind: 'url', value: 'https://example.com' },
        }),
      ),
    ).toThrow('kind')
    expect(() =>
      applyProjectEvent(
        view,
        event('scope.object-removed', { ...operation(), object_id: item.id }),
      ),
    ).toThrow('missing object')
    expect(() =>
      applyProjectEvent(
        added,
        event('scope.object-reclassified', {
          ...operation(),
          object_id: item.id,
          from: 'excluded',
          to: 'included',
        }),
      ),
    ).toThrow('source mismatch')
    expect(() =>
      applyProjectEvent(
        view,
        event('engagement.state-changed', {
          ...operation(),
          command: 'activate',
          previous: { ...lifecycle, state: 'closing', closing_origin: 'lab' },
          next: lifecycle,
          reason: null,
        }),
      ),
    ).toThrow('previous snapshot')
  })
})
