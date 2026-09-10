import { z } from 'zod'

export const textSchema = z.string().refine((value) => value.isWellFormed(), {
  message: 'text must contain well-formed Unicode',
})
export const nameSchema = textSchema
  .min(1)
  .max(200)
  .refine((value) => value.trim().length > 0, {
    message: 'name must not be blank',
  })
export const reasonSchema = textSchema
  .min(1)
  .max(2000)
  .refine((value) => value.trim() === value && value.length > 0, {
    message: 'reason must be nonblank and trimmed',
  })
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
