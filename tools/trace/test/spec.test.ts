import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseSpec } from '../src/spec.js'

// Resolved from this file, not from process.cwd(). Running vitest from a
// subdirectory made the cwd form fail with ENOENT — verified, not assumed.
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const specMarkdown = readFileSync(join(repositoryRoot, 'req_spec.md'), 'utf8')

/**
 * The SRS is frozen (plan.md D14), and until now nothing enforced that. Every
 * coverage percentage this project reports is calibrated against these counts,
 * so an accidental edit to req_spec.md would quietly change what "5 of 216"
 * means. Asserting the exact baseline turns a stated decision into a checked
 * one; changing the spec deliberately now requires changing this line, which is
 * the right amount of friction.
 */
const BASELINE = { total: 216, MVP: 140, V2: 62, V3: 14 } as const

describe('parseSpec', () => {
  it('extracts exactly the frozen baseline of requirements', () => {
    expect(parseSpec(specMarkdown)).toHaveLength(BASELINE.total)
  })

  it.each(['MVP', 'V2', 'V3'] as const)(
    'extracts exactly %s requirements per the baseline',
    (phase) => {
      const count = parseSpec(specMarkdown).filter((r) => r.phase === phase).length
      expect(count).toBe(BASELINE[phase])
    },
  )

  it('accounts for every requirement in a delivery phase', () => {
    expect(BASELINE.MVP + BASELINE.V2 + BASELINE.V3).toBe(BASELINE.total)
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
