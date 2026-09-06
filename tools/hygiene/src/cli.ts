#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { type Finding, formatFindings, scanText } from './scan.js'

/**
 * Refuses internal infrastructure details in a public repository.
 *
 * Runs in CI over tracked files, and from a commit hook over staged changes.
 * One implementation for both, because two would eventually disagree and the
 * one that mattered would be whichever did not run.
 */

const SCANNED_EXTENSIONS = /\.(md|ts|tsx|mts|cts|js|mjs|cjs|json|ya?ml|sh|ps1)$/

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function trackedFiles(): string[] {
  return git(['ls-files'])
    .split('\n')
    .filter((f) => f !== '' && SCANNED_EXTENSIONS.test(f))
}

function stagedFiles(): string[] {
  return git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    .split('\n')
    .filter((f) => f !== '' && SCANNED_EXTENSIONS.test(f))
}

/**
 * Staged mode reads the staged blob, not the working tree.
 *
 * Otherwise a file fixed in the working tree but committed unfixed would pass,
 * which is precisely the case a commit-time check exists to catch.
 */
function stagedContents(file: string): string | null {
  try {
    return git(['show', `:${file}`])
  } catch {
    return null
  }
}

const staged = process.argv.includes('--staged')
const files = staged ? stagedFiles() : trackedFiles()

const findings: Finding[] = []
for (const file of files) {
  const contents = staged ? stagedContents(file) : readFileSync(file, 'utf8')
  if (contents === null) continue
  findings.push(...scanText(file, contents))
}

const report = formatFindings(findings)
if (findings.length === 0) {
  process.stdout.write(`${report} (${files.length} files)\n`)
} else {
  process.stderr.write(`${report}\n`)
  process.exitCode = 1
}
