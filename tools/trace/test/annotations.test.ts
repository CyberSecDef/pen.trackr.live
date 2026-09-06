import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectAnnotations } from '../src/annotations.js'

/**
 * The scanner decides whether a requirement counts as claimed, so it gates every
 * future milestone's definition of done. It shipped in M0 without direct tests;
 * this suite closes that gap.
 *
 * This file is marked @req-ignore-file because its fixtures contain literal
 * annotation strings. Without the marker they read as real claims and the gate
 * reports several requirements as tested but unimplemented — which is exactly
 * how the need for the marker was discovered.
 */
describe('collectAnnotations', () => {
  let root: string

  const write = (relativePath: string, contents: string): void => {
    const full = join(root, relativePath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents)
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pentrackr-trace-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  it('finds an annotation and records its file and line', () => {
    write('src/a.ts', ['// header', '/** @req FR-CMD-001 */', 'export const a = 1'].join('\n'))
    const [annotation] = collectAnnotations(root)
    expect(annotation).toMatchObject({ id: 'FR-CMD-001', line: 2, kind: 'impl' })
    expect(annotation?.file).toBe(join('src', 'a.ts'))
  })

  it('classifies a file under test/ as a test annotation', () => {
    write('test/a.test.ts', '// @req FR-CMD-001')
    expect(collectAnnotations(root)[0]?.kind).toBe('test')
  })

  it('classifies a file under tests/ as a test annotation', () => {
    write('tests/thing.ts', '// @req FR-CMD-001')
    expect(collectAnnotations(root)[0]?.kind).toBe('test')
  })

  it.each(['a.test.ts', 'a.spec.ts', 'a.test.mts', 'a.spec.tsx'])(
    'classifies %s as a test by filename',
    (name) => {
      write(`src/${name}`, '// @req FR-CMD-001')
      expect(collectAnnotations(root)[0]?.kind).toBe('test')
    },
  )

  it('treats ordinary source as an implementation annotation', () => {
    write('src/latest.ts', '// @req FR-CMD-001')
    expect(collectAnnotations(root)[0]?.kind).toBe('impl')
  })

  it('finds several annotations on one line', () => {
    write('src/a.ts', '// @req FR-CMD-001 and @req NFR-003')
    expect(collectAnnotations(root).map((a) => a.id)).toEqual(['FR-CMD-001', 'NFR-003'])
  })

  it('scans nested directories', () => {
    write('packages/deep/src/inner/a.ts', '// @req FR-SCP-001')
    expect(collectAnnotations(root)).toHaveLength(1)
  })

  it.each(['node_modules', 'dist', 'build', 'coverage', 'corpora', '.git'])(
    'skips the %s directory',
    (directory) => {
      write(`${directory}/a.ts`, '// @req FR-CMD-001')
      expect(collectAnnotations(root)).toHaveLength(0)
    },
  )

  it('does not scan the corpus directory, which holds real lab credentials', () => {
    write('tests/corpora/case/notes.ts', '// @req FR-CMD-001')
    expect(collectAnnotations(root)).toHaveLength(0)
  })

  it.each([
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
  ])('scans %s files', (extension) => {
    write(`src/a${extension}`, '# @req FR-CMD-001')
    expect(collectAnnotations(root)).toHaveLength(1)
  })

  it.each(['.md', '.json', '.txt', '.png'])('ignores %s files', (extension) => {
    write(`src/a${extension}`, '@req FR-CMD-001')
    expect(collectAnnotations(root)).toHaveLength(0)
  })

  it('ignores a file with no extension', () => {
    write('src/Makefile', '# @req FR-CMD-001')
    expect(collectAnnotations(root)).toHaveLength(0)
  })

  it('accepts every requirement id shape the SRS uses', () => {
    write('src/a.ts', ['// @req FR-MANIFEST-001', '// @req FR-X-007', '// @req NFR-014'].join('\n'))
    expect(collectAnnotations(root).map((a) => a.id)).toEqual([
      'FR-MANIFEST-001',
      'FR-X-007',
      'NFR-014',
    ])
  })

  it('ignores a wildcard reference such as the ones in the traceability table', () => {
    write('src/a.ts', '// see @req FR-CMD-* for the family')
    expect(collectAnnotations(root)).toHaveLength(0)
  })

  it('ignores a malformed id with too few digits', () => {
    write('src/a.ts', '// @req FR-CMD-01')
    expect(collectAnnotations(root)).toHaveLength(0)
  })

  it('tolerates extra whitespace after the marker', () => {
    write('src/a.ts', '// @req    FR-CMD-001')
    expect(collectAnnotations(root)).toHaveLength(1)
  })

  it('returns nothing for an empty tree', () => {
    expect(collectAnnotations(root)).toEqual([])
  })

  it('skips a file marked with the ignore marker', () => {
    write('src/fixtures.ts', ['// @req-ignore-file', '// @req FR-CMD-001'].join('\n'))
    expect(collectAnnotations(root)).toEqual([])
  })

  it('skips the marked file but still scans its neighbours', () => {
    write('src/fixtures.ts', ['// @req-ignore-file', '// @req FR-CMD-001'].join('\n'))
    write('src/real.ts', '// @req NFR-003')
    expect(collectAnnotations(root).map((a) => a.id)).toEqual(['NFR-003'])
  })
})
