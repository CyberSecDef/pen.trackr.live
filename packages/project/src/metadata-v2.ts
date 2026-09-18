import { isIP } from 'node:net'
import { uuidV7Schema } from '@pentrackr/ledger'
import { z } from 'zod'
import { nameSchema, storedNameV1Schema, textSchema } from './primitives.js'
import type { Metadata } from './project.js'
import { canonicalIp, ipSchema, scopeSchema } from './scope.js'

const shortText = textSchema
  .min(1)
  .max(300)
  .refine((value) => value.trim() === value, 'text must be trimmed')
const longText = textSchema.max(4000)
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/
export const calendarDateSchema = textSchema.regex(datePattern).refine((value) => {
  const [, year, month, day] = datePattern.exec(value) ?? []
  const date = new Date(0)
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day))
  return (
    Number(year) >= 1 &&
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day)
  )
}, 'invalid calendar date')
export const timeZoneSchema = textSchema.refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}, 'invalid IANA time zone')
const localPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
export const localDateTimeSchema = textSchema.regex(localPattern).refine((value) => {
  const match = localPattern.exec(value)
  if (!match || !calendarDateSchema.safeParse(value.slice(0, 10)).success) return false
  return Number(match[4]) < 24 && Number(match[5]) < 60 && Number(match[6] ?? '0') < 60
}, 'invalid local date and time')

/** Reject DST gaps and overlaps; no implicit choice of an offset is made. */
export function localInstant(value: string, zone: string): number | null {
  if (!localDateTimeSchema.safeParse(value).success || !timeZoneSchema.safeParse(zone).success)
    return null
  const parts = localPattern.exec(value)
  if (!parts) return null
  const date = new Date(0)
  date.setUTCFullYear(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
  date.setUTCHours(Number(parts[4]), Number(parts[5]), Number(parts[6] ?? '0'), 0)
  const base = date.getTime()
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const target = [
    Number(parts[1]),
    Number(parts[2]),
    Number(parts[3]),
    Number(parts[4]),
    Number(parts[5]),
    Number(parts[6] ?? '0'),
  ].join(',')
  const wallParts = (instant: number): number[] => {
    const fields = Object.fromEntries(
      formatter.formatToParts(instant).map((part) => [part.type, part.value]),
    )
    return [fields.year, fields.month, fields.day, fields.hour, fields.minute, fields.second].map(
      Number,
    )
  }
  const offsets = new Set<number>()
  // Sample both sides of nearby transitions, including historical offsets with seconds.
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = base + hours * 3_600_000
    const wall = wallParts(sample)
    const local = new Date(0)
    local.setUTCFullYear(wall[0] ?? 0, (wall[1] ?? 1) - 1, wall[2] ?? 1)
    local.setUTCHours(wall[3] ?? 0, wall[4] ?? 0, wall[5] ?? 0, 0)
    offsets.add(local.getTime() - sample)
  }
  const matches = [...offsets]
    .map((offset) => base - offset)
    .filter((candidate) => wallParts(candidate).join(',') === target)
  return matches.length === 1 ? (matches[0] ?? null) : null
}

export const timeWindowSchema = z
  .strictObject({
    id: uuidV7Schema,
    starts_local: localDateTimeSchema,
    ends_local: localDateTimeSchema,
    timezone: timeZoneSchema,
    after_hours_allowed: z.boolean(),
  })
  .superRefine((window, ctx) => {
    const start = localInstant(window.starts_local, window.timezone)
    const end = localInstant(window.ends_local, window.timezone)
    if (start === null)
      ctx.addIssue({
        code: 'custom',
        path: ['starts_local'],
        message: 'local time is nonexistent or ambiguous in this zone',
      })
    if (end === null)
      ctx.addIssue({
        code: 'custom',
        path: ['ends_local'],
        message: 'local time is nonexistent or ambiguous in this zone',
      })
    if (start !== null && end !== null && start >= end)
      ctx.addIssue({ code: 'custom', path: ['ends_local'], message: 'end must follow start' })
  })
export const assessmentTypeSchema = z.enum([
  'external',
  'internal',
  'web_app',
  'api',
  'active_directory',
  'cloud',
  'red_team',
  'wireless',
  'physical',
  'social_engineering',
])
export const rosterMemberSchema = z
  .strictObject({
    id: uuidV7Schema,
    name: storedNameV1Schema,
    role: shortText,
    identity: z.enum(['local_operator', 'external']),
    operator_id: uuidV7Schema.nullable(),
  })
  .superRefine((member, ctx) => {
    if ((member.identity === 'local_operator') !== (member.operator_id !== null))
      ctx.addIssue({
        code: 'custom',
        path: ['operator_id'],
        message: 'only the local operator has a platform identity',
      })
  })
export const rosterMemberInputSchema = z.strictObject({
  id: uuidV7Schema,
  name: nameSchema,
  role: shortText,
  identity: z.enum(['local_operator', 'external']),
})
function mapRoster(roster: z.infer<typeof rosterMemberInputSchema>[], operatorId: string) {
  return roster.map((member) => ({
    ...member,
    operator_id: member.identity === 'local_operator' ? operatorId : null,
  }))
}
const validationOperatorId = '00000000-0000-7000-8000-000000000000'
export const contactSchema = z.strictObject({
  id: uuidV7Schema,
  name: storedNameV1Schema,
  purpose: z.enum(['escalation', 'deconfliction', 'both']),
  details: shortText,
  available_24_7: z.boolean(),
})
const documentReferenceSchema = z.strictObject({
  reference: shortText.nullable(),
  document_id: uuidV7Schema.nullable(),
})
export const legalSchema = z
  .strictObject({
    sow: documentReferenceSchema.nullable(),
    authorization: documentReferenceSchema.nullable(),
    nda: documentReferenceSchema
      .extend({
        effective_from: calendarDateSchema.nullable(),
        effective_to: calendarDateSchema.nullable(),
      })
      .nullable(),
  })
  .superRefine((legal, ctx) => {
    if (
      legal.nda?.effective_from &&
      legal.nda.effective_to &&
      legal.nda.effective_from > legal.nda.effective_to
    )
      ctx.addIssue({
        code: 'custom',
        path: ['nda', 'effective_to'],
        message: 'NDA end precedes start',
      })
  })
export const roeSchema = z
  .strictObject({
    permitted_techniques: z.array(shortText).max(200),
    forbidden_techniques: z.array(shortText).max(200),
    destructive_policy: z.enum(['forbid', 'require_dual_control', 'allow_in_window']),
    testing_windows: z.array(timeWindowSchema).max(500),
    blackout_windows: z.array(timeWindowSchema).max(500),
  })
  .superRefine((roe, ctx) => {
    const permitted = new Set(roe.permitted_techniques.map((value) => value.toLowerCase()))
    roe.forbidden_techniques.forEach((value, index) => {
      if (permitted.has(value.toLowerCase()))
        ctx.addIssue({
          code: 'custom',
          path: ['forbidden_techniques', index],
          message: 'technique is both permitted and forbidden',
        })
    })
    uniqueIds([...roe.testing_windows, ...roe.blackout_windows], ctx, 'testing_windows')
  })
export const dataHandlingSchema = z.strictObject({
  residency: shortText.nullable(),
  retention_instructions: longText.nullable(),
  pii_rules: longText.nullable(),
  phi_rules: longText.nullable(),
  pci_rules: longText.nullable(),
})
function uniqueIds(items: { id: string }[], ctx: z.RefinementCtx, field: string): void {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    if (seen.has(item.id))
      ctx.addIssue({ code: 'custom', path: [field, index, 'id'], message: 'duplicate ID' })
    seen.add(item.id)
  })
}

export const metadataV2Schema = z
  .strictObject({
    name: storedNameV1Schema,
    client_name: storedNameV1Schema.nullable(),
    code_name: storedNameV1Schema.nullable(),
    assessment_types: z.array(assessmentTypeSchema).max(10),
    roster: z.array(rosterMemberSchema).max(200),
    source_ips: z.array(ipSchema).max(200),
    contacts: z.array(contactSchema).max(200),
    jurisdiction: shortText.nullable(),
    data_handling: dataHandlingSchema.nullable(),
    legal: legalSchema.nullable(),
    scope: scopeSchema.nullable(),
    roe: roeSchema.nullable(),
  })
  .superRefine((metadata, ctx) => {
    for (const field of ['roster', 'contacts'] as const) uniqueIds(metadata[field], ctx, field)
    if (metadata.roster.filter((member) => member.identity === 'local_operator').length > 1)
      ctx.addIssue({
        code: 'custom',
        path: ['roster'],
        message: 'only one local operator mapping is allowed',
      })
    if (new Set(metadata.assessment_types).size !== metadata.assessment_types.length)
      ctx.addIssue({
        code: 'custom',
        path: ['assessment_types'],
        message: 'duplicate assessment type',
      })
    if (
      new Set(metadata.source_ips.map(canonicalIp)).size !== metadata.source_ips.length ||
      metadata.source_ips.some((ip) => !isIP(ip))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['source_ips'],
        message: 'duplicate or invalid source IP',
      })
  })

export const metadataV2InputSchema = z
  .strictObject({
    ...metadataV2Schema.shape,
    name: nameSchema,
    client_name: nameSchema.nullable().optional(),
    code_name: nameSchema.nullable().optional(),
    assessment_types: z.array(assessmentTypeSchema).max(10).optional(),
    roster: z.array(rosterMemberInputSchema).max(200).optional(),
    source_ips: z.array(ipSchema).max(200).optional(),
    contacts: z.array(contactSchema).max(200).optional(),
    jurisdiction: shortText.nullable().optional(),
    data_handling: dataHandlingSchema.nullable().optional(),
    legal: legalSchema.nullable().optional(),
    scope: scopeSchema.nullable().optional(),
    roe: roeSchema.nullable().optional(),
  })
  .superRefine((input, ctx) => {
    const result = metadataV2Schema.safeParse({
      ...emptyMetadataV2,
      client_name: null,
      code_name: null,
      ...input,
      roster: mapRoster(input.roster ?? [], validationOperatorId),
    })
    if (!result.success)
      for (const issue of result.error.issues)
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  })
export const metadataV2PatchSchema = z
  .strictObject({ ...metadataV2InputSchema.shape, name: nameSchema.optional() })
  .superRefine((patch, ctx) => {
    for (const [key, value] of Object.entries(patch))
      if (value === undefined)
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'omit unchanged fields; use null to clear nullable fields',
        })
    const result = metadataV2Schema.safeParse({
      ...emptyMetadataV2,
      name: 'placeholder',
      client_name: null,
      code_name: null,
      ...patch,
      roster: mapRoster(patch.roster ?? [], validationOperatorId),
    })
    if (!result.success)
      for (const issue of result.error.issues)
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  })
export const storedMetadataV2PatchSchema = z
  .strictObject({
    ...metadataV2PatchSchema.shape,
    name: storedNameV1Schema.optional(),
    client_name: storedNameV1Schema.nullable().optional(),
    code_name: storedNameV1Schema.nullable().optional(),
    roster: z.array(rosterMemberSchema).max(200).optional(),
  })
  .superRefine((patch, ctx) => {
    for (const [key, value] of Object.entries(patch))
      if (value === undefined)
        ctx.addIssue({ code: 'custom', path: [key], message: 'undefined is not a stored value' })
    const result = metadataV2Schema.safeParse({
      ...emptyMetadataV2,
      name: 'placeholder',
      client_name: null,
      code_name: null,
      ...patch,
    })
    if (!result.success)
      for (const issue of result.error.issues)
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  })
export const emptyMetadataV2 = {
  assessment_types: [],
  roster: [],
  source_ips: [],
  contacts: [],
  jurisdiction: null,
  data_handling: null,
  legal: null,
  scope: null,
  roe: null,
} as const

/** Deterministic projection default for M2.3 version-1 creation history. */
export function metadataV2FromV1(metadata: Metadata): z.infer<typeof metadataV2Schema> {
  return metadataV2Schema.parse({ ...metadata, ...emptyMetadataV2 })
}

/** Convert a validated sparse creation command into complete version-2 metadata. */
export function completeMetadataV2Input(
  value: unknown,
  operatorId: string,
): z.infer<typeof metadataV2Schema> {
  uuidV7Schema.parse(operatorId)
  const input = metadataV2InputSchema.parse(value)
  return metadataV2Schema.parse({
    ...emptyMetadataV2,
    client_name: null,
    code_name: null,
    ...input,
    roster: mapRoster(input.roster ?? [], operatorId),
  })
}

/** Bind a sparse metadata patch to the core's persisted operator identity. */
export function completeMetadataV2Patch(
  value: unknown,
  operatorId: string,
): z.infer<typeof storedMetadataV2PatchSchema> {
  uuidV7Schema.parse(operatorId)
  const patch = metadataV2PatchSchema.parse(value)
  return storedMetadataV2PatchSchema.parse({
    ...patch,
    ...(patch.roster === undefined ? {} : { roster: mapRoster(patch.roster, operatorId) }),
  })
}
