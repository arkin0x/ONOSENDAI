/**
 * useTutorial.ts: the first-arrival tutorial's engine (first-arrival
 * tutorial design, 2026-11-10; T1, T3).
 *
 * The script (src/tutorial/script.ts) is data; this walks it, with the /demo
 * tour's own pieces (store/useDemo.ts applyScene, watchAction, aimCursor).
 * A first arrival starts LOCAL (feedback 2026-11-11, item 15): the first move
 * still signs the spawn and what they plant stays, but nothing is published
 * until they flip the publishing switch themselves, so a newcomer sandboxes
 * safely. A resume or a RESTART leaves the switch where they left it. It is gated by a
 * device switch that is off in production
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
import { landedPath, readProgress, tutorialOn, writeProgress, type TutorialProgress } from '../tutorial/gate'
import { aimCursor, applyScene, useDemo, watchAction } from './useDemo'
import { appMinted, keyMintedOnLoad, savedChainLoaded, useCyberspace } from './useCyberspace'
import { useTv } from './useTv'
import { setMenuOpen } from '../hooks/useMenuOpen'

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
  /**
   * The run went away. `how` is why: 'finished' keeps what it staged on
   * screen, local only (feedback item 9); 'skipped' and 'pause' take it away.
   */
  stop?: (how: 'finished' | 'skipped' | 'pause') => void
  /** A load for a player who FINISHed: what the run kept is put back on screen, local only (feedback item 9). */
  restore?: (pubkey: string) => void
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
  /** The route choices done this run, checked off on the choices card (feedback item 10). */
  doneChoices: string[]
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
  /** BACK: the step before, skipping the branch steps (feedback item 8). */
  back: () => void
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
  // `viaBack`: come to by BACK. A step already done then shows its ✓ and waits
  // for NEXT, rather than moving on by itself again (feedback item 8).
  const enter = (index: number, from?: number, viaBack = false): void => {
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
    writeProgress(pubkey, progress(step.id))
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
        if (viaBack) return
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

  /** What is kept for a step: its id, and the routes checked off so far (feedback item 10). */
  const progress = (step: string, ended?: 'finished' | 'skipped'): TutorialProgress => {
    const choices = get().doneChoices
    return { step, ...(ended ? { ended } : {}), ...(choices.length ? { choices } : {}) }
  }

  const stop = (how: 'finished' | 'skipped' | 'pause'): void => {
    cleanupStep()
    for (const l of lifecycles) { try { l.stop?.(how) } catch (err) { console.warn('[tutorial] stop failed:', err) } }
  }

  return {
    active: false,
    pubkey: null,
    index: 0,
    done: true,
    minimized: false,
    explaining: false,
    choicesVersion: 0,
    doneChoices: [],
    choosing: null,
    choiceNote: null,
    stepNote: null,
    noteStep: (index, note) => { if (get().active && get().index === index) set({ stepNote: note }) },
    script: TUTORIAL_SCRIPT,

    start: (opts = {}) => {
      // Never over the tour or TV, which would put it away again at once.
      if (blocked()) return
      // Started again while running (RESTART): what the run had going stops first.
      if (get().active) stop('skipped')
      const pubkey = useCyberspace.getState().identity.pubkey
      if (opts.restart) writeProgress(pubkey, null)
      const steps = get().script.steps
      const at = opts.at ? steps.findIndex((s) => s.id === opts.at) : 0
      // A first arrival starts clutter-free and local: the menu shut (feedback
      // item 16), publishing off (feedback item 15). A RESTART shuts the menu
      // too (it is started from the menu) but leaves the publishing switch as
      // the player set it; a resume leaves both. The inventory step opens the
      // menu itself.
      if (!opts.at || opts.restart) setMenuOpen(false)
      if (!opts.at && !opts.restart) {
        try { useCyberspace.getState().setLive(false) } catch { /* no switch here */ }
      }
      // A resume keeps the routes already checked off (feedback item 10).
      const doneChoices = opts.at && !opts.restart ? readProgress(pubkey)?.choices ?? [] : []
      set({ active: true, pubkey, minimized: false, doneChoices })
      for (const l of lifecycles) { try { l.start?.(pubkey, opts.restart === true) } catch (err) { console.warn('[tutorial] start failed:', err) } }
      enter(at >= 0 ? at : 0)
    },

    next: () => {
      const s = get()
      if (!s.active) return
      const step = s.script.steps[s.index]
      if (step?.gate && !s.done) return
      // A branch's NEXT returns to the choices with this one checked off, so
      // the player can try the rest (feedback item 10).
      if (step?.branch) {
        const ci = s.script.steps.findIndex((st) => st.choices)
        const choice = ci >= 0 ? s.script.steps[ci].choices?.find((c) => c.step === step.id) : undefined
        if (choice && !s.doneChoices.includes(choice.id)) set({ doneChoices: [...s.doneChoices, choice.id] })
        if (ci >= 0) { enter(ci, s.index); return }
        get().end('finished')
        return
      }
      let i = s.index + 1
      while (i < s.script.steps.length && s.script.steps[i].branch) i++
      if (i < s.script.steps.length) enter(i, s.index)
      // Past the last step with its wait still to do is a skip, not a finish.
      else get().end(step?.wait && !s.done ? 'skipped' : 'finished')
    },

    back: () => {
      const s = get()
      if (!s.active) return
      // On a branch, BACK is the way back to the choices, but it checks
      // nothing off: only NEXT (FINISH) there says the route was done.
      if (s.script.steps[s.index]?.branch) {
        const ci = s.script.steps.findIndex((st) => st.choices)
        if (ci >= 0) enter(ci, s.index, true)
        return
      }
      let i = s.index - 1
      while (i > 0 && s.script.steps[i].branch) i--
      if (i >= 0 && i !== s.index) enter(i, s.index, true)
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
      if (s.pubkey) writeProgress(s.pubkey, progress(step?.id ?? s.script.steps[0].id, how))
      stop(how)
      set({ active: false, minimized: false, explaining: false })
    },

    pause: () => {
      if (!get().active) return
      stop('pause')
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
    if (p?.ended) {
      if (p.ended === 'finished') for (const l of lifecycles) { try { l.restore?.(pubkey) } catch (err) { console.warn('[tutorial] restore failed:', err) } }
      return
    }
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
