import { isIP } from 'node:net'
import { uuidV7Schema } from '@pentrackr/ledger'
import { z } from 'zod'
import { textSchema } from './primitives.js'

const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
export const domainSchema = textSchema.max(253).refine((value) => {
  const parts = value.split('.')
  return parts.length >= 2 && parts.every((part) => label.test(part))
}, 'invalid DNS name')
export const ipSchema = textSchema.refine((value) => isIP(value) !== 0, 'invalid IP address')
export function canonicalIp(value: string): string {
  return isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname : value
}
export const cidrSchema = textSchema.refine((value) => {
  const parts = value.split('/')
  if (parts.length !== 2) return false
  const family = isIP(parts[0] ?? '')
  const prefix = parts[1] ?? ''
  return (
    family !== 0 &&
    /^(0|[1-9][0-9]{0,2})$/.test(prefix) &&
    Number(prefix) <= (family === 4 ? 32 : 128)
  )
}, 'invalid CIDR')
export const urlSchema = textSchema.max(2048).refine((value) => {
  try {
    const url = new URL(value)
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      !url.hash
    )
  } catch {
    return false
  }
}, 'invalid HTTP URL')
export const asnSchema = textSchema
  .regex(/^AS(?:[1-9][0-9]{0,9})$/)
  .refine((value) => BigInt(value.slice(2)) <= 4294967295n, 'ASN exceeds 32 bits')
const identifier = textSchema
  .min(1)
  .max(300)
  .refine((value) => value.trim() === value, 'identifier must be trimmed')
export const repositorySchema = textSchema.max(2048).refine((value) => {
  if (urlSchema.safeParse(value).success) return true
  const ssh = /^git@([^:]+):([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)(?:\.git)?$/.exec(value)
  return (
    ssh !== null && domainSchema.safeParse(ssh[1]).success && !ssh[2]?.split('/').includes('..')
  )
}, 'invalid repository URL')
const mobileIdentifier = identifier.refine(
  (value) => /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/.test(value),
  'invalid mobile app identifier',
)
const base = { id: uuidV7Schema, note: textSchema.max(1000).nullable() }
export const scopeObjectSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ ...base, kind: z.literal('cidr'), value: cidrSchema }),
    z.strictObject({ ...base, kind: z.literal('ip'), value: ipSchema }),
    z.strictObject({ ...base, kind: z.literal('domain'), value: domainSchema }),
    z.strictObject({ ...base, kind: z.literal('url'), value: urlSchema }),
    z.strictObject({ ...base, kind: z.literal('asn'), value: asnSchema }),
    z.strictObject({
      ...base,
      kind: z.literal('cloud_account'),
      provider: z.enum(['aws', 'azure', 'gcp', 'other']),
      value: identifier,
    }),
    z.strictObject({
      ...base,
      kind: z.literal('cloud_subscription'),
      provider: z.enum(['azure', 'other']),
      value: identifier,
    }),
    z.strictObject({
      ...base,
      kind: z.literal('cloud_tenant'),
      provider: z.enum(['azure', 'gcp', 'other']),
      value: identifier,
    }),
    z.strictObject({ ...base, kind: z.literal('repository'), value: repositorySchema }),
    z.strictObject({
      ...base,
      kind: z.literal('mobile_app'),
      platform: z.enum(['android', 'ios', 'other']),
      value: mobileIdentifier,
    }),
  ])
  .superRefine((object, ctx) => {
    if (!('provider' in object)) return
    const value = object.value
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    let valid = true
    if (object.provider === 'aws') valid = /^[0-9]{12}$/.test(value)
    if (object.provider === 'azure') valid = uuid.test(value)
    if (object.provider === 'gcp') valid = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value)
    if (!valid)
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'invalid provider identifier' })
  })

export const scopeSchema = z
  .strictObject({
    inclusions: z.array(scopeObjectSchema).max(2000),
    exclusions: z.array(scopeObjectSchema).max(2000),
  })
  .superRefine((scope, ctx) => {
    const ids = new Set<string>()
    for (const [group, objects] of [
      ['inclusions', scope.inclusions],
      ['exclusions', scope.exclusions],
    ] as const) {
      for (let index = 0; index < objects.length; index++) {
        const id = objects[index]?.id
        if (id && ids.has(id))
          ctx.addIssue({
            code: 'custom',
            path: [group, index, 'id'],
            message: 'duplicate scope object ID',
          })
        if (id) ids.add(id)
      }
    }
  })
