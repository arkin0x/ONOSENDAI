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
import { landedPath, readProgress, tutorialOn, writeProgress } from '../tutorial/gate'
import { aimCursor, applyScene, useDemo, watchAction } from './useDemo'
import { appMinted, keyMintedOnLoad, savedChainLoaded, useCyberspace } from './useCyberspace'
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

/**
 * Something a step does as it comes up, beyond its scene (TutorialStep
 * `effect`): lining the cursor up on a staged place, say. Registered by name
 * next to what it is about (registerTutorialEffect); returns what undoes it.
 */
export type TutorialEffect = () => (() => void) | void

const TUTORIAL_EFFECTS = new Map<string, TutorialEffect>()

export function registerTutorialEffect(name: string, effect: TutorialEffect): void {
  TUTORIAL_EFFECTS.set(name, effect)
}

/** Run a registered effect once, for a coach button (TutorialStep `action`); what it returns to undo is not kept. */
export function runTutorialEffect(name: string): void {
  try { TUTORIAL_EFFECTS.get(name)?.() } catch (err) { console.warn('[tutorial] action failed:', err) }
}

/**
 * What a choice does that a step cannot (TutorialChoice `when`): the dungeon
 * enters a game (Track C, the Games DECK). Unregistered, the choice is not
 * offered; registering it later shows it at once (the coach redraws).
 *
 * The seam for Track C: `registerTutorialChoice('dungeon', { run })` from
 * any module, at any time (tutorial/dungeon.ts does). `run` is the player's
 * own choice and may return a promise (publishing enter-virtual is async).
 * It runs while the card is still up, and a second tap meanwhile does
 * nothing. Words it returns are a refusal: they are shown on the card
 * (`choiceNote`) and the card stays, so the player can choose again or take
 * DONE. Nothing returned means it went: a choice with a `step` goes to that
 * step, so a coach step can follow the player into the game, and one without
 * ends the tutorial as finished. A `run` that throws or rejects is logged and
 * said on the card in plain words (CHOICE_FAILED_MESSAGE).
 */
export type TutorialChoiceResult = void | string | null
export interface TutorialChoiceRun { run: () => TutorialChoiceResult | Promise<TutorialChoiceResult> }
const TUTORIAL_CHOICES = new Map<string, TutorialChoiceRun>()
/** On the card when a choice's run threw: the error itself goes to the console. */
export const CHOICE_FAILED_MESSAGE = 'That did not work. Try again.'
/** Which run of a choice may still settle: anything that moves the tutorial on makes an older one stale. */
let choiceToken = 0

export function registerTutorialChoice(name: string, choice: TutorialChoiceRun): void {
  TUTORIAL_CHOICES.set(name, choice)
  useTutorial.setState((s) => ({ choicesVersion: s.choicesVersion + 1 }))
}

/** Whether a choice is offered: no `when`, or one registered under it. */
export function choiceOffered(c: { when?: string }): boolean {
  return !c.when || TUTORIAL_CHOICES.has(c.when)
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

/**
 * Whether the identity on screen can be judged yet: made on this load, a
 * chain in hand, or a relay check that said "found" or "none". A check that
 * could not say (offline, unreachable) is asked again by the self-sync, and
 * the tutorial waits for that answer rather than deciding on none.
 */
function settled(): boolean {
  const cs = useCyberspace.getState()
  const pubkey = cs.identity.pubkey
  if (keyMintedOnLoad() === pubkey || cs.events.length > 0) return true
  return cs.selfCheck.pubkey === pubkey && (cs.selfCheck.status === 'none' || cs.selfCheck.status === 'found')
}

/** Whether the page landed on the bare app, not /demo, /tv, /C/, /workshop or any other route (tutorial/gate.ts noteLanding). */
function plainAddress(): boolean {
  return landedPath() === '/'
}

/** Why the tutorial cannot start now: the /demo tour or Cyberspace TV is on. */
function blocked(): boolean {
  return useDemo.getState().active || useTv.getState().on
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
  /** Bumped whenever a choice is registered, so the coach shows it. */
  choicesVersion: number
  /** The choice whose run is under way (its card waits), or null. */
  choosing: string | null
  /** Why the last choice did not go, in plain words, on the card until the next choice or step. */
  choiceNote: string | null
  /** A sentence about the step on screen (why its button did nothing), shown in place of its hint; cleared on every step change. */
  stepNote: string | null
  /** Set the step note, only while the step at `index` is still the one on screen. */
  noteStep: (index: number, note: string | null) => void
  script: TutorialScript
  /** Start (or resume) for the identity on screen; `at` names a step, `restart` begins again from the first. */
  start: (opts?: { at?: string; restart?: boolean }) => void
  /** NEXT (or SKIP on a step still waiting); on the last step, FINISH. */
  next: () => void
  /** A choice on a modal step (TutorialChoice): its registered run first, if any, then its branch step or the end. */
  choose: (choiceId: string) => void
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
  choiceToken++
  if (advanceTimer !== null) { clearTimeout(advanceTimer); advanceTimer = null }
  for (const c of stepCleanups.splice(0)) { try { c() } catch { /* already gone */ } }
}

export const useTutorial = create<TutorialState>((set, get) => {
  const enter = (index: number, from?: number): void => {
    cleanupStep()
    const steps = get().script.steps
    const step: TutorialStep | undefined = steps[index]
    const pubkey = get().pubkey
    if (!step || !pubkey) return
    // A step that needs WALK, come to without walking: back to the step that
    // asks for WALK, unless that is the one just SKIPped, in which case past
    // everything that needs it.
    if (step.needsWalk && !useCyberspace.getState().walking) {
      const back = steps.findIndex((s) => s.id === step.needsWalk)
      if (back >= 0 && from !== back) { enter(back); return }
      let past = index
      while (past < steps.length && (steps[past].needsWalk || steps[past].branch)) past++
      if (past < steps.length) { enter(past); return }
      get().end('skipped')
      return
    }
    set({ index, done: !step.wait, explaining: false, choosing: null, choiceNote: null, stepNote: null })
    writeProgress(pubkey, { step: step.id })
    if (step.scene) applyScene(step.scene, step.wait === 'walk', (c) => { stepCleanups.push(c) })
    // Leaving WALK while such a step is up goes back to the step that asks for it.
    if (step.needsWalk) {
      stepCleanups.push(useCyberspace.subscribe((s, prev) => {
        if (prev.walking && !s.walking && get().active && get().index === index) {
          const back = get().script.steps.findIndex((st) => st.id === step.needsWalk)
          if (back >= 0) queueMicrotask(() => { if (get().active && get().index === index) enter(back) })
        }
      }))
    }
    if (step.wait) {
      stepCleanups.push(watchWait(step.wait, () => {
        // Once: a watcher that calls twice must not start a second timer.
        if (get().index !== index || !get().active || get().done) return
        set({ done: true })
        // On by itself, a moment after the ✓: the next thing to do comes up.
        advanceTimer = setTimeout(() => { advanceTimer = null; if (get().active && get().index === index) get().next() }, ADVANCE_MS)
      }))
    }
    if (step.aim && !get().done) aimCursor(step.aim)
    const effect = step.effect ? TUTORIAL_EFFECTS.get(step.effect) : undefined
    if (effect) {
      try { const undo = effect(); if (undo) stepCleanups.push(undo) } catch (err) { console.warn('[tutorial] step effect failed:', err) }
    }
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
    choicesVersion: 0,
    choosing: null,
    choiceNote: null,
    stepNote: null,
    noteStep: (index, note) => { if (get().active && get().index === index) set({ stepNote: note }) },
    script: TUTORIAL_SCRIPT,

    start: (opts = {}) => {
      // Never over the tour or TV, which would put it away again at once.
      if (blocked()) return
      // Started again while running (RESTART): what the run had going stops first.
      if (get().active) stop()
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
      // A branch's NEXT is FINISH; on the way through, branches are passed over.
      let i = step?.branch ? s.script.steps.length : s.index + 1
      while (i < s.script.steps.length && s.script.steps[i].branch) i++
      if (i < s.script.steps.length) enter(i, s.index)
      // Past the last step with its wait still to do is a skip, not a finish.
      else get().end(step?.wait && !s.done ? 'skipped' : 'finished')
    },

    choose: (choiceId) => {
      const s = get()
      if (!s.active || s.choosing) return
      const here = s.script.steps[s.index]
      if (here?.gate && !s.done) return
      const choice = here?.choices?.find((c) => c.id === choiceId)
      if (!choice || !choiceOffered(choice)) return
      const run = choice.when ? TUTORIAL_CHOICES.get(choice.when) : undefined
      const at = choice.step ? s.script.steps.findIndex((st) => st.id === choice.step) : -1
      if (choice.step && at < 0) { console.warn(`[tutorial] choice ${choice.id} names no step ${choice.step}`); return }
      const went = (): void => { if (choice.step) enter(at); else get().end('finished') }
      if (!run) { went(); return }
      const token = ++choiceToken
      set({ choosing: choice.id, choiceNote: null })
      // Only the run still current settles: a step, an end or a restart since makes it stale.
      const settle = (note: string | null): void => {
        if (token !== choiceToken || !get().active) return
        set({ choosing: null, choiceNote: note })
        if (!note) went()
      }
      void Promise.resolve().then(() => run.run()).then(
        (result) => settle(typeof result === 'string' && result ? result : null),
        (err: unknown) => { console.warn('[tutorial] choice failed:', err); settle(CHOICE_FAILED_MESSAGE) },
      )
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
  let stopped = false
  // Once the saved chain is in hand (a chain read from its rows can land
  // after the relays have answered "none"), and only for the identity still
  // on screen.
  const decide = (pubkey: string): void => {
    if (stopped || useCyberspace.getState().identity.pubkey !== pubkey) return
    if (!settled()) { decidedFor = null; return }
    if (!tutorialOn() || useTutorial.getState().active || blocked() || !plainAddress()) return
    const p = readProgress(pubkey)
    if (p?.ended) return
    if (p) useTutorial.getState().start({ at: p.step })
    else if (isNewArrival()) useTutorial.getState().start()
  }
  const check = (): void => {
    const cs = useCyberspace.getState()
    const pubkey = cs.identity.pubkey
    const t = useTutorial.getState()
    // Someone else signed in: this run is theirs no longer. Their progress
    // stays, unless it was on a last word after the choice (logging in is
    // what AGENTS asks for), which counts as finished.
    if (t.active && t.pubkey !== pubkey) {
      if (t.script.steps[t.index]?.branch) t.end('finished')
      else t.pause()
    }
    if (decidedFor === pubkey || !settled()) return
    decidedFor = pubkey
    void savedChainLoaded().then(() => decide(pubkey), () => decide(pubkey))
  }
  check()
  const offCs = useCyberspace.subscribe(check)
  // The tour and the tutorial never run together: the tour wins, the tutorial waits for the next load.
  const offDemo = useDemo.subscribe((d) => { if (d.active) useTutorial.getState().pause() })
  const offTv = useTv.subscribe((v) => { if (v.on) useTutorial.getState().pause() })
  return () => { stopped = true; offCs(); offDemo(); offTv() }
}
