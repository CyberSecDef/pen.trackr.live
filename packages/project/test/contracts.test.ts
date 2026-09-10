import { encode, parseEnvelope, sealEvent, uuidV7 } from '@pentrackr/ledger'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as contracts from '../src/index.js'
import {
  lifecycleSchema,
  metadataPatchSchema,
  metadataSchema,
  nameSchema,
  parseProjectEvent,
  projectSchema,
  reasonSchema,
} from '../src/index.js'

const kinds = ['engagement', 'lab'] as const
const states = ['draft', 'lab', 'active', 'paused', 'closing', 'closed'] as const
const resumes = [null, 'draft', 'lab', 'active', 'closing'] as const
const origins = [null, 'draft', 'lab', 'active'] as const
const validStates = new Set([
  'engagement/draft/null/null',
  'engagement/active/null/null',
  'engagement/closed/null/null',
  'engagement/paused/draft/null',
  'engagement/paused/active/null',
  'engagement/closing/null/draft',
  'engagement/closing/null/active',
  'engagement/paused/closing/draft',
  'engagement/paused/closing/active',
  'lab/lab/null/null',
  'lab/closed/null/null',
  'lab/paused/lab/null',
  'lab/closing/null/lab',
  'lab/paused/closing/lab',
])
const cases = kinds.flatMap((kind) =>
  states.flatMap((state) =>
    resumes.flatMap((resume_state) =>
      origins.map((closing_origin) => ({ kind, state, resume_state, closing_origin })),
    ),
  ),
)
const draft = { kind: 'engagement', state: 'draft', resume_state: null, closing_origin: null }
const metadata = { name: 'Example', client_name: null, code_name: null }
const operation = () => ({ operation_id: uuidV7(), command_hash: 'a'.repeat(64) })
const envelope = (
  type:
    | 'engagement.created'
    | 'engagement.updated'
    | 'engagement.state-changed'
    | 'project.switched',
  payload: Record<string, unknown>,
  engagement_id = uuidV7(),
) =>
  sealEvent({
    event_id: uuidV7(),
    engagement_id,
    operator_id: uuidV7(),
    prev_hash: null,
    ts_utc: '2026-09-09T12:00:00.000Z',
    ts_local: '2026-09-09T12:00:00.000Z',
    tz: 'UTC',
    type,
    schema_version: 1,
    payload: payload as Parameters<typeof sealEvent>[0]['payload'],
  })

describe('persisted lifecycle invariants', () => {
  it.each(cases)('validates $kind/$state/$resume_state/$closing_origin', (value) => {
    const key = `${value.kind}/${value.state}/${value.resume_state}/${value.closing_origin}`
    expect(lifecycleSchema.safeParse(value).success).toBe(validStates.has(key))
  })
  it('rejects Blackout, unknown fields, and missing saved fields', () => {
    expect(lifecycleSchema.safeParse({ ...draft, state: 'blackout' }).success).toBe(false)
    expect(lifecycleSchema.safeParse({ ...draft, extra: true }).success).toBe(false)
    expect(lifecycleSchema.safeParse({ kind: 'lab', state: 'lab' }).success).toBe(false)
  })
})

describe('identity metadata and patch semantics', () => {
  it('preserves omitted values and explicit nulls as different commands', () => {
    expect(metadataPatchSchema.parse({})).toEqual({})
    expect(metadataPatchSchema.parse({ client_name: null })).toEqual({ client_name: null })
    expect(metadataPatchSchema.safeParse({ client_name: undefined }).success).toBe(false)
    expect(metadataPatchSchema.safeParse({ name: null }).success).toBe(false)
    expect(metadataSchema.safeParse({ name: 'Example' }).success).toBe(false)
  })
  it.each(['', '  ', '\uD800', 'x'.repeat(201)])('rejects invalid names %j', (value) => {
    expect(nameSchema.safeParse(value).success).toBe(false)
  })
  it('preserves valid names without normalization', () => {
    expect(nameSchema.parse(' Café ')).toBe(' Café ')
    expect(metadataPatchSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' })
  })
  it.each(['', '  ', ' reason', 'reason ', '\uDFFF', 'x'.repeat(2001)])(
    'rejects invalid reasons %j',
    (value) => {
      expect(reasonSchema.safeParse(value).success).toBe(false)
    },
  )
  it('validates a persisted project and refuses unknown/immutable patch keys', () => {
    const project = {
      format_version: 1,
      engagement_id: uuidV7(),
      metadata,
      lifecycle: draft,
      revision: 'b'.repeat(64),
    }
    expect(projectSchema.parse(project)).toEqual(project)
    expect(projectSchema.safeParse({ ...project, format_version: 2 }).success).toBe(false)
    for (const key of ['kind', 'engagement_id', 'revision', '__proto__', 'roe']) {
      expect(metadataPatchSchema.safeParse(JSON.parse(`{"${key}":"injected"}`)).success).toBe(false)
    }
  })
})

describe('versioned domain payloads', () => {
  it('round-trips creation without changing any signed envelope bytes', () => {
    const event = envelope('engagement.created', { ...operation(), metadata, lifecycle: draft })
    const parsed = parseProjectEvent(event)
    expect(parsed).toEqual(event)
    expect(encode(parsed)).toEqual(encode(parseEnvelope(event)))
  })
  it('requires an initial Draft or Lab state on creation', () => {
    const created = { ...operation(), metadata, lifecycle: { ...draft, state: 'active' } }
    expect(contracts.engagementCreatedPayloadV1Schema.safeParse(created).success).toBe(false)
    expect(
      contracts.engagementCreatedPayloadV1Schema.safeParse({
        ...created,
        lifecycle: { ...draft, kind: 'lab', state: 'lab' },
      }).success,
    ).toBe(true)
  })
  it('validates updates and refuses an empty update event', () => {
    const event = envelope('engagement.updated', { ...operation(), patch: { client_name: null } })
    expect(parseProjectEvent(event)).toEqual(event)
    expect(
      contracts.engagementUpdatedPayloadV1Schema.safeParse({ ...operation(), patch: {} }).success,
    ).toBe(false)
  })
  it('preserves both saved states in transition payloads', () => {
    const previous = { ...draft, state: 'paused', resume_state: 'closing', closing_origin: 'draft' }
    const next = { ...draft, state: 'closing', closing_origin: 'draft' }
    const event = envelope('engagement.state-changed', {
      ...operation(),
      command: 'resume',
      previous,
      next,
      reason: 'Resume wrap-up',
    })
    expect(parseProjectEvent(event)).toEqual(event)
  })
  it('validates reason and immutable kind without implementing the M2.6 policy', () => {
    const value = {
      ...operation(),
      command: 'activate',
      previous: draft,
      next: { ...draft, state: 'active' },
      reason: null,
    }
    expect(contracts.engagementStateChangedPayloadV1Schema.safeParse(value).success).toBe(true)
    expect(
      contracts.engagementStateChangedPayloadV1Schema.safeParse({ ...value, command: 'close' })
        .success,
    ).toBe(false)
    expect(
      contracts.engagementStateChangedPayloadV1Schema.safeParse({
        ...value,
        next: { ...draft, kind: 'lab', state: 'lab' },
      }).success,
    ).toBe(false)
  })
  it('binds a switch to its destination ledger', () => {
    const to = uuidV7()
    const payload = { ...operation(), from_project_id: uuidV7(), to_project_id: to, generation: 1 }
    expect(parseProjectEvent(envelope('project.switched', payload, to)).payload).toEqual(payload)
    expect(() => parseProjectEvent(envelope('project.switched', payload))).toThrow(/destination/)
    expect(
      contracts.projectSwitchedPayloadV1Schema.safeParse({ ...payload, from_project_id: to })
        .success,
    ).toBe(false)
    expect(
      contracts.projectSwitchedPayloadV1Schema.safeParse({ ...payload, generation: 0 }).success,
    ).toBe(false)
    expect(
      contracts.projectSwitchedPayloadV1Schema.safeParse({ ...payload, from_project_id: null })
        .success,
    ).toBe(true)
  })
  it('rejects unsupported versions, types, fields, and untyped payloads', () => {
    const event = envelope('engagement.created', { ...operation(), metadata, lifecycle: draft })
    for (const invalid of [
      { ...event, schema_version: 2 },
      { ...event, type: 'scope.object-added' },
      { ...event, payload: {} },
      { ...event, payload: { ...event.payload, extra: true } },
      { ...event, extra: true },
    ])
      expect(() => parseProjectEvent(invalid)).toThrow()
  })
})

describe('schema publication', () => {
  it('generates JSON Schema for each exported schema without opaque unknown objects', () => {
    for (const [name, schema] of Object.entries(contracts)) {
      if (!(schema instanceof z.ZodType)) continue
      const json = z.toJSONSchema(schema)
      expect(json, name).toBeTypeOf('object')
      expect(JSON.stringify(json), name).not.toContain('"additionalProperties":true')
    }
  })
})
