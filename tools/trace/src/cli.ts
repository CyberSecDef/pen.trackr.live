#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectAnnotations } from './annotations.js'
import { buildReport, formatReport, isFailing } from './report.js'
import { parseSpec } from './spec.js'

function repositoryRoot(): string {
  // Works both from source (tools/trace/src) and from dist (tools/trace/dist).
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

const argv = process.argv.slice(2)
const root = repositoryRoot()
const spec = readFileSync(join(root, 'req_spec.md'), 'utf8')

const report = buildReport(parseSpec(spec), collectAnnotations(root))

if (argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  process.stdout.write(`${formatReport(report)}\n`)
}

if (argv.includes('--check') && isFailing(report)) {
  process.stderr.write('\ntraceability check failed\n')
  process.exitCode = 1
}
