import { describe, expect, it } from 'vitest'
import { USAGE, run } from '../src/run.js'
import { buildInfo, formatVersion } from '../src/version.js'

describe('run', () => {
  it('prints usage with no arguments', () => {
    expect(run([])).toEqual({ stdout: USAGE, exitCode: 0 })
  })

  it.each(['-h', '--help', 'help'])('prints usage for %s', (flag) => {
    expect(run([flag]).exitCode).toBe(0)
  })

  it.each(['-V', '--version', 'version'])('prints version for %s', (flag) => {
    const result = run([flag])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/^pentrackr \d+\.\d+\.\d+ /)
  })

  it('exits EX_USAGE on an unknown command', () => {
    const result = run(['nope'])
    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain("unknown command 'nope'")
  })
})

describe('formatVersion', () => {
  it('reports a working-tree build when no commit is stamped', () => {
    const text = formatVersion({ ...buildInfo(), commit: null })
    expect(text).toContain('(working tree)')
  })

  it('truncates a stamped commit to 12 characters', () => {
    const text = formatVersion({ ...buildInfo(), commit: 'a'.repeat(40) })
    expect(text).toContain(`(${'a'.repeat(12)})`)
  })

  it('reports the running node version and platform', () => {
    const text = formatVersion(buildInfo())
    expect(text).toContain(`node ${process.versions.node}`)
    expect(text).toContain(`${process.platform}/${process.arch}`)
  })
})
