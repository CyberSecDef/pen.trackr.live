import {
  type CborValue,
  type Envelope,
  encode,
  envelopeSchema,
  parseEnvelope,
} from '@pentrackr/ledger'
import { sequenceSchema, textSchema } from '@pentrackr/project'
import { z } from 'zod'

export type WireValue =
  | null
  | boolean
  | number
  | string
  | ['bytes', string]
  | ['bigint', string]
  | ['array', WireValue[]]
  | ['map', [string, WireValue][]]

const hexSchema = z.string().regex(/^(?:[0-9a-f]{2})*$/)
const integerTextSchema = z
  .string()
  .max(21)
  .regex(/^(?:0|-?[1-9][0-9]*)$/)
  .refine((value) => {
    if (value.length > 21 || !/^(?:0|-?[1-9][0-9]*)$/.test(value)) return false
    const n = BigInt(value)
    return n >= -(2n ** 64n) && n <= 2n ** 64n - 1n
  }, 'integer outside CBOR range')

// Bound traversal before either Zod or the CBOR encoder recurses. Shared values
// are legal; cycles and unsupported object instances are not.
function checkTree(
  value: unknown,
  depth = 0,
  active = new Set<object>(),
  budget = { nodes: 0 },
): void {
  if (depth > 64 || ++budget.nodes > 20_000)
    throw new Error('wire value exceeds depth or node limit')
  if (value === null || typeof value !== 'object') return
  if (value instanceof Uint8Array) return
  if (active.has(value)) throw new Error('cyclic wire value')
  active.add(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) throw new Error('sparse arrays are not supported')
      checkTree(value[i], depth + 1, active, budget)
    }
  } else if (value instanceof Map) {
    for (const [key, item] of value) {
      if (typeof key !== 'string' || !key.isWellFormed())
        throw new Error('map keys must be well-formed strings')
      checkTree(item, depth + 1, active, budget)
    }
  } else {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new Error('unsupported object instance')
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (
        typeof key !== 'string' ||
        !key.isWellFormed() ||
        descriptor === undefined ||
        !descriptor.enumerable ||
        !('value' in descriptor)
      ) {
        throw new Error('map properties must be enumerable string-keyed data')
      }
      checkTree(descriptor.value, depth + 1, active, budget)
    }
  }
  active.delete(value)
}

const recursiveWireSchema: z.ZodType<WireValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
    textSchema,
    z.tuple([z.literal('bytes'), hexSchema]),
    z.tuple([z.literal('bigint'), integerTextSchema]),
    z.tuple([z.literal('array'), z.array(recursiveWireSchema)]),
    z.tuple([
      z.literal('map'),
      z.array(z.tuple([textSchema, recursiveWireSchema])).superRefine((entries, ctx) => {
        const keys = new Set<string>()
        for (const [index, [key]] of entries.entries()) {
          if (keys.has(key))
            ctx.addIssue({ code: 'custom', path: [index, 0], message: 'duplicate map key' })
          keys.add(key)
        }
      }),
    ]),
  ]),
)

export const wireValueSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    try {
      checkTree(value)
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message })
    }
  })
  .pipe(recursiveWireSchema)

function pack(value: CborValue): WireValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    typeof value === 'number'
  )
    return value
  if (typeof value === 'bigint') return ['bigint', String(value)]
  if (value instanceof Uint8Array) return ['bytes', Buffer.from(value).toString('hex')]
  if (Array.isArray(value)) return ['array', value.map(pack)]
  const entries: [string, CborValue][] =
    value instanceof Map ? [...value.entries()] : Object.entries(value)
  // Stable ordering independent of object insertion order. This affects only
  // JSON presentation; the ledger encoder still owns canonical CBOR ordering.
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return ['map', entries.map(([key, item]) => [key, pack(item)])]
}

/** Map/object and Buffer/Uint8Array identity is normalized; CBOR bytes are preserved. */
export function toWireValue(value: CborValue): WireValue {
  checkTree(value)
  encode(value)
  return wireValueSchema.parse(pack(value))
}

function unpack(value: WireValue): CborValue {
  if (!Array.isArray(value)) return value
  const [tag, body] = value
  switch (tag) {
    case 'bytes':
      return Uint8Array.from(Buffer.from(body, 'hex'))
    case 'bigint':
      return BigInt(body)
    case 'array':
      return body.map(unpack)
    case 'map':
      return Object.fromEntries(body.map(([key, item]) => [key, unpack(item)]))
  }
}

export function fromWireValue(value: unknown): CborValue {
  return unpack(wireValueSchema.parse(value))
}

export const wireEnvelopeSchema = envelopeSchema.omit({ payload: true }).extend({
  payload: wireValueSchema.refine(
    (value) => Array.isArray(value) && value[0] === 'map',
    'event payload must be a map',
  ),
})
export const wireEventSchema = z.strictObject({
  wire_version: z.literal(1),
  seq: sequenceSchema.min(1),
  envelope: wireEnvelopeSchema,
})
export type WireEvent = z.infer<typeof wireEventSchema>

export function toWireEvent(seq: number, envelope: Envelope): WireEvent {
  checkTree(envelope)
  const parsed = parseEnvelope(envelope)
  return wireEventSchema.parse({
    wire_version: 1,
    seq,
    envelope: { ...parsed, payload: toWireValue(parsed.payload) },
  })
}

export function fromWireEvent(value: unknown): { seq: number; envelope: Envelope } {
  const wire = wireEventSchema.parse(value)
  return {
    seq: wire.seq,
    envelope: parseEnvelope({ ...wire.envelope, payload: fromWireValue(wire.envelope.payload) }),
  }
}
