import { hashSchema, uuidV7Schema } from '@pentrackr/ledger'
import { z } from 'zod'
import { lifecycleSchema } from './lifecycle.js'
import { nameSchema, storedNameV1Schema } from './primitives.js'

/** Identity metadata floor; M2.4 adds the remaining engagement metadata. */
export const metadataSchema = z.strictObject({
  name: storedNameV1Schema,
  client_name: storedNameV1Schema.nullable(),
  code_name: storedNameV1Schema.nullable(),
})

export const metadataInputSchema = z.strictObject({
  name: nameSchema,
  client_name: nameSchema.nullable(),
  code_name: nameSchema.nullable(),
})

function rejectUndefined(patch: Record<string, unknown>, ctx: z.RefinementCtx): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined)
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: 'omit unchanged fields; use null to clear nullable fields',
      })
  }
}

export const metadataPatchSchema = metadataInputSchema.partial().superRefine(rejectUndefined)
export const storedMetadataPatchV1Schema = metadataSchema.partial().superRefine(rejectUndefined)

export const projectSchema = z.strictObject({
  format_version: z.literal(1),
  engagement_id: uuidV7Schema,
  metadata: metadataSchema,
  lifecycle: lifecycleSchema,
  revision: hashSchema,
})

export type Project = z.infer<typeof projectSchema>
export type Metadata = z.infer<typeof metadataSchema>
export type MetadataPatch = z.infer<typeof metadataPatchSchema>
