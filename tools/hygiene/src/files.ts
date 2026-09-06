/**
 * Which files the scanner looks at.
 *
 * A separate module with no side effects, so tests can exercise the predicate
 * without executing anything. It previously lived in `cli.ts`, and importing it
 * from a test ran the entire scan on import — printing a report, walking the
 * repository, and potentially setting `process.exitCode` inside a test worker.
 * A predicate worth testing should not require running a program to reach.
 */

/**
 * Generated files, skipped regardless of extension.
 *
 * A lockfile is a build artifact, not source. For the hygiene scanner there is a
 * second reason: a lockfile records dependency sources, and a git-over-SSH
 * dependency URL embeds an account and a host, which matches the ssh-target rule
 * exactly. None exists today, but the first git dependency anyone adds would
 * produce a false positive, and a check that cries wolf gets switched off.
 */
export const GENERATED_FILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
])

export const SCANNED_EXTENSIONS = /\.(md|ts|tsx|mts|cts|js|mjs|cjs|json|ya?ml|sh|ps1)$/

/** True when a path should be scanned. Matches the basename, not the whole path. */
export function isScannable(file: string): boolean {
  const name = file.split(/[\\/]/).pop() ?? file
  return !GENERATED_FILES.has(name) && SCANNED_EXTENSIONS.test(file)
}
