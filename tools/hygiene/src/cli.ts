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

/**
 * Generated files, skipped regardless of extension.
 *
 * Same reasoning as the traceability scanner: a lockfile is a build artifact.
 * Here there is a second reason — a lockfile records dependency sources, and a
 * git-over-SSH dependency URL embeds an account and a host, which matches the
 * ssh-target rule exactly. No such entry exists today, but the first git
 * dependency anyone adds would produce a false positive, and a check that cries
 * wolf gets switched off.
 *
 * Writing that sentence with a literal example URL tripped the rule, which is a
 * fair demonstration that it fires. The example is described rather than
 * written: the allow marker is for content that genuinely must stay, and
 * spending it on an illustration would set a precedent worth avoiding.
 */
const GENERATED_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb'])

function isScannable(file: string): boolean {
  const name = file.split(/[\\/]/).pop() ?? file
  return !GENERATED_FILES.has(name) && SCANNED_EXTENSIONS.test(file)
}

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/**
 * Tracked files plus untracked, non-ignored ones.
 *
 * Tracked-only under-reports in exactly the situation that matters: a new file
 * scans clean before it is committed and fails in CI afterwards. That is how
 * this tool's own first run went.
 */
function workingFiles(): string[] {
  const tracked = git(['ls-files']).split('\n')
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n')
  return [...new Set([...tracked, ...untracked])].filter((f) => f !== '' && isScannable(f))
}

function stagedFiles(): string[] {
  return git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    .split('\n')
    .filter((f) => f !== '' && isScannable(f))
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
const files = staged ? stagedFiles() : workingFiles()

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
