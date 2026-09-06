import { describe, expect, it } from 'vitest'
import type { Annotation } from '../src/annotations.js'
import { buildReport, formatReport, isFailing } from '../src/report.js'
import type { Requirement } from '../src/spec.js'

const requirement = (id: string, phase: Requirement['phase'] = 'MVP'): Requirement => ({
  id,
  text: 'text',
  phase,
  source: 'User',
  section: 'section',
})

const annotation = (id: string, kind: Annotation['kind']): Annotation => ({
  id,
  kind,
  file: kind === 'test' ? 'test/a.test.ts' : 'src/a.ts',
  line: 1,
})

describe('buildReport', () => {
  it('marks a requirement complete only with both an implementation and a test', () => {
    const report = buildReport(
      [requirement('FR-CMD-001')],
      [annotation('FR-CMD-001', 'impl'), annotation('FR-CMD-001', 'test')],
    )
    expect(report.totals.complete).toBe(1)
    expect(isFailing(report)).toBe(false)
  })

  it('marks an implementation without a test as partial, and fails the check', () => {
    const report = buildReport([requirement('FR-CMD-001')], [annotation('FR-CMD-001', 'impl')])
    expect(report.totals.partial).toBe(1)
    expect(isFailing(report)).toBe(true)
  })

  it('marks a test without an implementation as partial', () => {
    const report = buildReport([requirement('FR-CMD-001')], [annotation('FR-CMD-001', 'test')])
    expect(report.totals.partial).toBe(1)
  })

  it('flags annotations naming an id the SRS does not define', () => {
    const report = buildReport([requirement('FR-CMD-001')], [annotation('FR-CMD-999', 'impl')])
    expect(report.unknownIds).toHaveLength(1)
    expect(isFailing(report)).toBe(true)
  })

  it('does not fail merely because requirements are unclaimed', () => {
    const report = buildReport([requirement('FR-CMD-001')], [])
    expect(report.totals.none).toBe(1)
    expect(isFailing(report)).toBe(false)
  })

  it('counts completion per delivery phase', () => {
    const report = buildReport(
      [requirement('FR-CMD-001', 'MVP'), requirement('FR-NET-001', 'V2')],
      [annotation('FR-CMD-001', 'impl'), annotation('FR-CMD-001', 'test')],
    )
    expect(report.byPhase.MVP).toEqual({ total: 1, complete: 1 })
    expect(report.byPhase.V2).toEqual({ total: 1, complete: 0 })
  })
})

describe('formatReport', () => {
  const req = (id: string, phase: Requirement['phase'] = 'MVP'): Requirement => ({
    id,
    text: 'text',
    phase,
    source: 'User',
    section: 'section',
  })

  it('reports totals and the frozen baseline', () => {
    const text = formatReport(buildReport([req('FR-CMD-001')], []))
    expect(text).toContain('Requirements  1')
    expect(text).toContain('SRS v0.2, frozen')
    expect(text).toContain('unclaimed   1')
  })

  it('shows per-phase completion percentages', () => {
    const report = buildReport(
      [req('FR-CMD-001'), req('FR-CMD-002'), req('FR-NET-001', 'V2')],
      [annotation('FR-CMD-001', 'impl'), annotation('FR-CMD-001', 'test')],
    )
    const text = formatReport(report)
    expect(text).toMatch(/MVP\s+1\/2\s+50\.0%/)
    expect(text).toMatch(/V2\s+0\/1\s+0\.0%/)
  })

  it('reports 0.0% rather than dividing by zero for an empty phase', () => {
    expect(formatReport(buildReport([], []))).toMatch(/MVP\s+0\/0\s+0\.0%/)
  })

  it('names unknown requirement ids with their location', () => {
    const text = formatReport(buildReport([req('FR-CMD-001')], [annotation('FR-CMD-999', 'impl')]))
    expect(text).toContain('Unknown requirement IDs')
    expect(text).toContain('FR-CMD-999  src/a.ts:1')
  })

  it('says which side of a partial claim is missing', () => {
    const noTest = formatReport(
      buildReport([req('FR-CMD-001')], [annotation('FR-CMD-001', 'impl')]),
    )
    expect(noTest).toContain('FR-CMD-001  no test')

    const noImpl = formatReport(
      buildReport([req('FR-CMD-001')], [annotation('FR-CMD-001', 'test')]),
    )
    expect(noImpl).toContain('FR-CMD-001  no implementation')
  })

  it('omits the problem sections entirely when there is nothing to report', () => {
    const text = formatReport(
      buildReport(
        [req('FR-CMD-001')],
        [annotation('FR-CMD-001', 'impl'), annotation('FR-CMD-001', 'test')],
      ),
    )
    expect(text).not.toContain('Unknown requirement IDs')
    expect(text).not.toContain('Partially claimed')
  })
})
