/**
 * useTutorial.ts: the first-arrival tutorial's engine (first-arrival
 * tutorial design, 2026-11-10; T1, T3).
 *
 * The script (src/tutorial/script.ts) is data; this walks it, with the /demo
 * tour's own pieces (store/useDemo.ts applyScene, watchAction, aimCursor).
 * What it does not take from /demo: the tour's LOCAL. The tutorial never
 * touches the publishing switch, so a newcomer's moves are as real as any
 * (a new identity is LIVE): the first move signs the spawn, and what they
 * plant stays. It is gated by a device switch that is off in production
 * (tutorial/gate.ts), shown only to a brand-new identity on arrival
 * (isNewArrival), kept per player pubkey so a reload resumes, and started
 * again by RESTART TUTORIAL in Settings.
 *
 * A step that waits counts as done when its action happens, and the tutorial
 * goes on by itself a moment later (ADVANCE_MS): less reading, more doing.
 * NEXT is there on every step and reads SKIP while a step waits; SKIP
 * TUTORIAL (the coach's X) ends it for this player.
 */

import { create } from 'zustand'
import { TUTORIAL_SCRIPT } from '../tutorial/script'
import type { TutorialScript, TutorialStep, TutorialWait } from '../tutorial/types'
import type { DemoAction } from '../demo/types'
import { readProgress, tutorialEnabled, writeProgress } from '../tutorial/gate'
import { aimCursor, applyScene, useDemo, watchAction } from './useDemo'
import { appMinted, keyMintedOnLoad, useCyberspace } from './useCyberspace'
import { useTv } from './useTv'

/** How long a done step stays on screen, its ✓ showing, before the next comes up. */
export const ADVANCE_MS = 900

/**
 * A watcher for one of the tutorial's own waits (tutorial/types.ts
 * TutorialAction): calls `onDone` once when the player has done it, and
 * returns what stops it. Each part of the tutorial registers its own
 * (registerTutorialWatcher), next to what it stages.
 */
export type TutorialWatcher = (onDone: () => void) => () => void

const TUTORIAL_WATCHERS = new Map<string, TutorialWatcher>()

export function registerTutorialWatcher(name: string, watcher: TutorialWatcher): void {
  TUTORIAL_WATCHERS.set(name, watcher)
}

/** Watch for a step's wait: a tutorial watcher when one is registered under its name, else the /demo engine's. */
function watchWait(wait: TutorialWait, onDone: () => void): () => void {
  const own = TUTORIAL_WATCHERS.get(wait)
  return own ? own(onDone) : watchAction(wait as DemoAction, onDone)
}

/**
 * What runs as the tutorial comes up for a player (a start, a resume or a
 * restart) and as it goes away: the stager seals the guide's things here
 * (lib/tutorial/stage.ts). `restart` is true for RESTART TUTORIAL.
 */
export interface TutorialLifecycle {
  start?: (pubkey: string, restart: boolean) => void
  stop?: () => void
}
const lifecycles: TutorialLifecycle[] = []
export function onTutorialLifecycle(l: TutorialLifecycle): () => void {
  lifecycles.push(l)
  return () => { const i = lifecycles.indexOf(l); if (i >= 0) lifecycles.splice(i, 1) }
}

/**
 * Whether the identity on screen is brand new (T3): a key this app made on
 * this device (not an imported nsec, an extension or a bunker) with no chain,
 * and either made on this page load or checked with the relays and found to
 * have none (lib/chainHold.ts selfCheck). The /demo tour's own test
 * (useDemo tourKeyAtStart) plus the relays' answer for a key made earlier.
 */
export function isNewArrival(): boolean {
  const cs = useCyberspace.getState()
  if (cs.signerKind !== 'local' || cs.events.length > 0) return false
  const pubkey = cs.identity.pubkey
  if (keyMintedOnLoad() === pubkey) return true
  return appMinted(pubkey) === true && cs.selfCheck.pubkey === pubkey && cs.selfCheck.status === 'none'
}

/** Whether the identity on screen can be judged yet: made on this load, or its relay check has an answer. */
function settled(): boolean {
  const cs = useCyberspace.getState()
  const pubkey = cs.identity.pubkey
  if (keyMintedOnLoad() === pubkey || cs.events.length > 0) return true
  return cs.selfCheck.pubkey === pubkey && cs.selfCheck.status !== 'checking'
}

/** The address a first arrival lands on: the bare app, not /demo, /tv, /C/, /workshop or any other route. */
function plainAddress(): boolean {
  try { return window.location.pathname === '/' } catch { return false }
}

interface TutorialState {
  active: boolean
  /** The player this run belongs to. */
  pubkey: string | null
  /** The step on screen, an index into the script. */
  index: number
  /** Whether the current step's `wait` has happened (true for a step with none). */
  done: boolean
  /** Folded to a one-line bar. */
  minimized: boolean
  /** The EXPLAIN pill is open. */
  explaining: boolean
  script: TutorialScript
  /** Start (or resume) for the identity on screen; `at` names a step, `restart` begins again from the first. */
  start: (opts?: { at?: string; restart?: boolean }) => void
  /** NEXT (or SKIP on a step still waiting); on the last step, FINISH. */
  next: () => void
  /** End the run for this player, kept as finished or skipped. */
  end: (how: 'finished' | 'skipped') => void
  /** Put it away without ending it (another identity, the /demo tour): the next load resumes. */
  pause: () => void
  setMinimized: (minimized: boolean) => void
  setExplaining: (explaining: boolean) => void
}

/** What undoes the current step's watchers. */
let stepCleanups: Array<() => void> = []
let advanceTimer: ReturnType<typeof setTimeout> | null = null

function cleanupStep(): void {
  if (advanceTimer !== null) { clearTimeout(advanceTimer); advanceTimer = null }
  for (const c of stepCleanups.splice(0)) { try { c() } catch { /* already gone */ } }
}

export const useTutorial = create<TutorialState>((set, get) => {
  const enter = (index: number): void => {
    cleanupStep()
    const step: TutorialStep | undefined = get().script.steps[index]
    const pubkey = get().pubkey
    if (!step || !pubkey) return
    set({ index, done: !step.wait, explaining: false })
    writeProgress(pubkey, { step: step.id })
    if (step.scene) applyScene(step.scene, step.wait === 'walk')
    if (step.wait) {
      stepCleanups.push(watchWait(step.wait, () => {
        if (get().index !== index || !get().active) return
        set({ done: true })
        // On by itself, a moment after the ✓: the next thing to do comes up.
        advanceTimer = setTimeout(() => { advanceTimer = null; if (get().active && get().index === index) get().next() }, ADVANCE_MS)
      }))
    }
    if (step.aim && !get().done) aimCursor(step.aim)
  }

  const stop = (): void => {
    cleanupStep()
    for (const l of lifecycles) { try { l.stop?.() } catch (err) { console.warn('[tutorial] stop failed:', err) } }
  }

  return {
    active: false,
    pubkey: null,
    index: 0,
    done: true,
    minimized: false,
    explaining: false,
    script: TUTORIAL_SCRIPT,

    start: (opts = {}) => {
      const pubkey = useCyberspace.getState().identity.pubkey
      if (opts.restart) writeProgress(pubkey, null)
      const steps = get().script.steps
      const at = opts.at ? steps.findIndex((s) => s.id === opts.at) : 0
      set({ active: true, pubkey, minimized: false })
      for (const l of lifecycles) { try { l.start?.(pubkey, opts.restart === true) } catch (err) { console.warn('[tutorial] start failed:', err) } }
      enter(at >= 0 ? at : 0)
    },

    next: () => {
      const s = get()
      if (!s.active) return
      const step = s.script.steps[s.index]
      if (step?.gate && !s.done) return
      const i = s.index + 1
      if (i < s.script.steps.length) enter(i)
      else get().end('finished')
    },

    end: (how) => {
      const s = get()
      if (!s.active) return
      const step = s.script.steps[s.index]
      if (s.pubkey) writeProgress(s.pubkey, { step: step?.id ?? s.script.steps[0].id, ended: how })
      stop()
      set({ active: false, minimized: false, explaining: false })
    },

    pause: () => {
      if (!get().active) return
      stop()
      set({ active: false, minimized: false, explaining: false })
    },

    setMinimized: (minimized) => set({ minimized }),
    setExplaining: (explaining) => set({ explaining }),
  }
})

/**
 * Start the tutorial for a first arrival, or resume one a player left
 * unfinished, once the identity on screen can be judged; and put it away if
 * the identity changes or the /demo tour starts. Only with the device switch
 * on, only on the bare address, never over the tour or TV. Returns what stops
 * the watching.
 */
export function watchFirstArrival(): () => void {
  let decidedFor: string | null = null
  const check = (): void => {
    const cs = useCyberspace.getState()
    const pubkey = cs.identity.pubkey
    const t = useTutorial.getState()
    // Someone else signed in: this run is theirs no longer. Their progress stays.
    if (t.active && t.pubkey !== pubkey) t.pause()
    if (decidedFor === pubkey || !settled()) return
    decidedFor = pubkey
    if (!tutorialEnabled() || useTutorial.getState().active) return
    if (useDemo.getState().active || useTv.getState().on || !plainAddress()) return
    const p = readProgress(pubkey)
    if (p?.ended) return
    if (p) useTutorial.getState().start({ at: p.step })
    else if (isNewArrival()) useTutorial.getState().start()
  }
  check()
  const offCs = useCyberspace.subscribe(check)
  // The tour and the tutorial never run together: the tour wins, the tutorial waits for the next load.
  const offDemo = useDemo.subscribe((d) => { if (d.active) useTutorial.getState().pause() })
  const offTv = useTv.subscribe((v) => { if (v.on) useTutorial.getState().pause() })
  return () => { offCs(); offDemo(); offTv() }
}
