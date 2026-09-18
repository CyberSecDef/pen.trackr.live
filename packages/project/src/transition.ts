import { type Lifecycle, lifecycleSchema } from './lifecycle.js'
import { type TransitionCommand, transitionCommandSchema } from './primitives.js'

export class TransitionPolicyError extends Error {
  readonly code = 'invalid_transition'
  constructor(message: string) {
    super(message)
    this.name = 'TransitionPolicyError'
  }
}

export interface TransitionDecision {
  next: Lifecycle
  changed: boolean
}

const commands = transitionCommandSchema.options

/** Deterministic persisted-state policy; clock, RoE and runner state are separate. */
export function transitionLifecycle(
  current: Lifecycle,
  command: TransitionCommand,
): TransitionDecision {
  const state = lifecycleSchema.parse(current)
  const next = (value: Lifecycle): TransitionDecision => ({
    next: lifecycleSchema.parse(value),
    changed: true,
  })
  const noop = (): TransitionDecision => ({ next: state, changed: false })
  if (command === 'activate') {
    if (state.kind === 'engagement' && state.state === 'draft')
      return next({ ...state, state: 'active' })
    if (state.kind === 'engagement' && state.state === 'active') return noop()
  } else if (command === 'pause') {
    if (state.state === 'paused') return noop()
    if (
      state.state === 'draft' ||
      state.state === 'lab' ||
      state.state === 'active' ||
      state.state === 'closing'
    )
      return next({ ...state, state: 'paused', resume_state: state.state })
  } else if (command === 'resume') {
    if (state.state === 'paused' && state.resume_state !== null)
      return next({ ...state, state: state.resume_state, resume_state: null })
  } else if (command === 'begin_closing') {
    if (state.state === 'closing') return noop()
    if (state.state === 'paused' && state.resume_state !== null) {
      const origin = state.resume_state === 'closing' ? state.closing_origin : state.resume_state
      if (origin !== null)
        return next({ ...state, state: 'closing', resume_state: null, closing_origin: origin })
    }
    if (['draft', 'lab', 'active'].includes(state.state))
      return next({
        ...state,
        state: 'closing',
        closing_origin: state.state as 'draft' | 'lab' | 'active',
      })
  } else if (command === 'cancel_closing') {
    if (state.state === 'closing' && state.closing_origin !== null)
      return next({
        ...state,
        state: state.closing_origin,
        resume_state: null,
        closing_origin: null,
      })
  } else if (command === 'close') {
    if (state.state === 'closed') return noop()
    if (state.state === 'closing')
      return next({ ...state, state: 'closed', resume_state: null, closing_origin: null })
  } else if (command === 'reopen' && state.state === 'closed') {
    return next({
      ...state,
      state: state.kind === 'lab' ? 'lab' : 'active',
      resume_state: null,
      closing_origin: null,
    })
  }
  throw new TransitionPolicyError(`${command} is not allowed from ${state.state}`)
}

export function allowedTransitions(
  current: Lifecycle,
): Array<{ command: TransitionCommand; allowed: boolean; reason: string | null }> {
  return commands.map((command) => {
    try {
      transitionLifecycle(current, command)
      return { command, allowed: true, reason: null }
    } catch (error) {
      if (!(error instanceof TransitionPolicyError)) throw error
      return { command, allowed: false, reason: error.message }
    }
  })
}

/** Policy data for M4/M5; no runner or RoE enforcement is performed here. */
export function lifecycleExecutionPosture(current: Lifecycle): {
  runner: 'available' | 'admission_stopped' | 'disabled'
  persistence: 'normal' | 'warn'
  destructive: 'normal' | 'warn'
} {
  const state = lifecycleSchema.parse(current).state
  return {
    runner:
      state === 'closed' ? 'disabled' : state === 'paused' ? 'admission_stopped' : 'available',
    persistence: state === 'closing' ? 'warn' : 'normal',
    destructive: state === 'closing' ? 'warn' : 'normal',
  }
}

/** Future integrations remain optional until their M4/M8/M9 services exist. */
export interface LifecycleCloseIntegration {
  quiesceRunner(projectId: string): Promise<void>
  cleanupStatus(projectId: string): Promise<unknown>
  reportStatus(projectId: string): Promise<unknown>
}
