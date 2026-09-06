#!/usr/bin/env node
/**
 * Assembles a per-OS release bundle.
 *
 * D9 (plan.md): choosing TypeScript over Rust cost us the single-portable-binary
 * property, so distribution is a per-OS bundle instead. Proving that bundle
 * assembles and runs on all three operating systems from M0 is what keeps
 * packaging from becoming an end-of-project surprise.
 *
 * A Node single-executable build lands later, once native addons (node-pty,
 * better-sqlite3) exist and prebuild handling actually has something to carry.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outputRoot = join(root, 'dist-bundle')
const stageRoot = join(outputRoot, 'pentrackr')

function resolveCommit() {
  if (process.env.PENTRACKR_COMMIT) return process.env.PENTRACKR_COMMIT
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

const cliManifest = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'))
const commit = resolveCommit()

rmSync(outputRoot, { recursive: true, force: true })
mkdirSync(join(stageRoot, 'bin'), { recursive: true })

// Compiled JavaScript. version.js resolves the manifest one level up, so the
// bundle layout must keep lib/ directly beneath the package root.
cpSync(join(root, 'packages/cli/dist'), join(stageRoot, 'lib'), { recursive: true })

for (const file of ['LICENSE', 'NOTICE', 'README.md']) {
  cpSync(join(root, file), join(stageRoot, file))
}

writeFileSync(
  join(stageRoot, 'package.json'),
  `${JSON.stringify(
    {
      name: cliManifest.name,
      version: cliManifest.version,
      description: cliManifest.description,
      license: cliManifest.license,
      type: 'module',
      bin: { pentrackr: './bin/pentrackr.js' },
      engines: cliManifest.engines,
      ...(commit === null ? {} : { pentrackrCommit: commit }),
    },
    null,
    2,
  )}\n`,
)

writeFileSync(
  join(stageRoot, 'bin/pentrackr.js'),
  ['#!/usr/bin/env node', "import '../lib/cli.js'", ''].join('\n'),
)

const version = cliManifest.version
const archiveName = `pentrackr-${version}-${process.platform}-${process.arch}.tar.gz`

// tar is present on all three GitHub runner images (bsdtar on Windows).
execFileSync('tar', ['-czf', archiveName, 'pentrackr'], { cwd: outputRoot, stdio: 'inherit' })

process.stdout.write(
  `packaged ${archiveName}\n  commit ${commit ?? 'working tree'}\n  platform ${process.platform}/${process.arch}\n`,
)
