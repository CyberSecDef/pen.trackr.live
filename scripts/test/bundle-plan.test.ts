import { existsSync, readFileSync } from 'node:fs'
import { join as nodeJoin } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM script, deliberately unbuilt so packaging needs no build of itself
import { planBundle } from '../lib/bundle-plan.mjs'

/**
 * The packaging script was the only executable code in this repository with no
 * tests, and it is what broke: the bundle omitted a workspace dependency the
 * moment the CLI gained one, and shipped ERR_MODULE_NOT_FOUND on all three
 * operating systems.
 *
 * It stayed invisible for three consecutive runs because `package` depends on
 * `check`, so while `check` was red the packaging job was skipped entirely.
 * Packaging correctness was verifiable only by packaging. These tests move that
 * verification into `check`, where it costs milliseconds and runs unconditionally.
 */

const join = (...parts: string[]) => parts.join('/')

/** Describes a filesystem as a map of path to manifest. */
function tree(manifests: Record<string, unknown>) {
  return {
    root: '/w',
    exists: (path: string) => Object.hasOwn(manifests, `${path}/package.json`),
    readManifest: (path: string) => {
      const found = manifests[path]
      if (found === undefined) throw new Error(`no manifest at ${path}`)
      return found
    },
    join,
  }
}

describe('planBundle', () => {
  it('plans nothing for a package with no dependencies', () => {
    const fs = tree({ '/w/packages/cli/package.json': {} })
    expect(planBundle({ ...fs, entryDir: '/w/packages/cli' })).toEqual([])
  })

  it('includes a workspace dependency — the case that shipped broken', () => {
    // The regression: the CLI gained @pentrackr/ledger and the bundle omitted it.
    const fs = tree({
      '/w/packages/cli/package.json': { dependencies: { '@pentrackr/ledger': 'workspace:*' } },
      '/w/packages/ledger/package.json': {},
    })
    expect(planBundle({ ...fs, entryDir: '/w/packages/cli' })).toEqual([
      { name: '@pentrackr/ledger', kind: 'workspace', from: '/w/packages/ledger' },
    ])
  })

  it('follows a workspace dependency into its own external dependencies', () => {
    // The second defect in the same incident: @pentrackr/ledger needs zod.
    const fs = tree({
      '/w/packages/cli/package.json': { dependencies: { '@pentrackr/ledger': 'workspace:*' } },
      '/w/packages/ledger/package.json': { dependencies: { zod: '^4.0.0' } },
      '/w/packages/ledger/node_modules/zod/package.json': {},
    })
    expect(planBundle({ ...fs, entryDir: '/w/packages/cli' }).map((e) => e.name)).toEqual([
      '@pentrackr/ledger',
      'zod',
    ])
  })

  it('resolves an external dependency beside the package that declares it', () => {
    // pnpm installs beside the declarer, not at the root.
    const fs = tree({
      '/w/packages/cli/package.json': { dependencies: { left: '^1.0.0' } },
      '/w/packages/cli/node_modules/left/package.json': {},
    })
    expect(planBundle({ ...fs, entryDir: '/w/packages/cli' })[0]?.from).toBe(
      '/w/packages/cli/node_modules/left',
    )
  })

  it('falls back to the workspace root when not installed beside the declarer', () => {
    const fs = tree({
      '/w/packages/cli/package.json': { dependencies: { hoisted: '^1.0.0' } },
      '/w/node_modules/hoisted/package.json': {},
    })
    expect(planBundle({ ...fs, entryDir: '/w/packages/cli' })[0]?.from).toBe(
      '/w/node_modules/hoisted',
    )
  })

  it('prefers the local copy over the root when both exist', () => {
    const fs = tree({
      '/w/packages/cli/package.json': { dependencies: { both: '^1.0.0' } },
      '/w/packages/cli/node_modules/both/package.json': {},
      '/w/node_modules/both/package.json': {},
    })
    expect(planBundle({ ...fs, entryDir: '/w/packages/cli' })[0]?.from).toBe(
      '/w/packages/cli/node_modules/both',
    )
  })

  it('walks transitive external dependencies', () => {
    const fs = tree({
      '/w/packages/cli/package.json': { dependencies: { a: '^1' } },
      '/w/packages/cli/node_modules/a/package.json': { dependencies: { b: '^1' } },
      '/w/packages/cli/node_modules/a/node_modules/b/package.json': { dependencies: { c: '^1' } },
      '/w/node_modules/c/package.json': {},
    })
    expect(planBundle({ ...fs, entryDir: '/w/packages/cli' }).map((e) => e.name)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('visits a shared dependency once', () => {
    const fs = tree({
      '/w/packages/cli/package.json': { dependencies: { a: '^1', b: '^1' } },
      '/w/node_modules/a/package.json': { dependencies: { shared: '^1' } },
      '/w/node_modules/b/package.json': { dependencies: { shared: '^1' } },
      '/w/node_modules/shared/package.json': {},
    })
    const names = planBundle({ ...fs, entryDir: '/w/packages/cli' }).map((e) => e.name)
    expect(names.filter((n) => n === 'shared')).toHaveLength(1)
  })

  it('terminates on a dependency cycle', () => {
    const fs = tree({
      '/w/packages/cli/package.json': { dependencies: { a: '^1' } },
      '/w/node_modules/a/package.json': { dependencies: { b: '^1' } },
      '/w/node_modules/b/package.json': { dependencies: { a: '^1' } },
    })
    expect(planBundle({ ...fs, entryDir: '/w/packages/cli' }).map((e) => e.name)).toEqual([
      'a',
      'b',
    ])
  })

  it('fails loudly when a dependency cannot be found', () => {
    // Silence here is what shipped a broken bundle; an error is the point.
    const fs = tree({ '/w/packages/cli/package.json': { dependencies: { missing: '^1' } } })
    expect(() => planBundle({ ...fs, entryDir: '/w/packages/cli' })).toThrow(
      /cannot bundle missing/,
    )
  })

  it('names both locations it searched when it fails', () => {
    const fs = tree({ '/w/packages/cli/package.json': { dependencies: { missing: '^1' } } })
    expect(() => planBundle({ ...fs, entryDir: '/w/packages/cli' })).toThrow(
      /packages\/cli\/node_modules\/missing or \/w\/node_modules\/missing/,
    )
  })

  it('strips any scope when mapping a workspace name to its directory', () => {
    const fs = tree({
      '/w/packages/cli/package.json': { dependencies: { '@other/thing': 'workspace:*' } },
      '/w/packages/thing/package.json': {},
    })
    expect(planBundle({ ...fs, entryDir: '/w/packages/cli' })[0]?.from).toBe('/w/packages/thing')
  })

  it('ignores devDependencies, which a runtime bundle must not carry', () => {
    const fs = tree({
      '/w/packages/cli/package.json': {
        dependencies: { runtime: '^1' },
        devDependencies: { vitest: '^5' },
      },
      '/w/node_modules/runtime/package.json': {},
    })
    expect(planBundle({ ...fs, entryDir: '/w/packages/cli' }).map((e) => e.name)).toEqual([
      'runtime',
    ])
  })
})

describe('the real workspace', () => {
  it('plans exactly the dependencies the shipped bundle contains', () => {
    // Guards the actual repository, not a described one: if the CLI gains a
    // dependency and packaging is not updated, this fails in check.
    const fs = {
      root: process.cwd(),
      exists: (path: string) => existsSync(path),
      readManifest: (path: string) => JSON.parse(readFileSync(path, 'utf8')),
      join: nodeJoin,
    }
    const names = planBundle({ ...fs, entryDir: nodeJoin(process.cwd(), 'packages/cli') }).map(
      (e: { name: string }) => e.name,
    )
    expect(names).toContain('@pentrackr/ledger')
    expect(names).toContain('zod')
  })
})
