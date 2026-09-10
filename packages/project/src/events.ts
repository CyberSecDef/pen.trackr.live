import { envelopeSchema, hashSchema, uuidV7Schema } from '@pentrackr/ledger'
import { z } from 'zod'
import { lifecycleSchema } from './lifecycle.js'
import { reasonSchema, sequenceSchema, transitionCommandSchema } from './primitives.js'
import { metadataPatchSchema, metadataSchema } from './project.js'

const operationShape = { operation_id: uuidV7Schema, command_hash: hashSchema }

export const engagementCreatedPayloadV1Schema = z
  .strictObject({
    ...operationShape,
    metadata: metadataSchema,
    lifecycle: lifecycleSchema,
  })
  .refine((value) => value.lifecycle.state === (value.lifecycle.kind === 'lab' ? 'lab' : 'draft'), {
    path: ['lifecycle', 'state'],
    message: 'a project starts in Draft or Lab',
  })

export const engagementUpdatedPayloadV1Schema = z.strictObject({
  ...operationShape,
  patch: metadataPatchSchema.refine(
    (value) => Object.keys(value).length > 0,
    'an update event requires a change',
  ),
})

export const engagementStateChangedPayloadV1Schema = z
  .strictObject({
    ...operationShape,
    command: transitionCommandSchema,
    previous: lifecycleSchema,
    next: lifecycleSchema,
    reason: reasonSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.previous.kind !== value.next.kind) {
      ctx.addIssue({ code: 'custom', path: ['next', 'kind'], message: 'project kind is immutable' })
    }
    if (value.command !== 'activate' && value.reason === null) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'transition requires a reason' })
    }
  })

export const projectSwitchedPayloadV1Schema = z
  .strictObject({
    ...operationShape,
    from_project_id: uuidV7Schema.nullable(),
    to_project_id: uuidV7Schema,
    generation: sequenceSchema.min(1),
  })
  .refine(
    (value) => value.from_project_id !== value.to_project_id,
    'same-project selection has no event',
  )

const base = envelopeSchema.omit({ payload: true, type: true, schema_version: true })
export const projectEventSchema = z
  .discriminatedUnion('type', [
    base.extend({
      type: z.literal('engagement.created'),
      schema_version: z.literal(1),
      payload: engagementCreatedPayloadV1Schema,
    }),
    base.extend({
      type: z.literal('engagement.updated'),
      schema_version: z.literal(1),
      payload: engagementUpdatedPayloadV1Schema,
    }),
    base.extend({
      type: z.literal('engagement.state-changed'),
      schema_version: z.literal(1),
      payload: engagementStateChangedPayloadV1Schema,
    }),
    base.extend({
      type: z.literal('project.switched'),
      schema_version: z.literal(1),
      payload: projectSwitchedPayloadV1Schema,
    }),
  ])
  .superRefine((event, ctx) => {
    if (event.type === 'project.switched' && event.engagement_id !== event.payload.to_project_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['engagement_id'],
        message: 'switch event belongs to destination ledger',
      })
    }
  })

/** Domain validation only; chain verification remains the ledger's responsibility. */
export function parseProjectEvent(value: unknown): ProjectEvent {
  return projectEventSchema.parse(value)
}
export type ProjectEvent = z.infer<typeof projectEventSchema>
