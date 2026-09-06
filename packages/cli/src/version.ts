import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Build identity for this binary.
 *
 * Reported by `pentrackr --version`. The commit is stamped at package time and
 * is absent in a working-tree build, which is itself useful information: an
 * unstamped binary is not a release artifact.
 */
export interface BuildInfo {
  readonly version: string
  readonly commit: string | null
  readonly node: string
  readonly platform: string
  readonly arch: string
}

function readPackageVersion(): string {
  // dist/version.js -> package root is two levels up.
  const here = dirname(fileURLToPath(import.meta.url))
  const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
    version?: string
  }
  return manifest.version ?? '0.0.0'
}

export function buildInfo(): BuildInfo {
  return {
    version: readPackageVersion(),
    commit: process.env.PENTRACKR_COMMIT ?? null,
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
