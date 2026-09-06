#!/usr/bin/env node
import { run } from './run.js'

/**
 * Suppress the one warning Node emits for `node:sqlite` being experimental
 * (ADR 0013).
 *
 * Filtered by name and message rather than globally: a tool that prints an
 * internal implementation warning on every invocation trains its operator to
 * ignore warnings, which is a bad habit to cultivate in software whose other
 * warnings concern scope violations. Every other warning still surfaces.
 */
process.on('warning', (warning) => {
  const isSqliteExperimental =
    warning.name === 'ExperimentalWarning' && warning.message.includes('SQLite')
  if (!isSqliteExperimental) process.emitWarning(warning)
})

const result = run(process.argv.slice(2))
const stream = result.exitCode === 0 ? process.stdout : process.stderr
stream.write(`${result.stdout}\n`)
process.exitCode = result.exitCode
