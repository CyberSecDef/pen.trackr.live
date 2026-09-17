import { encode, sealEvent, uuidV7 } from '@pentrackr/ledger'
import { describe, expect, it } from 'vitest'
import {
  calendarDateSchema,
  cidrSchema,
  completeMetadataV2Input,
  completeMetadataV2Patch,
  emptyMetadataV2,
  localDateTimeSchema,
  localInstant,
  metadataV2FromV1,
  metadataV2InputSchema,
  metadataV2PatchSchema,
  metadataV2Schema,
  parseProjectEvent,
  projectV2Schema,
  scopeSchema,
  storedMetadataV2PatchSchema,
  timeWindowSchema,
  urlSchema,
} from '../src/index.js'

const id = () => uuidV7()
const metadata = () => ({ name: 'Example', client_name: null, code_name: null, ...emptyMetadataV2 })
const scopeObject = (kind: string, value: string) => ({ id: id(), kind, value, note: null })

describe('M2.4 metadata contracts', () => {
  it('accepts minimal Draft/Lab metadata and keeps absent scope distinct from empty scope', () => {
    expect(metadataV2InputSchema.safeParse({ name: 'Practice' }).success).toBe(true)
    expect(completeMetadataV2Input({ name: ' Practice ' }, id())).toEqual({
      ...metadata(),
      name: 'Practice',
    })
    expect(metadataV2FromV1({ name: 'Example', client_name: null, code_name: null })).toEqual(
      metadata(),
    )
    expect(
      projectV2Schema.safeParse({
        format_version: 1,
        engagement_id: id(),
        metadata: metadata(),
        lifecycle: { kind: 'lab', state: 'lab', resume_state: null, closing_origin: null },
        revision: 'a'.repeat(64),
      }).success,
    ).toBe(true)
    expect(metadataV2Schema.parse(metadata()).scope).toBeNull()
    expect(
      metadataV2Schema.parse({ ...metadata(), scope: { inclusions: [], exclusions: [] } }).scope,
    ).toEqual({ inclusions: [], exclusions: [] })
    expect(metadataV2PatchSchema.parse({})).toEqual({})
    expect(metadataV2PatchSchema.parse({ legal: null })).toEqual({ legal: null })
    expect(metadataV2PatchSchema.safeParse({ legal: undefined }).success).toBe(false)
    expect(metadataV2PatchSchema.safeParse({ engagement_id: id() }).success).toBe(false)
  })
  it('enforces single local operator and stable unique roster/contact identities', () => {
    const member = {
      id: id(),
      name: 'Alice',
      role: 'Lead',
      identity: 'local_operator',
      operator_id: id(),
    }
    expect(
      metadataV2Schema.safeParse({ ...metadata(), roster: [member, { ...member, id: id() }] })
        .success,
    ).toBe(false)
    expect(
      metadataV2Schema.safeParse({
        ...metadata(),
        roster: [member, { ...member, identity: 'external' }],
      }).success,
    ).toBe(false)
    expect(
      metadataV2Schema.safeParse({
        ...metadata(),
        roster: [
          member,
          { id: id(), name: 'Bob', role: 'Tester', identity: 'external', operator_id: null },
        ],
      }).success,
    ).toBe(true)
    expect(
      metadataV2Schema.safeParse({ ...metadata(), source_ips: ['192.0.2.1', '192.0.2.1'] }).success,
    ).toBe(false)
    expect(metadataV2Schema.safeParse({ ...metadata(), source_ips: ['not-an-ip'] }).success).toBe(
      false,
    )
    expect(
      metadataV2Schema.safeParse({
        ...metadata(),
        source_ips: ['2001:db8::1', '2001:0db8:0:0:0:0:0:1'],
      }).success,
    ).toBe(false)
    expect(
      metadataV2Schema.safeParse({ ...metadata(), roster: [{ ...member, operator_id: null }] })
        .success,
    ).toBe(false)
    const rosterInput = [
      { id: member.id, name: member.name, role: member.role, identity: member.identity },
    ]
    expect(metadataV2InputSchema.safeParse({ name: 'Example', roster: rosterInput }).success).toBe(
      true,
    )
    expect(metadataV2InputSchema.safeParse({ name: 'Example', roster: [member] }).success).toBe(
      false,
    )
    expect(
      completeMetadataV2Input({ name: 'Example', roster: rosterInput }, member.operator_id)
        .roster[0]?.operator_id,
    ).toBe(member.operator_id)
    expect(
      completeMetadataV2Patch({ roster: rosterInput }, member.operator_id).roster?.[0]?.operator_id,
    ).toBe(member.operator_id)
  })
  it('accepts document references and validates real NDA dates without bytes or paths', () => {
    const nda = {
      reference: 'NDA-42',
      document_id: null,
      effective_from: '2026-01-01',
      effective_to: '2026-12-31',
    }
    const legal = { sow: null, authorization: null, nda }
    expect(metadataV2Schema.safeParse({ ...metadata(), legal }).success).toBe(true)
    expect(
      metadataV2Schema.safeParse({
        ...metadata(),
        legal: { ...legal, nda: { ...nda, effective_to: '2025-12-31' } },
      }).success,
    ).toBe(false)
    expect(
      metadataV2Schema.safeParse({
        ...metadata(),
        legal: { ...legal, nda: { ...nda, attachment_bytes: 'AA==' } },
      }).success,
    ).toBe(false)
    expect(
      metadataV2Schema.safeParse({
        ...metadata(),
        legal: { ...legal, nda: { ...nda, document_id: '/tmp/nda.pdf' } },
      }).success,
    ).toBe(false)
    expect(calendarDateSchema.safeParse('2026-02-29').success).toBe(false)
    expect(calendarDateSchema.safeParse('2024-02-29').success).toBe(true)
    for (const date of ['0000-01-01', '2026-13-01', '2026-04-31'])
      expect(calendarDateSchema.safeParse(date).success).toBe(false)
  })
  it('validates all scope kinds and rejects bad syntax and duplicate IDs', () => {
    const inclusions = [
      scopeObject('cidr', '192.0.2.0/24'),
      scopeObject('ip', '2001:db8::1'),
      scopeObject('domain', 'example.com'),
      scopeObject('url', 'https://example.com/path'),
      scopeObject('asn', 'AS64512'),
      { ...scopeObject('cloud_account', '123456789012'), provider: 'aws' },
      {
        ...scopeObject('cloud_subscription', '11111111-2222-3333-4444-555555555555'),
        provider: 'azure',
      },
      { ...scopeObject('cloud_tenant', '66666666-7777-8888-9999-aaaaaaaaaaaa'), provider: 'azure' },
      scopeObject('repository', 'https://github.com/example/repo'),
      { ...scopeObject('mobile_app', 'com.example.app'), platform: 'android' },
    ]
    expect(scopeSchema.safeParse({ inclusions, exclusions: [] }).success).toBe(true)
    expect(
      scopeSchema.safeParse({
        inclusions: [{ ...scopeObject('cloud_account', 'example-project'), provider: 'gcp' }],
        exclusions: [],
      }).success,
    ).toBe(true)
    expect(
      scopeSchema.safeParse({
        inclusions: [{ ...scopeObject('cloud_account', 'not-a-guid'), provider: 'azure' }],
        exclusions: [],
      }).success,
    ).toBe(false)
    expect(
      scopeSchema.safeParse({
        inclusions: [scopeObject('repository', 'git@github.com:example/repo.git')],
        exclusions: [],
      }).success,
    ).toBe(true)
    expect(
      scopeSchema.safeParse({
        inclusions: [{ ...scopeObject('cloud_account', 'bad'), provider: 'aws' }],
        exclusions: [],
      }).success,
    ).toBe(false)
    expect(scopeSchema.safeParse({ inclusions, exclusions: [{ ...inclusions[0] }] }).success).toBe(
      false,
    )
    for (const object of [
      scopeObject('cidr', '192.0.2.1/33'),
      scopeObject('ip', '999.1.1.1'),
      scopeObject('domain', 'bad..com'),
      scopeObject('url', 'file:///tmp/a'),
      scopeObject('asn', 'AS4294967296'),
    ])
      expect(scopeSchema.safeParse({ inclusions: [object], exclusions: [] }).success).toBe(false)
    for (const value of ['192.0.2.1', '192.0.2.0/x', '2001:db8::/129'])
      expect(cidrSchema.safeParse(value).success).toBe(false)
    for (const value of ['https://user@example.com/', 'https://example.com/#fragment'])
      expect(urlSchema.safeParse(value).success).toBe(false)
  })
  it('rejects daylight-saving gaps and overlaps without requiring UTC offsets', () => {
    const window = (starts_local: string, ends_local: string) => ({
      id: id(),
      starts_local,
      ends_local,
      timezone: 'America/New_York',
      after_hours_allowed: false,
    })
    expect(timeWindowSchema.safeParse(window('2026-03-08T01:30', '2026-03-08T03:30')).success).toBe(
      true,
    )
    expect(timeWindowSchema.safeParse(window('2026-03-08T02:30', '2026-03-08T03:30')).success).toBe(
      false,
    )
    expect(timeWindowSchema.safeParse(window('2026-11-01T01:30', '2026-11-01T02:30')).success).toBe(
      false,
    )
    expect(timeWindowSchema.safeParse(window('2026-03-08T03:30', '2026-03-08T01:30')).success).toBe(
      false,
    )
    expect(
      timeWindowSchema.safeParse({
        ...window('2026-03-08T01:30', '2026-03-08T03:30'),
        timezone: 'Mars/Phobos',
      }).success,
    ).toBe(false)
    expect(localInstant('2026-03-08T01:30', 'America/New_York')).toBe(
      Date.parse('2026-03-08T06:30:00Z'),
    )
    expect(localInstant('2026-03-08T02:30', 'America/New_York')).toBeNull()
    expect(localInstant('2026-11-01T01:30', 'America/New_York')).toBeNull()
    expect(localInstant('invalid', 'UTC')).toBeNull()
    expect(localInstant('2026-01-01T12:00', 'Mars/Phobos')).toBeNull()
    for (const value of ['2026-01-01T12:60', '2026-01-01T12:00:60'])
      expect(localDateTimeSchema.safeParse(value).success).toBe(false)
    expect(timeWindowSchema.safeParse(window('2026-02-30T12:00', '2026-03-01T12:00')).success).toBe(
      false,
    )
    expect(timeWindowSchema.safeParse(window('2026-01-01T24:00', '2026-01-02T01:00')).success).toBe(
      false,
    )
  })
  it('validates RoE contradictions, collection IDs, and input attribution', () => {
    const window = {
      id: id(),
      starts_local: '2026-01-01T10:00',
      ends_local: '2026-01-01T11:00',
      timezone: 'UTC',
      after_hours_allowed: false,
    }
    const roe = {
      permitted_techniques: ['scan'],
      forbidden_techniques: [],
      destructive_policy: 'forbid',
      testing_windows: [window],
      blackout_windows: [],
    }
    expect(metadataV2Schema.safeParse({ ...metadata(), roe }).success).toBe(true)
    expect(
      metadataV2Schema.safeParse({ ...metadata(), roe: { ...roe, forbidden_techniques: ['SCAN'] } })
        .success,
    ).toBe(false)
    expect(
      metadataV2Schema.safeParse({ ...metadata(), roe: { ...roe, blackout_windows: [window] } })
        .success,
    ).toBe(false)
    expect(
      metadataV2Schema.safeParse({ ...metadata(), assessment_types: ['api', 'api'] }).success,
    ).toBe(false)
    const contact = {
      id: id(),
      name: 'Client',
      purpose: 'both',
      details: 'Call desk',
      available_24_7: true,
    }
    expect(
      metadataV2Schema.safeParse({ ...metadata(), contacts: [contact, contact] }).success,
    ).toBe(false)
    expect(() => completeMetadataV2Input({ name: 'Lab' }, 'not-a-uuid')).toThrow()
    expect(() => completeMetadataV2Patch({ code_name: null }, 'not-a-uuid')).toThrow()
    expect(storedMetadataV2PatchSchema.safeParse({ code_name: undefined }).success).toBe(false)
    expect(
      metadataV2InputSchema.safeParse({ name: 'Lab', assessment_types: ['api', 'api'] }).success,
    ).toBe(false)
  })
  it('round-trips version-2 metadata through canonical ledger bytes', () => {
    const event = sealEvent({
      event_id: id(),
      engagement_id: id(),
      operator_id: id(),
      prev_hash: null,
      ts_utc: '2026-09-17T20:00:00.000Z',
      ts_local: '2026-09-17T16:00:00.000-04:00',
      tz: 'America/New_York',
      type: 'engagement.created',
      schema_version: 2,
      payload: {
        operation_id: id(),
        command_hash: 'a'.repeat(64),
        metadata: metadata(),
        lifecycle: { kind: 'lab', state: 'lab', resume_state: null, closing_origin: null },
      },
    })
    expect(encode(parseProjectEvent(event))).toEqual(encode(event))
    const { this_hash: _hash, ...unhashed } = event
    const updated = sealEvent({
      ...unhashed,
      event_id: id(),
      type: 'engagement.updated',
      payload: { operation_id: id(), command_hash: 'b'.repeat(64), patch: { name: ' Acme ' } },
    })
    expect(encode(parseProjectEvent(updated))).toEqual(encode(updated))
    expect(() => parseProjectEvent({ ...event, schema_version: 3 })).toThrow()
  })
})
