import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { installWarningFilter, isSqliteExperimentalWarning } from '../src/warnings.js'

const warning = (name: string, message: string): Error =>
  Object.assign(new Error(message), { name })

describe('isSqliteExperimentalWarning', () => {
  it('matches the node:sqlite experimental warning', () => {
    expect(
      isSqliteExperimentalWarning(
        warning(
          'ExperimentalWarning',
          'SQLite is an experimental feature and might change at any time',
        ),
      ),
    ).toBe(true)
  })

  it('does not match other experimental warnings', () => {
    expect(
      isSqliteExperimentalWarning(warning('ExperimentalWarning', 'Type stripping is experimental')),
    ).toBe(false)
  })

  it('does not match a deprecation that mentions SQLite', () => {
    expect(
      isSqliteExperimentalWarning(warning('DeprecationWarning', 'SQLite thing is deprecated')),
    ).toBe(false)
  })
})

describe('installWarningFilter', () => {
  function fakeProcess() {
    const emitter = new EventEmitter() as unknown as NodeJS.Process
    return emitter
  }

  it('drops the sqlite warning', () => {
    const target = fakeProcess()
    const seen: Error[] = []
    target.on('warning', (w: Error) => seen.push(w))
    installWarningFilter(target)

    target.emit('warning', warning('ExperimentalWarning', 'SQLite is an experimental feature'))
    expect(seen).toEqual([])
  })

  it('passes every other warning through to the original handlers', () => {
    const target = fakeProcess()
    const seen: Error[] = []
    target.on('warning', (w: Error) => seen.push(w))
    installWarningFilter(target)

    const other = warning('DeprecationWarning', 'something else')
    target.emit('warning', other)
    expect(seen).toEqual([other])
  })

  it('removes the original listener rather than adding alongside it', () => {
    // The bug the first version had: adding a listener leaves Node's default
    // printer in place, so the warning is still printed.
    const target = fakeProcess()
    target.on('warning', () => undefined)
    expect(target.listenerCount('warning')).toBe(1)
    installWarningFilter(target)
    expect(target.listenerCount('warning')).toBe(1)
  })
})
