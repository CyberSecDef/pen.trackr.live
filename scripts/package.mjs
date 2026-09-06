#!/usr/bin/env node
/**
 * Assembles a per-OS release bundle.
 *
 * D9 (plan.md): choosing TypeScript over Rust cost the single-portable-binary
 * property, so distribution is a per-OS bundle instead. Proving that bundle
 * assembles and runs on all three operating systems from M0 is what keeps
 * packaging from becoming an end-of-project surprise — and it earned that keep
 * at M1, catching a bundle that omitted its workspace dependencies the moment
 * the CLI gained one.
 *
 * A Node single-executable build lands later, once native addons exist and
 * prebuild handling actually has something to carry.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planBundle } from './lib/bundle-plan.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outputRoot = join(root, 'dist-bundle')
const stageRoot = join(outputRoot, 'pentrackr')
const stageModules = join(stageRoot, 'node_modules')

function readManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function resolveCommit() {
  if (process.env.PENTRACKR_COMMIT) return process.env.PENTRACKR_COMMIT
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/**
 * Materializes a bundle plan.
 *
 * What to include is decided by planBundle, which is unit-tested; this only
 * copies. Splitting them means a bundle missing a dependency fails in `check`
 * rather than waiting for `package` to be reachable.
 */
function copyEntry(entry) {
  const target = join(stageModules, entry.name)

  if (entry.kind === 'workspace') {
    mkdirSync(target, { recursive: true })
    cpSync(join(entry.from, 'dist'), join(target, 'dist'), { recursive: true })
    cpSync(join(entry.from, 'package.json'), join(target, 'package.json'))
    return
  }

  // dereference: pnpm's node_modules is a tree of symlinks into a content store,
  // and links do not survive being archived and unpacked elsewhere.
  cpSync(entry.from, target, { recursive: true, dereference: true })
}

const cliManifest = readManifest(join(root, 'packages/cli/package.json'))
const commit = resolveCommit()

rmSync(outputRoot, { recursive: true, force: true })
mkdirSync(join(stageRoot, 'bin'), { recursive: true })

// Compiled JavaScript. version.js resolves the manifest one level up, so the
// bundle layout must keep lib/ directly beneath the package root.
cpSync(join(root, 'packages/cli/dist'), join(stageRoot, 'lib'), { recursive: true })

const plan = planBundle({
  root,
  entryDir: join(root, 'packages/cli'),
  exists: existsSync,
  readManifest,
  join,
})
for (const entry of plan) copyEntry(entry)

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

const archiveName = `pentrackr-${cliManifest.version}-${process.platform}-${process.arch}.tar.gz`

// tar is present on all three GitHub runner images (bsdtar on Windows).
execFileSync('tar', ['-czf', archiveName, 'pentrackr'], { cwd: outputRoot, stdio: 'inherit' })

process.stdout.write(
  `packaged ${archiveName}\n  commit ${commit ?? 'working tree'}\n  bundled ${plan.map((e) => e.name).join(', ') || '(no dependencies)'}\n`,
)
