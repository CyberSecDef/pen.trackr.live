import { describe, expect, it } from 'vitest'
import type { Annotation } from '../src/annotations.js'
import { buildReport, isFailing } from '../src/report.js'
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
