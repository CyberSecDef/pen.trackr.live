/**
 * Warning filtering for the CLI entry point.
 *
 * Node emits an ExperimentalWarning the first time `node:sqlite` is used (ADR
 * 0013). A tool that prints an internal implementation warning on every
 * invocation trains its operator to ignore warnings, which is a bad habit to
 * cultivate in software whose other warnings concern scope violations.
 *
 * Only that one warning is dropped, matched by name and message. Everything
 * else reaches Node's original handlers untouched.
 */

export function isSqliteExperimentalWarning(warning: Error): boolean {
  return warning.name === 'ExperimentalWarning' && warning.message.includes('SQLite')
}

/**
 * Installs the filter.
 *
 * Node prints warnings from its own listener, so filtering means taking that
 * listener off and re-dispatching everything we do not drop. Merely adding a
 * listener leaves the default printer in place — which is exactly the mistake
 * the first version of this made.
 */
export function installWarningFilter(target: NodeJS.Process = process): void {
  const original = target.listeners('warning') as Array<(warning: Error) => void>
  target.removeAllListeners('warning')
  target.on('warning', (warning: Error) => {
    if (isSqliteExperimentalWarning(warning)) return
    for (const listener of original) listener(warning)
  })
}
