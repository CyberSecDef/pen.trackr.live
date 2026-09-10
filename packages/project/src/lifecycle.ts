import { z } from 'zod'
import { lifecycleStateSchema, projectKindSchema } from './primitives.js'

/** Persisted state only. Blackout is an M5 effective restriction. */
export const lifecycleSchema = z
  .strictObject({
    kind: projectKindSchema,
    state: lifecycleStateSchema,
    resume_state: z.enum(['draft', 'lab', 'active', 'closing']).nullable(),
    closing_origin: z.enum(['draft', 'lab', 'active']).nullable(),
  })
  .superRefine((value, ctx) => {
    const liveStates = value.kind === 'lab' ? ['lab'] : ['draft', 'active']
    if (['draft', 'lab', 'active'].includes(value.state) && !liveStates.includes(value.state)) {
      ctx.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'state disagrees with project kind',
      })
    }
    if (value.state === 'paused') {
      if (
        value.resume_state === null ||
        (!liveStates.includes(value.resume_state) && value.resume_state !== 'closing')
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['resume_state'],
          message: 'paused state needs a valid resume state',
        })
      }
    } else if (value.resume_state !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['resume_state'],
        message: 'resume state exists only while paused',
      })
    }
    const needsOrigin =
      value.state === 'closing' || (value.state === 'paused' && value.resume_state === 'closing')
    if (
      needsOrigin
        ? value.closing_origin === null || !liveStates.includes(value.closing_origin)
        : value.closing_origin !== null
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['closing_origin'],
        message: 'closing origin must match kind and closing episode',
      })
    }
  })

export type Lifecycle = z.infer<typeof lifecycleSchema>
