import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Build identity for this binary.
 *
 * Reported by `pentrackr --version`. The commit is stamped into the bundled
 * manifest at package time and is absent in a working-tree build, which is
 * itself useful information: an unstamped binary is not a release artifact.
 */
export interface BuildInfo {
  readonly version: string
  readonly commit: string | null
  readonly node: string
  readonly platform: string
  readonly arch: string
}

interface Manifest {
  readonly version?: string
  /** Written by scripts/package.mjs when assembling a release bundle. */
  readonly pentrackrCommit?: string
}

function readManifest(): Manifest {
  // Compiled output sits one directory below the package manifest, both in the
  // workspace (dist/version.js) and in a release bundle (lib/version.js).
  const here = dirname(fileURLToPath(import.meta.url))
  return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as Manifest
}

export function buildInfo(): BuildInfo {
  const manifest = readManifest()
  return {
    version: manifest.version ?? '0.0.0',
    commit: process.env.PENTRACKR_COMMIT ?? manifest.pentrackrCommit ?? null,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  }
}

export function formatVersion(info: BuildInfo): string {
  const commit = info.commit === null ? 'working tree' : info.commit.slice(0, 12)
  return [
    `pentrackr ${info.version} (${commit})`,
    `node ${info.node} on ${info.platform}/${info.arch}`,
  ].join('\n')
}
