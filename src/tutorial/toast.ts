/**
 * toast.ts: the tutorial toast (owner, 2026-11-13, copy A): a chip in the
 * instrument stack's toast group for a player who has not finished the
 * tutorial, with START and LATER (hud/TutorialToast.tsx draws it).
 *
 * Who: the identity on screen has not FINISHed the tutorial (never started,
 * skipped, or left it unfinished), the tutorial switch is on (gate.ts
 * tutorialOn), and it is not a brand-new arrival: an identity the tutorial
 * starts or resumes for by itself on this load (store/useTutorial.ts
 * tutorialStarts), or a brand-new one (isNewArrival) that has never had a
 * run, gets no toast on this load. That includes a brand-new visitor whose
 * ?mode= link held the tutorial back (store/arrivalMode.ts): a later load can
 * offer it. A brand-new key whose player skipped the tutorial before ever
 * moving is still new to isNewArrival, but has had its run: it is offered.
 *
 * When: judged once per identity per load, once the identity is settled and
 * its saved chain is in; offered TOAST_IDLE_MS later, and only once the app
 * is quiet: the relays have said where the player stands (headUnsettled), no
 * hop lined up or computing, no modal open. Never during the tutorial,
 * Cyberspace TV, the /demo tour, the 24/7 broadcast, a hyperspace ride or a
 * game (toastFits): while one of those holds it waits, and the chip on
 * screen steps aside until it is over. A tutorial run started any other way
 * on this load takes the toast away for the rest of the load.
 *
 * How often: at most once a day (TOAST_GAP_MS since the last show) and at
 * most TOAST_MAX_SHOWS times in all per identity. A show is counted when the
 * chip is actually on screen (noteToastOnScreen), not when it is dismissed.
 * Kept per pubkey on this device (TOAST_PREFIX), with a copy in memory so a
 * device that refuses storage still keeps the caps for the visit.
 *
 * START picks up a run this identity left on the device (unfinished or
 * skipped) as the menu's RESUME TUTORIAL does (useTutorial resumeTutorial):
 * at the step it was on, laid out where it was, the publishing switch
 * untouched. Only with no run to pick up does it start the tutorial as the
 * menu's RESTART TUTORIAL does (start({ restart: true })): from the first
 * step, laid out where they stand, publishing untouched. A RESTART here
 * would have wiped the run RESUME could pick up (review of #724). The chip
 * only shows while either can start. LATER puts it away for this load.
 */

import { create } from 'zustand'
import { readProgress, tutorialOn } from './gate'
import { cannotStageHere, headUnsettled, identitySettled, isNewArrival, resumeStepFor, resumeTutorial, tutorialStarts, useTutorial } from '../store/useTutorial'
import { savedChainLoaded, useCyberspace } from '../store/useCyberspace'
import { useDemo } from '../store/useDemo'
import { useTv } from '../store/useTv'
import { useGame } from '../store/useGame'
import { isBroadcast } from '../lib/tv/broadcast'
import { modalUp } from '../hooks/useEscape'

/** The words, verbatim (owner, 2026-11-13, copy A). */
export const TUTORIAL_TOAST_TEXT = "Haven't finished the tutorial yet? There's a treasure chest waiting for you!"
/** One identity's shows of the toast, by pubkey. */
export const TOAST_PREFIX = 'onosendai:tutorial:toast:'
/** Never more than this many shows per identity. */
export const TOAST_MAX_SHOWS = 3
/** At most once a day: this long since the last show. */
export const TOAST_GAP_MS = 24 * 60 * 60 * 1000
/** How long after the identity is judged before the toast is offered: not on top of the arrival. */
export const TOAST_IDLE_MS = 5_000
/** How often a waiting offer looks again for a quiet moment. */
export const TOAST_RETRY_MS = 2_000

/** How many times the toast has been on screen for one identity, and when last (ms since the epoch). */
export interface ToastRecord {
  shows: number
  last: number
}

/** This visit's copy, for a device that refuses storage. */
const memory = new Map<string, ToastRecord>()

function recordOf(v: unknown): ToastRecord | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.shows !== 'number' || typeof r.last !== 'number' || !Number.isFinite(r.shows) || !Number.isFinite(r.last)) return null
  return { shows: Math.max(0, Math.floor(r.shows)), last: r.last }
}

/** The toast's record for `pubkey`: the stored one or this visit's, whichever counts more shows. */
export function readToastRecord(pubkey: string): ToastRecord {
  let stored: ToastRecord | null = null
  try {
    const raw = localStorage.getItem(TOAST_PREFIX + pubkey)
    stored = raw ? recordOf(JSON.parse(raw)) : null
  } catch { /* private mode, or not JSON: this visit's copy */ }
  const mem = memory.get(pubkey) ?? null
  if (stored && mem) return stored.shows >= mem.shows ? stored : mem
  return stored ?? mem ?? { shows: 0, last: 0 }
}

function writeToastRecord(pubkey: string, r: ToastRecord): void {
  memory.set(pubkey, r)
  try { localStorage.setItem(TOAST_PREFIX + pubkey, JSON.stringify(r)) } catch { /* private mode: this visit only */ }
}

/** Whether the caps let the toast show at `now`: under TOAST_MAX_SHOWS, and a day since the last (a clock set back counts as a day). */
export function capsAllow(r: ToastRecord, now: number): boolean {
  if (r.shows >= TOAST_MAX_SHOWS) return false
  return r.shows === 0 || now - r.last >= TOAST_GAP_MS || now < r.last
}

/**
 * Whether the toast may be on screen for `pubkey` now: the switch on, the
 * tutorial not finished, no run going, and none of the tour, TV, the
 * broadcast, a ride or a game (where START could not lay it out either:
 * useTutorial cannotStageHere).
 */
export function toastFits(pubkey: string): boolean {
  if (!tutorialOn() || isBroadcast()) return false
  if (readProgress(pubkey)?.ended === 'finished') return false
  if (useTutorial.getState().active || useDemo.getState().active || useTv.getState().on) return false
  if (useGame.getState().session !== null) return false
  return !cannotStageHere()
}

/** Nothing under way that the toast would land on: no hop lined up or computing, no modal open. */
function quiet(): boolean {
  const cs = useCyberspace.getState()
  return cs.plan === null && cs.proof.status !== 'computing' && !modalUp()
}

/** The identity whose toast is offered on this load, or null. */
export const useTutorialToast = create<{ offer: string | null }>(() => ({ offer: null }))

/** The identities whose show was counted on this load: one offer is one show, however often the chip remounts. */
const counted = new Set<string>()

/**
 * The chip is on screen for `pubkey`'s offer: count the show, once per offer.
 * The caps are read again first: another tab may have shown it since this
 * offer was made, and then this one goes without a show.
 */
export function noteToastOnScreen(pubkey: string, now: number = Date.now()): void {
  if (useTutorialToast.getState().offer !== pubkey || counted.has(pubkey)) return
  const r = readToastRecord(pubkey)
  if (!capsAllow(r, now)) { dismissTutorialToast(); return }
  counted.add(pubkey)
  writeToastRecord(pubkey, { shows: r.shows + 1, last: now })
}

/** Forget this visit's copy of every record and count, and any offer: for tests, which reload nothing. */
export function forgetTutorialToast(): void {
  memory.clear()
  counted.clear()
  useTutorialToast.setState({ offer: null })
}

/** LATER: put the toast away for this load. */
export function dismissTutorialToast(): void {
  useTutorialToast.setState({ offer: null })
}

/**
 * START: this identity's run picked up where it was, as the menu's RESUME
 * TUTORIAL (resumeTutorial: its step, its kept anchor, publishing
 * untouched); with no run to pick up, the tutorial from the first step,
 * laid out where the player stands, publishing untouched, as the menu's
 * RESTART TUTORIAL. A run to resume is never restarted, even when the
 * resume is refused. The toast goes once the run is going; if it could not
 * start, nothing changes.
 */
export function startFromTutorialToast(): void {
  if (resumeStepFor(useCyberspace.getState().identity.pubkey) !== null) resumeTutorial()
  else useTutorial.getState().start({ restart: true })
  if (useTutorial.getState().active) dismissTutorialToast()
}

/**
 * Offer the toast once per identity per load (see the header). Returns what
 * stops the watching.
 */
export function watchTutorialToast(): () => void {
  let stopped = false
  /** The identity judged on this load, and whether it may be offered the toast. */
  let judgedFor: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = (): void => { if (timer !== null) { clearTimeout(timer); timer = null } }

  const offer = (pubkey: string): void => {
    timer = null
    if (stopped || judgedFor !== pubkey || useCyberspace.getState().identity.pubkey !== pubkey) return
    // Finished since, the switch turned off, or the caps say not today: nothing on this load.
    if (!tutorialOn() || readProgress(pubkey)?.ended === 'finished' || !capsAllow(readToastRecord(pubkey), Date.now())) return
    // Not yet: wait for a quiet moment, free of the tour, TV, a ride or a game.
    if (headUnsettled(pubkey) || !quiet() || !toastFits(pubkey)) { timer = setTimeout(() => offer(pubkey), TOAST_RETRY_MS); return }
    useTutorialToast.setState({ offer: pubkey })
  }

  const judge = (pubkey: string): void => {
    if (stopped || judgedFor !== pubkey || useCyberspace.getState().identity.pubkey !== pubkey) return
    // A brand-new arrival, or one the tutorial starts or resumes for by itself: no toast on this load.
    if (useTutorial.getState().active || tutorialStarts(pubkey) || (isNewArrival() && !readProgress(pubkey))) return
    clear()
    timer = setTimeout(() => offer(pubkey), TOAST_IDLE_MS)
  }

  const check = (): void => {
    const pubkey = useCyberspace.getState().identity.pubkey
    // Another identity: an offer for the last one goes, and this one is judged afresh.
    if (useTutorialToast.getState().offer !== null && useTutorialToast.getState().offer !== pubkey) dismissTutorialToast()
    if (judgedFor === pubkey) return
    if (judgedFor !== null) { clear(); judgedFor = null }
    if (!identitySettled()) return
    judgedFor = pubkey
    void savedChainLoaded().then(() => judge(pubkey), () => judge(pubkey))
  }

  const offCs = useCyberspace.subscribe(check)
  // A run started any other way (the menu, /tutorial) takes the toast away for the rest of this load.
  const offTutorial = useTutorial.subscribe((t) => {
    if (!t.active) return
    clear()
    dismissTutorialToast()
  })
  check()
  return () => { stopped = true; clear(); offCs(); offTutorial() }
}
