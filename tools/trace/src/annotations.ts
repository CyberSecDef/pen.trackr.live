import { readFileSync, readdirSync, statSync } from 'node:fs'
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

const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'corpora',
  '.pnpm-store',
])

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
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
    if (hasSourceExtension(entry)) yield full
  }
}

export function collectAnnotations(root: string): Annotation[] {
  const annotations: Annotation[] = []

  for (const file of walk(root)) {
    const relativePath = relative(root, file)
    const kind: AnnotationKind = isTestPath(relativePath) ? 'test' : 'impl'
    const lines = readFileSync(file, 'utf8').split('\n')

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
