import { z } from 'zod'

export const textSchema = z.string().refine((value) => value.isWellFormed(), {
  message: 'text must contain well-formed Unicode',
})
/** Normalize operator input before length validation and command hashing. */
export const nameSchema = textSchema.trim().min(1).max(200)
export const reasonSchema = textSchema.trim().min(1).max(2000)

/** Version-1 ledger readers validate without rewriting already hashed text. */
export const storedNameV1Schema = textSchema
  .min(1)
  .max(200)
  .refine((value) => value.trim().length > 0, 'name must not be blank')
export const storedReasonV1Schema = textSchema
  .min(1)
  .max(2000)
  .refine((value) => value.trim() === value, 'stored reason must already be trimmed')
export const sequenceSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const projectKindSchema = z.enum(['engagement', 'lab'])
export const lifecycleStateSchema = z.enum([
  'draft',
  'lab',
  'active',
  'paused',
  'closing',
  'closed',
])
export const transitionCommandSchema = z.enum([
  'activate',
  'pause',
  'resume',
  'begin_closing',
  'cancel_closing',
  'close',
  'reopen',
])

export type ProjectKind = z.infer<typeof projectKindSchema>
export type LifecycleState = z.infer<typeof lifecycleStateSchema>
export type TransitionCommand = z.infer<typeof transitionCommandSchema>
