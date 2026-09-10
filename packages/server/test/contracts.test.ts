import { sealEvent, uuidV7 } from '@pentrackr/ledger'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as schemas from '../src/index.js'

const id = uuidV7()
const context = { instance_id: uuidV7(), generation: 0, project_id: null }
const headers = { 'idempotency-key': uuidV7(), 'x-pentrackr-context': `${context.instance_id}:0` }
const lifecycle = { kind: 'lab', state: 'lab', resume_state: null, closing_origin: null }
const project = {
  format_version: 1,
  engagement_id: id,
  metadata: { name: 'Test lab', client_name: null, code_name: null },
  lifecycle,
  revision: 'a'.repeat(64),
}
const item = {
  project_id: id,
  availability: 'available',
  error_code: null,
  project,
  unread_findings: null,
  unread_tasks: null,
  capabilities: { findings: false, tasks: false, scope_evaluation: false },
}
const config = {
  config_version: 1,
  data_dir: '/tmp/pentrackr',
  projects_dir: '/tmp/projects',
  auth_provider: 'passphrase',
}

describe('requests and concurrency', () => {
  it('groups all creation fields under metadata, with no legal prerequisites', () => {
    expect(
      schemas.createProjectRequestSchema.parse({ kind: 'lab', metadata: { name: ' Practice ' } }),
    ).toEqual({
      kind: 'lab',
      metadata: { name: 'Practice' },
    })
    expect(
      schemas.createProjectRequestSchema.parse({
        kind: 'engagement',
        metadata: { name: ' Test ', client_name: ' Acme ', code_name: null },
      }),
    ).toEqual({
      kind: 'engagement',
      metadata: { name: 'Test', client_name: 'Acme', code_name: null },
    })
  })
  it.each(['engagement_id', 'operator_id', 'state', 'revision', 'legal_approved', 'extra', 'name'])(
    'refuses client-authored top-level %s on creation',
    (key) => {
      expect(
        schemas.createProjectRequestSchema.safeParse({
          kind: 'lab',
          metadata: { name: 'Test' },
          [key]: true,
        }).success,
      ).toBe(false)
    },
  )
  it('rejects the old creation shape and invalid nested metadata', () => {
    for (const value of [
      { name: 'Old shape', kind: 'lab' },
      { kind: 'lab' },
      { kind: 'lab', metadata: {} },
      { kind: 'lab', metadata: { name: 'Test', unknown: true } },
      { kind: 'lab', metadata: { name: 'Test' }, destination: null },
    ])
      expect(schemas.createProjectRequestSchema.safeParse(value).success).toBe(false)
  })
  it('distinguishes patch omission, clearing, and empty/no-op patches', () => {
    expect(schemas.updateProjectRequestSchema.parse({})).toEqual({})
    expect(schemas.updateProjectRequestSchema.parse({ code_name: null })).toEqual({
      code_name: null,
    })
    expect(schemas.updateProjectRequestSchema.safeParse({ code_name: undefined }).success).toBe(
      false,
    )
    expect(schemas.updateProjectRequestSchema.safeParse({ name: null }).success).toBe(false)
  })
  it('checks instance/generation, revision, and idempotency headers', () => {
    expect(schemas.registryPreconditionsSchema.parse(headers)).toEqual(headers)
    const mutation = { ...headers, 'if-match': `"${project.revision}"` }
    expect(schemas.mutationPreconditionsSchema.parse(mutation)).toEqual(mutation)
    expect(schemas.mutationPreconditionsSchema.safeParse(headers).success).toBe(false)
    expect(
      schemas.registryPreconditionsSchema.safeParse({ ...headers, 'idempotency-key': 'random' })
        .success,
    ).toBe(false)
    for (const bad of ['*', project.revision, `W/"${project.revision}"`, `"${'A'.repeat(64)}"`]) {
      expect(
        schemas.mutationPreconditionsSchema.safeParse({ ...mutation, 'if-match': bad }).success,
      ).toBe(false)
    }
  })
  it.each([
    'bad:0',
    `${id}:-1`,
    `${id}:01`,
    `${id}:1.5`,
    `${id}:9007199254740992`,
    '00000000-0000-4000-8000-000000000000:0',
  ])('rejects invalid context token %s', (value) => {
    expect(
      schemas.registryPreconditionsSchema.safeParse({ ...headers, 'x-pentrackr-context': value })
        .success,
    ).toBe(false)
  })
  it('requires reasons except for activate, and rejects Blackout as a command', () => {
    expect(schemas.transitionRequestSchema.parse({ command: 'close', reason: ' done ' })).toEqual({
      command: 'close',
      reason: 'done',
    })
    expect(
      schemas.transitionRequestSchema.safeParse({ command: 'activate', reason: null }).success,
    ).toBe(true)
    for (const command of [
      'pause',
      'resume',
      'begin_closing',
      'cancel_closing',
      'close',
      'reopen',
    ]) {
      expect(schemas.transitionRequestSchema.safeParse({ command, reason: null }).success).toBe(
        false,
      )
      expect(
        schemas.transitionRequestSchema.safeParse({ command, reason: 'Operator decision' }).success,
      ).toBe(true)
    }
    expect(
      schemas.transitionRequestSchema.safeParse({ command: 'blackout', reason: 'Set state' })
        .success,
    ).toBe(false)
  })
  it('supports explicit selection and clearing, without an implicit active ID', () => {
    expect(schemas.switchRequestSchema.parse({ project_id: id })).toEqual({ project_id: id })
    expect(schemas.switchRequestSchema.parse({ project_id: null })).toEqual({ project_id: null })
    expect(schemas.switchRequestSchema.safeParse({}).success).toBe(false)
    expect(schemas.projectParamsSchema.parse({ project_id: id })).toEqual({ project_id: id })
  })
  it('bounds typed query parameters without coercing ambiguous input', () => {
    expect(schemas.projectListQuerySchema.parse({})).toEqual({ limit: 50 })
    expect(schemas.eventListQuerySchema.parse({})).toEqual({ limit: 50, after_seq: 0 })
    for (const limit of [0, -1, 201, 1.5, '10', null])
      expect(schemas.eventListQuerySchema.safeParse({ limit }).success).toBe(false)
    expect(schemas.projectListQuerySchema.parse({ after_id: id, limit: 200 })).toEqual({
      after_id: id,
      limit: 200,
    })
    expect(schemas.eventListQuerySchema.safeParse({ after_seq: -1 }).success).toBe(false)
    expect(schemas.emptyRequestSchema.safeParse({ unexpected: true }).success).toBe(false)
  })
})

describe('response contracts', () => {
  it('links mutation status to a committed event or an explicit no-op', () => {
    const response = { operation_id: uuidV7(), event_id: uuidV7(), changed: true, project }
    expect(schemas.mutationResponseSchema.parse(response)).toEqual(response)
    expect(schemas.mutationResponseSchema.safeParse({ ...response, event_id: null }).success).toBe(
      false,
    )
    expect(
      schemas.mutationResponseSchema.safeParse({ ...response, event_id: null, changed: false })
        .success,
    ).toBe(true)
    expect(
      schemas.switchResponseSchema.safeParse({ operation_id: id, changed: true, context }).success,
    ).toBe(true)
  })
  it('keeps unavailable projects visible without fabricating counts', () => {
    expect(schemas.projectListItemSchema.safeParse(item).success).toBe(true)
    const missing = {
      ...item,
      availability: 'missing',
      project: null,
      error_code: 'path_unavailable',
    }
    expect(
      schemas.projectListResponseSchema.safeParse({ items: [item, missing], next_after_id: null })
        .success,
    ).toBe(true)
    for (const invalid of [
      { ...item, project: null },
      { ...item, unread_tasks: 0 },
      { ...missing, error_code: null },
      { ...item, project_id: uuidV7() },
    ])
      expect(schemas.projectListItemSchema.safeParse(invalid).success).toBe(false)
  })
  it('rejects a ledger page containing another project even when each event is valid', () => {
    const envelope = sealEvent({
      event_id: uuidV7(),
      engagement_id: id,
      operator_id: uuidV7(),
      prev_hash: null,
      ts_utc: '2026-09-09T12:00:00.000Z',
      ts_local: '2026-09-09T12:00:00.000Z',
      tz: 'UTC',
      schema_version: 1,
      type: 'manual.logged',
      payload: { note: 'Example' },
    })
    const page = { project_id: id, items: [schemas.toWireEvent(1, envelope)], next_after_seq: 1 }
    expect(schemas.eventListResponseSchema.safeParse(page).success).toBe(true)
    expect(
      schemas.eventListResponseSchema.safeParse({ ...page, project_id: uuidV7() }).success,
    ).toBe(false)
  })
  it('requires a files-preserved warning from unregister', () => {
    const response = {
      operation_id: id,
      project_id: id,
      warnings: [
        {
          code: 'files_preserved',
          path: '/tmp/project',
          message: 'Project files remain. Register the directory to restore it to the list.',
        },
      ],
    }
    expect(schemas.unregisterResponseSchema.safeParse(response).success).toBe(true)
    expect(schemas.unregisterResponseSchema.safeParse({ ...response, warnings: [] }).success).toBe(
      false,
    )
    expect(
      schemas.unregisterResponseSchema.safeParse({
        ...response,
        warnings: [{ ...response.warnings[0], code: 'path_unavailable' }],
      }).success,
    ).toBe(false)
  })
  it('publishes health, status, errors, and transition descriptions', () => {
    expect(schemas.healthResponseSchema.safeParse({ ok: true }).success).toBe(true)
    expect(
      schemas.statusResponseSchema.safeParse({ api_version: 1, ready: false, context }).success,
    ).toBe(true)
    expect(
      schemas.statusResponseSchema.safeParse({ api_version: 2, ready: true, context }).success,
    ).toBe(false)
    const error = {
      error: {
        code: 'invalid_input',
        message: 'Invalid metadata',
        request_id: id,
        details: [{ path: ['metadata', 'name'], message: 'Name is blank' }],
      },
    }
    expect(schemas.errorResponseSchema.parse(error)).toEqual(error)
    expect(
      schemas.errorResponseSchema.safeParse({ error: { ...error.error, stack: 'private' } })
        .success,
    ).toBe(false)
    expect(
      schemas.allowedTransitionsResponseSchema.safeParse({
        lifecycle,
        revision: project.revision,
        commands: [{ command: 'pause', allowed: true, reason: null }],
      }).success,
    ).toBe(true)
    expect(
      schemas.eventListResponseSchema.safeParse({ project_id: id, items: [], next_after_seq: null })
        .success,
    ).toBe(true)
  })
})

describe('core configuration', () => {
  it('requires explicit provider/directories and supplies safe network defaults', () => {
    const parsed = schemas.coreConfigSchema.parse(config)
    expect(parsed).toMatchObject({
      bind_address: '127.0.0.1',
      port: 0,
      allow_non_loopback: false,
      switch_hook_timeout_ms: 5000,
    })
    expect(
      schemas.coreConfigSchema.safeParse({ ...config, auth_provider: undefined }).success,
    ).toBe(false)
    expect(schemas.coreConfigSchema.safeParse({ ...config, auth_provider: 'none' }).success).toBe(
      false,
    )
    expect(
      schemas.coreConfigSchema.safeParse({ ...config, auth_provider: 'keychain' }).success,
    ).toBe(true)
  })
  it.each([
    '/tmp/project',
    'C:\\Projects\\example',
    'C:/Projects/example',
    '\\\\server\\share\\example',
  ])('accepts cross-platform absolute path %s', (directory) => {
    expect(schemas.registerProjectRequestSchema.parse({ directory })).toEqual({ directory })
  })
  it.each(['', 'relative/path', '../outside', 'C:relative', '\\relative', '/tmp/\0bad'])(
    'rejects nonabsolute/invalid path %j',
    (value) => {
      expect(schemas.absolutePathSchema.safeParse(value).success).toBe(false)
    },
  )
  it.each([
    '127.0.0.1',
    '127.9.8.7',
    '::1',
    '0:0:0:0:0:0:0:1',
    '::ffff:127.0.0.1',
    '::ffff:127.255.255.255',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:7f00:1',
  ])('recognizes loopback %s', (bind_address) => {
    expect(schemas.coreConfigSchema.safeParse({ ...config, bind_address }).success).toBe(true)
  })
  it.each([
    '0.0.0.0',
    '::',
    '10.0.0.1',
    '::ffff:126.255.255.255',
    '::ffff:128.0.0.1',
    '::ffff:10.0.0.1',
  ])('requires explicit wider-bind opt-in for %s', (bind_address) => {
    expect(schemas.coreConfigSchema.safeParse({ ...config, bind_address }).success).toBe(false)
    expect(
      schemas.coreConfigSchema.safeParse({ ...config, bind_address, allow_non_loopback: true })
        .success,
    ).toBe(true)
  })
  it('rejects invalid network fields, wildcards, unsafe origins and secret config fields', () => {
    for (const patch of [
      { bind_address: 'localhost' },
      { bind_address: 'invalid' },
      { port: 65536 },
      { port: -1 },
      { allowed_hosts: ['*'] },
      { allowed_hosts: ['host/path'] },
      { allowed_origins: ['*'] },
      { allowed_origins: ['https://example.test/path'] },
      { allowed_origins: ['http://user:password@example.test'] },
      { allowed_origins: ['file:///tmp'] },
      { allowed_origins: ['invalid'] },
      { switch_hook_timeout_ms: 999 },
      { switch_hook_timeout_ms: 30_001 },
      { token: 'never-in-config' },
      { config_version: 2 },
    ])
      expect(schemas.coreConfigSchema.safeParse({ ...config, ...patch }).success).toBe(false)
    expect(
      schemas.coreConfigSchema.safeParse({
        ...config,
        allowed_hosts: ['localhost:1234', '[::1]:1234'],
        allowed_origins: ['http://localhost:1234', 'https://example.test'],
      }).success,
    ).toBe(true)
  })
})

describe('generated schema compatibility', () => {
  it('converts every exported schema to JSON Schema', () => {
    for (const [name, schema] of Object.entries(schemas)) {
      if (!(schema instanceof z.ZodType)) continue
      expect(() => z.toJSONSchema(schema), name).not.toThrow()
    }
  })
})
