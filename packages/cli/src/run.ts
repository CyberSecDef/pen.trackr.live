import {
  type LedgerStore,
  ProjectionRunner,
  generateSigningKeyPair,
  openLedger as openLedgerDefault,
  timelineProjection,
} from '@pentrackr/ledger'
import { buildInfo, formatVersion } from './version.js'

export const USAGE = `pentrackr — engagement operating system for authorized penetration testing

Usage:
  pentrackr <command> [options]

Commands:
  version                     Print build identity
  verify <ledger> [--public-key <hex>]
                              Verify the hash chain and any checkpoints
  seal <ledger>               Sign a checkpoint of the current length and head
  log <ledger> [--limit <n>] [--type <event-type>]
                              List events from the timeline projection
  keygen                      Generate an Ed25519 signing key pair

Options:
  -h, --help                  Show this help
  -V, --version               Print build identity

Signing keys are read from PENTRACKR_SIGNING_KEY, never from the command line:
an argument would be captured by shell history, visible in ps, and eventually
recorded by this tool's own command ledger.`

export interface RunResult {
  readonly stdout: string
  readonly exitCode: number
}

export interface RunDeps {
  readonly openLedger: (path: string) => LedgerStore
  readonly env: Record<string, string | undefined>
}

const defaults: RunDeps = { openLedger: openLedgerDefault, env: process.env }

const EX_USAGE = 64
const EX_DATAERR = 65

/** Raised for a malformed invocation; converted to EX_USAGE at the boundary. */
class UsageError extends Error {}

/**
 * Reads an option's value.
 *
 * A flag present without a value is an error, never silently absent. The
 * failure that motivated this is specific: `verify ledger.db --public-key`
 * with the argument lost to shell expansion skipped key pinning entirely and
 * reported "checkpoints ok" on a ledger whose checkpoints were signed by
 * someone else's key — then advised passing the flag the operator had just
 * passed. A security tool that answers a question the user did not ask, and
 * says yes, is worse than one that fails.
 */
function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return undefined

  const value = argv[index + 1]
  if (value === undefined) throw new UsageError(`--${name} requires a value`)
  if (value.startsWith('--')) {
    throw new UsageError(`--${name} requires a value, but was followed by ${value}`)
  }
  return value
}

function usageError(message: string): RunResult {
  return { stdout: `pentrackr: ${message}\n\n${USAGE}`, exitCode: EX_USAGE }
}

function withLedger(
  deps: RunDeps,
  path: string | undefined,
  body: (store: LedgerStore) => RunResult,
): RunResult {
  if (path === undefined || path.startsWith('--')) {
    return usageError('a ledger path is required')
  }

  let store: LedgerStore
  try {
    store = deps.openLedger(path)
  } catch (error) {
    return {
      stdout: `pentrackr: cannot open ledger: ${(error as Error).message}`,
      exitCode: EX_DATAERR,
    }
  }

  try {
    return body(store)
  } finally {
    store.close()
  }
}

function verify(deps: RunDeps, argv: readonly string[]): RunResult {
  return withLedger(deps, argv[0], (store) => {
    const lines: string[] = []
    const chain = store.verify()

    if (!chain.ok) {
      lines.push(
        `chain BROKEN at event ${chain.index} (${chain.event_id})`,
        `  ${chain.failure}: ${chain.detail}`,
      )
      return { stdout: lines.join('\n'), exitCode: 1 }
    }

    lines.push(`chain ok: ${chain.length} events, head ${chain.head ?? '(empty)'}`)

    const expectedKey = option(argv, 'public-key')
    const checkpoints = store.verifyCheckpoints(expectedKey)

    if (!checkpoints.ok) {
      lines.push(
        `checkpoints BROKEN at checkpoint ${checkpoints.seq}`,
        `  ${checkpoints.failure}: ${checkpoints.detail}`,
      )
      return { stdout: lines.join('\n'), exitCode: 1 }
    }

    lines.push(`checkpoints ok: ${checkpoints.checkpoints} signed`)
    if (checkpoints.checkpoints === 0) {
      // Saying this plainly matters: a verified chain does not mean nothing is
      // missing from the end. Only a signature can establish that.
      lines.push('  note: with no checkpoints, truncation of the tail is undetectable')
    } else if (expectedKey === undefined) {
      lines.push('  note: pass --public-key to detect checkpoints replaced with another key')
    }

    return { stdout: lines.join('\n'), exitCode: 0 }
  })
}

function seal(deps: RunDeps, argv: readonly string[]): RunResult {
  const key = deps.env.PENTRACKR_SIGNING_KEY
  if (key === undefined || key === '') {
    return {
      stdout:
        'pentrackr: PENTRACKR_SIGNING_KEY is not set.\n' +
        'Signing keys are never taken from the command line: an argument would be\n' +
        'captured by shell history, visible in ps, and recorded by this tool itself.',
      exitCode: EX_USAGE,
    }
  }

  return withLedger(deps, argv[0], (store) => {
    try {
      const checkpoint = store.checkpoint(key)
      return {
        stdout: [
          `sealed checkpoint ${checkpoint.seq}`,
          `  events    ${checkpoint.event_count}`,
          `  head      ${checkpoint.head_hash ?? '(empty)'}`,
          `  publickey ${checkpoint.public_key}`,
          `  signature ${checkpoint.signature}`,
        ].join('\n'),
        exitCode: 0,
      }
    } catch (error) {
      return { stdout: `pentrackr: ${(error as Error).message}`, exitCode: EX_DATAERR }
    }
  })
}

function log(deps: RunDeps, argv: readonly string[]): RunResult {
  return withLedger(deps, argv[0], (store) => {
    new ProjectionRunner(store, [timelineProjection]).catchUp()

    const limit = Number(option(argv, 'limit') ?? '50')
    if (!Number.isInteger(limit) || limit < 1) {
      return usageError('--limit must be a positive integer')
    }

    const type = option(argv, 'type')
    const rows = store
      .projectionDatabase()
      .prepare(
        `SELECT seq, ts_utc, type, event_id FROM timeline
         ${type === undefined ? '' : 'WHERE type = ?'}
         ORDER BY seq DESC LIMIT ?`,
      )
      .all(...(type === undefined ? [limit] : [type, limit])) as Array<{
      seq: number
      ts_utc: string
      type: string
      event_id: string
    }>

    if (rows.length === 0) return { stdout: '(no events)', exitCode: 0 }

    const lines = rows
      .reverse()
      .map(
        (row) =>
          `${String(row.seq).padStart(6)}  ${row.ts_utc}  ${row.type.padEnd(28)}  ${row.event_id}`,
      )
    return { stdout: lines.join('\n'), exitCode: 0 }
  })
}

function keygen(): RunResult {
  const pair = generateSigningKeyPair()
  return {
    stdout: [
      'Ed25519 signing key pair generated.',
      '',
      `public  ${pair.publicKey}`,
      `private ${pair.privateKey}`,
      '',
      'Store the private key in your OS keychain and export it as',
      'PENTRACKR_SIGNING_KEY when sealing. Losing it means no future checkpoint',
      'can be tied to earlier ones; leaking it means checkpoints can be forged.',
    ].join('\n'),
    exitCode: 0,
  }
}

/** Pure argv handler: returns what to print rather than printing. */
export function run(argv: readonly string[], deps: RunDeps = defaults): RunResult {
  try {
    return dispatch(argv, deps)
  } catch (error) {
    if (error instanceof UsageError) return usageError(error.message)
    throw error
  }
}

function dispatch(argv: readonly string[], deps: RunDeps): RunResult {
  const [command, ...rest] = argv

  if (command === undefined || command === '-h' || command === '--help' || command === 'help') {
    return { stdout: USAGE, exitCode: 0 }
  }
  if (command === '-V' || command === '--version' || command === 'version') {
    return { stdout: formatVersion(buildInfo()), exitCode: 0 }
  }
  if (command === 'verify') return verify(deps, rest)
  if (command === 'seal') return seal(deps, rest)
  if (command === 'log') return log(deps, rest)
  if (command === 'keygen') return keygen()

  return usageError(`unknown command '${command}'`)
}
