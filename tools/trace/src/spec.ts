/**
 * Parses the requirements baseline out of the SRS.
 *
 * Requirements live in markdown tables shaped:
 *   | **FR-CMD-001** | Integrated multi-tab PTY terminals. | MVP | User |
 *
 * The SRS is frozen (plan.md section 2), so this parser targets that exact
 * shape rather than trying to be a general markdown table reader.
 */

export type Phase = 'MVP' | 'V2' | 'V3'

export interface Requirement {
  readonly id: string
  readonly text: string
  readonly phase: Phase
  readonly source: string
  readonly section: string
}

/** Matches FR-CMD-001, FR-MANIFEST-002, NFR-014. Rejects wildcards like FR-CMD-*. */
const REQUIREMENT_ID = /^(?:FR-[A-Z]+|NFR)-\d{3}$/

const PHASES = new Set<string>(['MVP', 'V2', 'V3'])

/** Splits a markdown table row on unescaped pipes. */
function splitRow(line: string): string[] {
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '\\' && line[i + 1] === '|') {
      current += '|'
      i += 1
      continue
    }
    if (char === '|') {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  // A well-formed row starts and ends with a pipe, producing empty edge cells.
  return cells.slice(1, -1).map((cell) => cell.trim())
}

function stripBold(cell: string): string {
  const match = /^\*\*(.+)\*\*$/.exec(cell)
  return match?.[1]?.trim() ?? cell
}

export function parseSpec(markdown: string): Requirement[] {
  const requirements: Requirement[] = []
  const seen = new Set<string>()
  let section = '(preamble)'

  for (const line of markdown.split('\n')) {
    const heading = /^#{2,4}\s+(.*)$/.exec(line)
    if (heading?.[1] !== undefined) {
      section = heading[1].trim()
      continue
    }

    if (!line.startsWith('|')) continue

    const cells = splitRow(line)
    if (cells.length !== 4) continue

    const id = stripBold(cells[0] ?? '')
    if (!REQUIREMENT_ID.test(id)) continue

    const phase = stripBold(cells[2] ?? '')
    if (!PHASES.has(phase)) continue

    // The SRS repeats no IDs, but a duplicate would silently inflate coverage.
    if (seen.has(id)) continue
    seen.add(id)

    requirements.push({
      id,
      text: stripBold(cells[1] ?? ''),
      phase: phase as Phase,
      source: stripBold(cells[3] ?? ''),
      section,
    })
  }

  return requirements
}
