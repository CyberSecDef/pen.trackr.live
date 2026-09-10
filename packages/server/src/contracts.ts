import { hashSchema, uuidV7Schema } from '@pentrackr/ledger'
import {
  lifecycleSchema,
  metadataPatchSchema,
  nameSchema,
  projectKindSchema,
  projectSchema,
  reasonSchema,
  sequenceSchema,
  textSchema,
  transitionCommandSchema,
} from '@pentrackr/project'
import { z } from 'zod'
import { absolutePathSchema } from './config.js'
import { wireEventSchema } from './wire.js'

export const contextSchema = z.strictObject({
  instance_id: uuidV7Schema,
  generation: sequenceSchema,
  project_id: uuidV7Schema.nullable(),
})
// Header schemas validate extracted fields, not the entire HTTP header object.
export const registryPreconditionsSchema = z.strictObject({
  'idempotency-key': uuidV7Schema,
  'x-pentrackr-context': textSchema.regex(/^[0-9a-f-]{36}:(?:0|[1-9][0-9]*)$/).refine((value) => {
    const [instance, generation] = value.split(':')
    return (
      uuidV7Schema.safeParse(instance).success &&
      sequenceSchema.safeParse(Number(generation)).success
    )
  }, 'invalid instance/generation context token'),
})
export const mutationPreconditionsSchema = registryPreconditionsSchema.extend({
  'if-match': textSchema.regex(/^"[0-9a-f]{64}"$/),
})
export const createProjectRequestSchema = z.strictObject({
  kind: projectKindSchema,
  name: nameSchema,
  metadata: z
    .strictObject({
      client_name: nameSchema.nullable().optional(),
      code_name: nameSchema.nullable().optional(),
    })
    .optional(),
  destination: absolutePathSchema.optional(),
})
export const registerProjectRequestSchema = z.strictObject({ directory: absolutePathSchema })
export const projectParamsSchema = z.strictObject({ project_id: uuidV7Schema })
export const updateProjectRequestSchema = metadataPatchSchema
export const transitionRequestSchema = z
  .strictObject({
    command: transitionCommandSchema,
    reason: reasonSchema.nullable(),
  })
  .refine((value) => value.command === 'activate' || value.reason !== null, {
    path: ['reason'],
    message: 'transition requires a reason',
  })
export const switchRequestSchema = z.strictObject({ project_id: uuidV7Schema.nullable() })
export const projectListQuerySchema = z.strictObject({
  after_id: uuidV7Schema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
})
export const eventListQuerySchema = z.strictObject({
  after_seq: sequenceSchema.default(0),
  limit: z.number().int().min(1).max(200).default(50),
})
export const emptyRequestSchema = z.strictObject({})

export const mutationResponseSchema = z
  .strictObject({
    operation_id: uuidV7Schema,
    event_id: uuidV7Schema.nullable(),
    changed: z.boolean(),
    project: projectSchema,
  })
  .refine(
    (value) => value.changed === (value.event_id !== null),
    'changed operations must identify their event',
  )
export const switchResponseSchema = z.strictObject({
  operation_id: uuidV7Schema,
  changed: z.boolean(),
  context: contextSchema,
})
export const projectListItemSchema = z
  .strictObject({
    project_id: uuidV7Schema,
    availability: z.enum([
      'available',
      'missing',
      'inaccessible',
      'corrupt',
      'unsupported',
      'in_use',
    ]),
    error_code: textSchema.min(1).nullable(),
    project: projectSchema.nullable(),
    unread_findings: z.null(),
    unread_tasks: z.null(),
    capabilities: z.strictObject({
      findings: z.literal(false),
      tasks: z.literal(false),
      scope_evaluation: z.literal(false),
    }),
  })
  .refine(
    (value) => value.project === null || value.project.engagement_id === value.project_id,
    'project identity mismatch',
  )
  .refine(
    (value) =>
      value.availability === 'available'
        ? value.project !== null && value.error_code === null
        : value.error_code !== null,
    'availability requires project data or an error code',
  )
export const projectListResponseSchema = z.strictObject({
  items: z.array(projectListItemSchema).max(200),
  next_after_id: uuidV7Schema.nullable(),
})
export const eventListResponseSchema = z
  .strictObject({
    project_id: uuidV7Schema,
    items: z.array(wireEventSchema).max(200),
    next_after_seq: sequenceSchema.nullable(),
  })
  .refine(
    (value) => value.items.every((item) => item.envelope.engagement_id === value.project_id),
    'event page contains another project',
  )
export const unregisterResponseSchema = z
  .strictObject({
    operation_id: uuidV7Schema,
    project_id: uuidV7Schema,
    warnings: z
      .array(
        z.strictObject({
          code: z.enum(['files_preserved', 'path_unavailable']),
          path: absolutePathSchema,
          message: textSchema.min(1).max(2000),
        }),
      )
      .min(1),
  })
  .refine(
    (value) => value.warnings.some((warning) => warning.code === 'files_preserved'),
    'unregister must warn that files remain',
  )

export const errorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: textSchema.regex(/^[a-z][a-z0-9_]{0,63}$/),
    message: textSchema.min(1).max(2000),
    request_id: uuidV7Schema,
    details: z
      .array(
        z.strictObject({
          path: z.array(z.union([textSchema.max(200), sequenceSchema])).max(64),
          message: textSchema.max(500),
        }),
      )
      .max(100),
  }),
})
export const healthResponseSchema = z.strictObject({ ok: z.boolean() })
export const statusResponseSchema = z.strictObject({
  api_version: z.literal(1),
  ready: z.boolean(),
  context: contextSchema,
})
export const allowedTransitionsResponseSchema = z.strictObject({
  lifecycle: lifecycleSchema,
  revision: hashSchema,
  commands: z
    .array(
      z.strictObject({
        command: transitionCommandSchema,
        allowed: z.boolean(),
        reason: textSchema.nullable(),
      }),
    )
    .max(7),
})

export type Context = z.infer<typeof contextSchema>
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>
export type TransitionRequest = z.infer<typeof transitionRequestSchema>
export type ErrorResponse = z.infer<typeof errorResponseSchema>
