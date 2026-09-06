import { buildInfo, formatVersion } from './version.js'

export const USAGE = `pentrackr — engagement operating system for authorized penetration testing

Usage:
  pentrackr <command> [options]

Commands:
  version            Print build identity

Options:
  -h, --help         Show this help
  -V, --version      Print build identity

No engagement commands exist yet. See plan.md for the milestone sequence.`

export interface RunResult {
  readonly stdout: string
  readonly exitCode: number
}

/**
 * Pure argv handler. Returns what to print rather than printing, so the CLI is
 * testable without capturing process streams.
 */
export function run(argv: readonly string[]): RunResult {
  const [first] = argv

  if (first === undefined || first === '-h' || first === '--help' || first === 'help') {
    return { stdout: USAGE, exitCode: 0 }
  }

  if (first === '-V' || first === '--version' || first === 'version') {
    return { stdout: formatVersion(buildInfo()), exitCode: 0 }
  }

  return {
    stdout: `pentrackr: unknown command '${first}'\n\n${USAGE}`,
    exitCode: 64, // EX_USAGE
  }
}
