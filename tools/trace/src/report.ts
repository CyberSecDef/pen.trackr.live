import type { Annotation } from './annotations.js'
import type { Phase, Requirement } from './spec.js'

export type Coverage = 'complete' | 'partial' | 'none'

export interface RequirementStatus {
  readonly requirement: Requirement
  readonly coverage: Coverage
  readonly implementations: readonly Annotation[]
  readonly tests: readonly Annotation[]
}

export interface Report {
  readonly statuses: readonly RequirementStatus[]
  /** Annotations naming an ID the SRS does not define — almost always a typo. */
  readonly unknownIds: readonly Annotation[]
  readonly totals: {
    readonly requirements: number
    readonly complete: number
    readonly partial: number
    readonly none: number
  }
  readonly byPhase: Readonly<Record<Phase, { total: number; complete: number }>>
}

export function buildReport(
  requirements: readonly Requirement[],
  annotations: readonly Annotation[],
): Report {
  const known = new Set(requirements.map((requirement) => requirement.id))
  const unknownIds = annotations.filter((annotation) => !known.has(annotation.id))

  const statuses = requirements.map((requirement): RequirementStatus => {
    const mine = annotations.filter((annotation) => annotation.id === requirement.id)
    const implementations = mine.filter((annotation) => annotation.kind === 'impl')
    const tests = mine.filter((annotation) => annotation.kind === 'test')

    let coverage: Coverage = 'none'
    if (implementations.length > 0 && tests.length > 0) coverage = 'complete'
    else if (implementations.length > 0 || tests.length > 0) coverage = 'partial'

    return { requirement, coverage, implementations, tests }
  })

  const byPhase = {
    MVP: { total: 0, complete: 0 },
    V2: { total: 0, complete: 0 },
    V3: { total: 0, complete: 0 },
  }
  for (const status of statuses) {
    const bucket = byPhase[status.requirement.phase]
    bucket.total += 1
    if (status.coverage === 'complete') bucket.complete += 1
  }

  const count = (coverage: Coverage): number =>
    statuses.filter((status) => status.coverage === coverage).length

  return {
    statuses,
    unknownIds,
    totals: {
      requirements: statuses.length,
      complete: count('complete'),
      partial: count('partial'),
      none: count('none'),
    },
    byPhase,
  }
}

function percent(part: number, whole: number): string {
  if (whole === 0) return '0.0%'
  return `${((part / whole) * 100).toFixed(1)}%`
}

export function formatReport(report: Report): string {
  const { totals, byPhase } = report
  const lines: string[] = [
    'Pen Trackr — requirement traceability',
    'Baseline: req_spec.md (SRS v0.2, frozen)',
    '',
    `Requirements  ${totals.requirements}`,
    `  complete    ${totals.complete}   (implementation + test annotated)`,
    `  partial     ${totals.partial}   (missing one side)`,
    `  unclaimed   ${totals.none}`,
    '',
  ]

  for (const phase of ['MVP', 'V2', 'V3'] as const) {
    const bucket = byPhase[phase]
    const bar = percent(bucket.complete, bucket.total)
    lines.push(
      `  ${phase.padEnd(4)} ${String(bucket.complete).padStart(3)}/${String(bucket.total).padEnd(3)}  ${bar}`,
    )
  }

  if (report.unknownIds.length > 0) {
    lines.push('', 'Unknown requirement IDs (not defined in the SRS):')
    for (const annotation of report.unknownIds) {
      lines.push(`  ${annotation.id}  ${annotation.file}:${annotation.line}`)
    }
  }

  const partial = report.statuses.filter((status) => status.coverage === 'partial')
  if (partial.length > 0) {
    lines.push('', 'Partially claimed (an ID is claimed but not both implemented and tested):')
    for (const status of partial) {
      const missing = status.tests.length === 0 ? 'no test' : 'no implementation'
      lines.push(`  ${status.requirement.id}  ${missing}`)
    }
  }

  return lines.join('\n')
}

/** A claim that cannot be substantiated fails CI. Unclaimed requirements do not. */
export function isFailing(report: Report): boolean {
  return report.unknownIds.length > 0 || report.totals.partial > 0
}
