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

const copied = new Set()

/**
 * Copies a dependency into the bundle, then its own dependencies.
 *
 * Workspace packages are taken from packages/<name>; everything else is copied
 * out of node_modules with symlinks dereferenced, because pnpm's store is a
 * tree of links that would not survive being archived.
 */
function bundleDependency(name, version, fromDir) {
  if (copied.has(name)) return
  copied.add(name)

  const target = join(stageModules, name)

  if (typeof version === 'string' && version.startsWith('workspace:')) {
    const local = join(root, 'packages', name.replace(/^@pentrackr\//, ''))
    const manifest = readManifest(join(local, 'package.json'))
    mkdirSync(target, { recursive: true })
    cpSync(join(local, 'dist'), join(target, 'dist'), { recursive: true })
    cpSync(join(local, 'package.json'), join(target, 'package.json'))
    for (const [child, range] of Object.entries(manifest.dependencies ?? {})) {
      bundleDependency(child, range, local)
    }
    return
  }

  // pnpm installs a dependency under the package that declares it, so resolve
  // from there first and fall back to the workspace root.
  const candidates = [join(fromDir, 'node_modules', name), join(root, 'node_modules', name)]
  const source = candidates.find((candidate) => existsSync(candidate))
  if (source === undefined) {
    throw new Error(`cannot bundle ${name}: not found in ${candidates.join(' or ')}`)
  }

  // dereference: pnpm's node_modules is a tree of symlinks into a content store,
  // and links do not survive being archived and unpacked elsewhere.
  cpSync(source, target, { recursive: true, dereference: true })
  for (const [child, range] of Object.entries(
    readManifest(join(source, 'package.json')).dependencies ?? {},
  )) {
    bundleDependency(child, range, source)
  }
}

const cliManifest = readManifest(join(root, 'packages/cli/package.json'))
const commit = resolveCommit()

rmSync(outputRoot, { recursive: true, force: true })
mkdirSync(join(stageRoot, 'bin'), { recursive: true })

// Compiled JavaScript. version.js resolves the manifest one level up, so the
// bundle layout must keep lib/ directly beneath the package root.
cpSync(join(root, 'packages/cli/dist'), join(stageRoot, 'lib'), { recursive: true })

for (const [name, range] of Object.entries(cliManifest.dependencies ?? {})) {
  bundleDependency(name, range, join(root, 'packages/cli'))
}

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
  `packaged ${archiveName}\n  commit ${commit ?? 'working tree'}\n  bundled ${[...copied].join(', ') || '(no dependencies)'}\n`,
)
