import { isIP } from 'node:net'
import { posix } from 'node:path'
import { textSchema } from '@pentrackr/project'
import { z } from 'zod'

export const absolutePathSchema = textSchema
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !value.includes('\0') &&
      (posix.isAbsolute(value) ||
        /^[A-Za-z]:[\\/]/.test(value) ||
        /^\\\\[^\\]+\\[^\\]+/.test(value)),
    'expected an absolute project/core path',
  )
const originSchema = textSchema.max(2048).refine((value) => {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value
  } catch {
    return false
  }
}, 'expected an HTTP(S) origin without path, credentials, or wildcard')

export const coreConfigSchema = z
  .strictObject({
    config_version: z.literal(1),
    data_dir: absolutePathSchema,
    projects_dir: absolutePathSchema,
    auth_provider: z.enum(['keychain', 'passphrase']),
    bind_address: textSchema
      .refine((value) => isIP(value) !== 0, 'bind address must be an IP literal')
      .default('127.0.0.1'),
    port: z.number().int().min(0).max(65535).default(0),
    allow_non_loopback: z.boolean().default(false),
    allowed_hosts: z
      .array(
        textSchema
          .min(1)
          .max(255)
          .refine((value) => !/[\s*/\\@?#]/.test(value), 'invalid host allowlist entry'),
      )
      .max(32)
      .default([]),
    allowed_origins: z.array(originSchema).max(32).default([]),
    switch_hook_timeout_ms: z.number().int().min(1000).max(30_000).default(5000),
  })
  .superRefine((value, ctx) => {
    const loopback =
      (isIP(value.bind_address) === 6 &&
        new URL(`http://[${value.bind_address}]`).hostname === '[::1]') ||
      (isIP(value.bind_address) === 4 && value.bind_address.split('.')[0] === '127')
    if (!loopback && !value.allow_non_loopback) {
      ctx.addIssue({
        code: 'custom',
        path: ['allow_non_loopback'],
        message: 'wider bind requires explicit opt-in',
      })
    }
  })
export type CoreConfig = z.infer<typeof coreConfigSchema>
