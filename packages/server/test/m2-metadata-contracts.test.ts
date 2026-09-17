import { describe, expect, it } from 'vitest'
import {
  createProjectRequestSchema,
  createProjectV2RequestSchema,
  updateProjectV2RequestSchema,
} from '../src/contracts.js'

describe('M2.4 command boundary', () => {
  it('keeps the M2.3 storage command from silently dropping rich metadata', () => {
    const request = { kind: 'lab', metadata: { name: 'Lab', assessment_types: ['wireless'] } }
    expect(createProjectRequestSchema.safeParse(request).success).toBe(false)
    expect(createProjectV2RequestSchema.safeParse(request).success).toBe(true)
  })
  it('preserves sparse patch and explicit clearing semantics', () => {
    expect(updateProjectV2RequestSchema.parse({})).toEqual({})
    expect(updateProjectV2RequestSchema.parse({ scope: null })).toEqual({ scope: null })
    expect(updateProjectV2RequestSchema.safeParse({ scope: undefined }).success).toBe(false)
    expect(updateProjectV2RequestSchema.safeParse({ engagement_id: 'other' }).success).toBe(false)
  })
})
