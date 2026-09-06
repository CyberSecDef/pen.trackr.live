import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSpec } from '../src/spec.js'

const specMarkdown = readFileSync(join(process.cwd(), 'req_spec.md'), 'utf8')

describe('parseSpec', () => {
  it('extracts requirements from the frozen SRS', () => {
    const requirements = parseSpec(specMarkdown)
    expect(requirements.length).toBeGreaterThan(150)
  })

  it('assigns every requirement a known phase', () => {
    for (const requirement of parseSpec(specMarkdown)) {
      expect(['MVP', 'V2', 'V3']).toContain(requirement.phase)
    }
  })

  it('records the section a requirement was found under', () => {
    const requirements = parseSpec(specMarkdown)
    const cmd001 = requirements.find((requirement) => requirement.id === 'FR-CMD-001')
    expect(cmd001?.section).toContain('Command requirements')
  })

  it('ignores wildcard references such as FR-CMD-* in the traceability table', () => {
    const ids = parseSpec(specMarkdown).map((requirement) => requirement.id)
    expect(ids.every((id) => /\d{3}$/.test(id))).toBe(true)
  })

  it('handles escaped pipes inside requirement text', () => {
    const table = [
      '| ID | Requirement | Phase | Source |',
      '|----|----|----|----|',
      '| **FR-TST-001** | Allows a \\| pipe in prose. | MVP | User |',
    ].join('\n')
    const [requirement] = parseSpec(table)
    expect(requirement?.id).toBe('FR-TST-001')
    expect(requirement?.text).toBe('Allows a | pipe in prose.')
  })

  it('does not double-count a repeated id', () => {
    const table = [
      '| **FR-TST-002** | First. | MVP | User |',
      '| **FR-TST-002** | Duplicate. | MVP | User |',
    ].join('\n')
    expect(parseSpec(table)).toHaveLength(1)
  })

  it('skips rows whose phase column is not a delivery phase', () => {
    const table = '| **FR-TST-003** | Not a requirement row. | Someday | User |'
    expect(parseSpec(table)).toHaveLength(0)
  })
})
