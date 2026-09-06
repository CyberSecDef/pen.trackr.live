/**
 * Decides what a release bundle must contain.
 *
 * Split out from the copying so it can be tested in `check` rather than only in
 * `package`. That distinction is the point: `package` depends on `check`, so
 * while `check` was red the packaging job was skipped, and a bundle that omitted
 * a newly added workspace dependency stayed invisible for three consecutive
 * runs. Packaging correctness was verifiable only by packaging.
 *
 * The filesystem is injected rather than imported, so the walk can be exercised
 * against a described tree instead of a real one.
 */

/**
 * @typedef {object} BundleEntry
 * @property {string} name           package name
 * @property {'workspace'|'external'} kind
 * @property {string} from           directory the content is taken from
 */

/**
 * @param {object} options
 * @param {string} options.root                      workspace root
 * @param {string} options.entryDir                  directory of the package being bundled
 * @param {(path: string) => boolean} options.exists
 * @param {(path: string) => object} options.readManifest
 * @param {(...parts: string[]) => string} options.join
 * @returns {BundleEntry[]} every dependency the bundle needs, entry package excluded
 */
export function planBundle({ root, entryDir, exists, readManifest, join }) {
  const planned = []
  const seen = new Set()

  const walk = (name, version, fromDir) => {
    if (seen.has(name)) return
    seen.add(name)

    if (typeof version === 'string' && version.startsWith('workspace:')) {
      // Workspace packages live at packages/<basename>, not in node_modules.
      const local = join(root, 'packages', name.replace(/^@[^/]+\//, ''))
      planned.push({ name, kind: 'workspace', from: local })
      const manifest = readManifest(join(local, 'package.json'))
      for (const [child, range] of Object.entries(manifest.dependencies ?? {})) {
        walk(child, range, local)
      }
      return
    }

    // pnpm installs a dependency beside the package that declares it, so resolve
    // from there before falling back to the workspace root.
    const candidates = [join(fromDir, 'node_modules', name), join(root, 'node_modules', name)]
    const source = candidates.find((candidate) => exists(candidate))
    if (source === undefined) {
      throw new Error(`cannot bundle ${name}: not found in ${candidates.join(' or ')}`)
    }

    planned.push({ name, kind: 'external', from: source })
    for (const [child, range] of Object.entries(
      readManifest(join(source, 'package.json')).dependencies ?? {},
    )) {
      walk(child, range, source)
    }
  }

  const entry = readManifest(join(entryDir, 'package.json'))
  for (const [name, range] of Object.entries(entry.dependencies ?? {})) {
    walk(name, range, entryDir)
  }

  return planned
}
