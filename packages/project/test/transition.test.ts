import { describe, expect, it } from 'vitest'
import { lifecycleSchema } from '../src/lifecycle.js'
import type { TransitionCommand } from '../src/primitives.js'
import {
  allowedTransitions,
  lifecycleExecutionPosture,
  transitionLifecycle,
} from '../src/transition.js'

const commands: TransitionCommand[] = [
  'activate',
  'pause',
  'resume',
  'begin_closing',
  'cancel_closing',
  'close',
  'reopen',
]
const base = (kind: 'engagement' | 'lab') => ({
  kind,
  state: kind === 'lab' ? ('lab' as const) : ('draft' as const),
  resume_state: null,
  closing_origin: null,
})

describe('M2.6 lifecycle policy', () => {
  it.each([
    ['engagement', 'draft', null, null, ['activate', 'pause', 'begin_closing']],
    ['engagement', 'active', null, null, ['activate', 'pause', 'begin_closing']],
    ['engagement', 'paused', 'draft', null, ['pause', 'resume', 'begin_closing']],
    ['engagement', 'paused', 'active', null, ['pause', 'resume', 'begin_closing']],
    ['engagement', 'paused', 'closing', 'draft', ['pause', 'resume', 'begin_closing']],
    ['engagement', 'paused', 'closing', 'active', ['pause', 'resume', 'begin_closing']],
    ['engagement', 'closing', null, 'draft', ['pause', 'begin_closing', 'cancel_closing', 'close']],
    [
      'engagement',
      'closing',
      null,
      'active',
      ['pause', 'begin_closing', 'cancel_closing', 'close'],
    ],
    ['engagement', 'closed', null, null, ['close', 'reopen']],
    ['lab', 'lab', null, null, ['pause', 'begin_closing']],
    ['lab', 'paused', 'lab', null, ['pause', 'resume', 'begin_closing']],
    ['lab', 'paused', 'closing', 'lab', ['pause', 'resume', 'begin_closing']],
    ['lab', 'closing', null, 'lab', ['pause', 'begin_closing', 'cancel_closing', 'close']],
    ['lab', 'closed', null, null, ['close', 'reopen']],
  ] as const)('enumerates %s/%s/%s/%s', (kind, state, resume_state, closing_origin, expected) => {
    const current = lifecycleSchema.parse({ kind, state, resume_state, closing_origin })
    const entries = allowedTransitions(current)
    expect(entries.map((entry) => entry.command)).toEqual(commands)
    expect(entries.filter((entry) => entry.allowed).map((entry) => entry.command)).toEqual(expected)
    for (const entry of entries) {
      if (entry.allowed) {
        expect(entry.reason).toBeNull()
        expect(
          lifecycleSchema.parse(transitionLifecycle(current, entry.command).next),
        ).toBeDefined()
      } else {
        expect(entry.reason).toMatch(/not allowed/)
        expect(() => transitionLifecycle(current, entry.command)).toThrow()
      }
    }
  })

  it('restores the closing origin through paused Draft and paused Closing detours', () => {
    let state = lifecycleSchema.parse(base('engagement'))
    state = transitionLifecycle(state, 'pause').next
    expect(state.resume_state).toBe('draft')
    state = transitionLifecycle(state, 'begin_closing').next
    expect(state.closing_origin).toBe('draft')
    state = transitionLifecycle(state, 'pause').next
    expect(state.resume_state).toBe('closing')
    state = transitionLifecycle(state, 'resume').next
    state = transitionLifecycle(state, 'cancel_closing').next
    expect(state).toEqual(base('engagement'))

    state = transitionLifecycle(state, 'begin_closing').next
    state = transitionLifecycle(state, 'pause').next
    state = transitionLifecycle(state, 'begin_closing').next
    expect(state.closing_origin).toBe('draft')
    expect(transitionLifecycle(state, 'cancel_closing').next).toEqual(base('engagement'))
  })

  it('keeps Lab identity and reopens Closed to Lab or Active', () => {
    for (const kind of ['lab', 'engagement'] as const) {
      let state = lifecycleSchema.parse(base(kind))
      state = transitionLifecycle(state, 'begin_closing').next
      state = transitionLifecycle(state, 'close').next
      expect(state).toEqual({ kind, state: 'closed', resume_state: null, closing_origin: null })
      state = transitionLifecycle(state, 'reopen').next
      expect(state.state).toBe(kind === 'lab' ? 'lab' : 'active')
      expect(state.kind).toBe(kind)
    }
  })

  it('keeps no-op snapshots and reports future execution posture', () => {
    const draft = lifecycleSchema.parse(base('engagement'))
    const active = transitionLifecycle(draft, 'activate').next
    expect(transitionLifecycle(active, 'activate')).toEqual({ next: active, changed: false })
    const paused = transitionLifecycle(active, 'pause').next
    expect(transitionLifecycle(paused, 'pause')).toEqual({ next: paused, changed: false })
    const closing = transitionLifecycle(active, 'begin_closing').next
    expect(transitionLifecycle(closing, 'begin_closing')).toEqual({ next: closing, changed: false })
    const closed = transitionLifecycle(closing, 'close').next
    expect(transitionLifecycle(closed, 'close')).toEqual({ next: closed, changed: false })
    expect(lifecycleExecutionPosture(draft)).toEqual({
      runner: 'available',
      persistence: 'normal',
      destructive: 'normal',
    })
    expect(lifecycleExecutionPosture(paused).runner).toBe('admission_stopped')
    expect(lifecycleExecutionPosture(closing)).toEqual({
      runner: 'available',
      persistence: 'warn',
      destructive: 'warn',
    })
    expect(lifecycleExecutionPosture(closed).runner).toBe('disabled')
  })
})
