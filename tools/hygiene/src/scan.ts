import { ALLOW_MARKER, RULES } from './rules.js'

export interface Finding {
  readonly file: string
  readonly line: number
  readonly rule: string
  readonly why: string
  readonly excerpt: string
}

/** Scans one file's contents. Pure, so the rules can be tested without a repository. */
export function scanText(file: string, contents: string): Finding[] {
  const findings: Finding[] = []

  contents.split('\n').forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) return

    for (const rule of RULES) {
      const match = rule.pattern.exec(line)
      if (match === null) continue
      findings.push({
        file,
        line: index + 1,
        rule: rule.name,
        why: rule.why,
        excerpt: match[0].slice(0, 80),
      })
    }
  })

  return findings
}

export function formatFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) return 'repository hygiene: clean'

  const lines = [
    `repository hygiene: ${findings.length} finding(s)`,
    '',
    'This repository is public. Infrastructure details belong out-of-band.',
    '',
  ]

  for (const finding of findings) {
    lines.push(`  ${finding.file}:${finding.line}  [${finding.rule}]`)
    lines.push(`    ${finding.excerpt}`)
    lines.push(`    ${finding.why}`)
    lines.push('')
  }

  lines.push(
    `If a line genuinely needs to stay, append ${ALLOW_MARKER} to it so the`,
    'exception is visible in the diff rather than hidden in a config file.',
  )

  return lines.join('\n')
}
