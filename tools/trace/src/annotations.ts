import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Finds `@req <ID>` annotations in source.
 *
 * A requirement is only considered covered when it is annotated in both an
 * implementation and a test, which is what stops an ID being claimed by a
 * comment on an empty function.
 */

export type AnnotationKind = 'impl' | 'test'

export interface Annotation {
  readonly id: string
  readonly file: string
  readonly line: number
  readonly kind: AnnotationKind
}

const ANNOTATION = /@req\s+((?:FR-[A-Z]+|NFR)-\d{3})/g

/**
 * A file containing this marker is skipped entirely.
 *
 * Needed because a file can *discuss* annotations without *making* them — the
 * scanner's own tests contain literal "@req FR-CMD-001" strings as fixtures.
 * Without an opt-out those read as claims, and the gate reports a requirement
 * as tested but unimplemented. Found the first time the gate ran for real.
 *
 * This is the only escape hatch, and it is file-level and explicit on purpose:
 * anything subtler (ignoring annotations inside string literals, say) would be
 * a parser guessing at intent, and a gate that guesses is a gate that can be
 * argued with.
 */
const IGNORE_MARKER = '@req-ignore-file'

const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'corpora',
  '.pnpm-store',
])

// .mts/.cts belong here for the same reason .mjs/.cjs do: an annotation in a
// module-flavoured source file must still count, or a requirement could be
// implemented in a file the gate cannot see.
/**
 * Generated files, skipped regardless of extension.
 *
 * A lockfile is a build artifact, not source, and is not a place anyone would
 * meaningfully write `@req`. Reading it is wasted work — measured at 0.2ms of a
 * 5.4ms run, so the cost is small rather than the "noticeable CI slowdown" the
 * review suggested — but scanning generated output for hand-written markers is
 * wrong in kind, not merely in degree, and a lockfile grows without bound.
 */
const GENERATED_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb'])

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.sh',
  '.ps1',
  '.yml',
  '.yaml',
])

function isTestPath(relativePath: string): boolean {
  const segments = relativePath.split(sep)
  if (segments.includes('test') || segments.includes('tests')) return true
  const file = segments.at(-1) ?? ''
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
}

function hasSourceExtension(file: string): boolean {
  const dot = file.lastIndexOf('.')
  return dot !== -1 && SOURCE_EXTENSIONS.has(file.slice(dot))
}

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry)) continue
      yield* walk(full)
      continue
    }
    if (GENERATED_FILES.has(entry)) continue
    if (hasSourceExtension(entry)) yield full
  }
}

export function collectAnnotations(root: string): Annotation[] {
  const annotations: Annotation[] = []

  for (const file of walk(root)) {
    const relativePath = relative(root, file)
    const contents = readFileSync(file, 'utf8')
    if (contents.includes(IGNORE_MARKER)) continue

    const kind: AnnotationKind = isTestPath(relativePath) ? 'test' : 'impl'
    const lines = contents.split('\n')

    lines.forEach((line, index) => {
      for (const match of line.matchAll(ANNOTATION)) {
        const id = match[1]
        if (id === undefined) continue
        annotations.push({ id, file: relativePath, line: index + 1, kind })
      }
    })
  }

  return annotations
}
