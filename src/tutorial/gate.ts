/**
 * gate.ts: whether the first-arrival tutorial may run on this device, and
 * where each player's progress is kept (first-arrival tutorial design,
 * 2026-11-10, T3).
 *
 * ON for everyone since 2026-11-13 (TUTORIAL_DEFAULT_ON). One device switch,
 * stored here:
 *   - absent: the default, on;
 *   - "on" / "off": as set.
 * The address turns it on or off: `?tutorial=1` sets "on", `?tutorial=0`
 * sets "off" (applyTutorialFlag, before the first render in main.tsx), and
 * the flag is taken off the address so a
 * shared link does not carry it on. So a tester opens onosendai.tech/?tutorial=1
 * once, and the switch stays in Settings from then on.
 *
 * Progress is kept per player pubkey, so a reload resumes at the step it was
 * on and another identity on the same device has its own.
 *
 * onosendai.tech/tutorial (owner, 2026-11-13: "a /tutorial link I can send or
 * post") turns the switch on as `?tutorial=1` does and asks for a run on this
 * load (applyTutorialRoute): a brand-new identity gets the first arrival as
 * usual, a returning one gets the tutorial from the first step, laid out
 * where it stands (store/useTutorial.ts watchFirstArrival). The address is
 * then put back to the root, so a reload does not ask again.
 */

import { create } from 'zustand'
import type { Plane } from 'cyberspace-core'

/** The device switch: "on", "off" or absent. */
export const TUTORIAL_SWITCH_KEY = 'onosendai:tutorial'
/** One player's progress, by pubkey. */
export const PROGRESS_PREFIX = 'onosendai:tutorial:progress:'

/** The switch as stored: true on, false off, null never set here. */
export function tutorialSwitch(): boolean | null {
  try {
    const v = localStorage.getItem(TUTORIAL_SWITCH_KEY)
    return v === 'on' ? true : v === 'off' ? false : null
  } catch { return null }
}

/**
 * The tutorial with no switch set on this device: ON (owner, 2026-11-13, "lets
 * get the tutorial live today", decision A: on for every new arrival, who
 * starts LOCAL as before). It still runs by itself only for a brand-new
 * identity on arrival (store/useTutorial.ts isNewArrival); everyone else sees
 * the menu's Tutorial panel and the Settings row. ?tutorial=0 or the Settings
 * switch turns it off for this device.
 */
export const TUTORIAL_DEFAULT_ON = true

/** Whether the tutorial may run on this device: the stored switch, else the default. */
export function tutorialEnabled(): boolean {
  return tutorialSwitch() ?? TUTORIAL_DEFAULT_ON
}

/** The switch as the Settings row reads it, so a change from anywhere (the address, the row) shows at once. */
export const useTutorialSwitch = create<{ value: boolean | null }>(() => ({ value: tutorialSwitch() ?? TUTORIAL_DEFAULT_ON }))

export function setTutorialSwitch(on: boolean): void {
  try { localStorage.setItem(TUTORIAL_SWITCH_KEY, on ? 'on' : 'off') } catch { /* private mode: this visit only */ }
  useTutorialSwitch.setState({ value: on })
}

/**
 * Whether the tutorial may run on this device: this visit's switch when one is
 * set (it holds even when storage refused to keep it, so turning it off
 * sticks: review of #716), else the stored switch or the default.
 */
export function tutorialOn(): boolean {
  const v = useTutorialSwitch.getState().value
  return v !== null ? v : tutorialEnabled()
}

/**
 * The address the page loaded on, noted before the first render (main.tsx):
 * a first arrival is one that landed on the bare app, whatever an early
 * effect did to the address since (a /C/ link that could not open puts / in
 * its place).
 */
let landed: string | null = null
export function noteLanding(pathname: string): void {
  landed = pathname
}
/** The noted landing address, or the address now when none was noted. */
export function landedPath(): string {
  if (landed !== null) return landed
  try { return window.location.pathname } catch { return '' }
}

/**
 * Whether this load's address asked for an arrival mode (`?mode=view` or
 * `?mode=region`, store/arrivalMode.ts takeArrivalMode notes it before the
 * first render). Such a load gets the mode, not the first-arrival tutorial
 * (owner, 2026-11-13): store/useTutorial.ts tutorialStarts reads this. Kept
 * for the whole load, whether the mode was applied or dropped since, so the
 * tutorial never starts later on the same load. Kept here, not in
 * arrivalMode.ts, so the tutorial's engine reads it without importing that.
 */
let modeOnLoad = false
export function noteArrivalModeAsked(asked: boolean): void {
  modeOnLoad = asked
}
/** Whether this load arrived with ?mode=view or ?mode=region. */
export function arrivalModeAsked(): boolean {
  return modeOnLoad
}

/** Whether an address is the tutorial's own: /tutorial or /tutorial/, in any case. */
export function isTutorialPath(pathname: string): boolean {
  return /^\/tutorial\/?$/i.test(pathname)
}

/** A run asked for by the /tutorial address, not yet acted on (store/useTutorial.ts watchFirstArrival takes it). */
let asked = false
/** Whether the /tutorial address asked for a run that has not been acted on yet. */
export function tutorialAsked(): boolean {
  return asked
}
/** Act on the ask: it is taken once. Returns whether there was one. */
export function takeTutorialAsk(): boolean {
  const was = asked
  asked = false
  return was
}

/**
 * The /tutorial address (owner, 2026-11-13): turn this device's switch on, as
 * `?tutorial=1` does, ask for a run on this load (tutorialAsked), and put the
 * root in the address (replaceState, no new entry) with whatever query and
 * fragment the link carried, so a reload or a copied address does not ask
 * again. Run before the first render (main.tsx) and on Back or Forward onto
 * the address (watchFirstArrival). Returns whether the address was it.
 */
export function applyTutorialRoute(loc: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location, history: Pick<History, 'replaceState' | 'state'> = window.history): boolean {
  if (!isTutorialPath(loc.pathname)) return false
  setTutorialSwitch(true)
  asked = true
  try { history.replaceState(history.state, '', `/${loc.search}${loc.hash}`) } catch { /* no history here */ }
  return true
}

/**
 * Read `?tutorial=1` or `?tutorial=0` off the address, set the switch to it,
 * and take the flag off the address (replaceState, no new entry). Returns the
 * value it set, or null when the address had no flag.
 */
export function applyTutorialFlag(loc: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location, history: Pick<History, 'replaceState' | 'state'> = window.history): boolean | null {
  let params: URLSearchParams
  try { params = new URLSearchParams(loc.search) } catch { return null }
  if (!params.has('tutorial')) return null
  const raw = (params.get('tutorial') ?? '').trim().toLowerCase()
  // Only the words for on and off; anything else changes nothing and stays on the address.
  const on = raw === '1' || raw === 'on' || raw === 'true' || raw === '' ? true : raw === '0' || raw === 'off' || raw === 'false' ? false : null
  if (on === null) return null
  setTutorialSwitch(on)
  params.delete('tutorial')
  const search = params.toString()
  try { history.replaceState(history.state, '', `${loc.pathname}${search ? `?${search}` : ''}${loc.hash}`) } catch { /* no history here */ }
  return on
}

/**
 * Where a run is laid out (tutorial/layout.ts): the place the player stood
 * when /tutorial or RESTART TUTORIAL started it, in its plane. A first
 * arrival keeps none: it is laid out at the spawn, where it stands anyway.
 */
export interface TutorialAnchor {
  x: bigint
  y: bigint
  z: bigint
  plane: Plane
}

/**
 * What a player's progress says: the step it was on, whether it ended (and
 * how), the routes after the basics already done, so a reload on the
 * choices card keeps them checked off (tutorial feedback 2026-11-11, item 10),
 * and where the run is laid out when that is not the spawn, so a reload
 * stages the same place.
 */
export interface TutorialProgress {
  step: string
  ended?: 'finished' | 'skipped'
  choices?: string[]
  anchor?: TutorialAnchor
}

/** A stored anchor, its numbers kept as decimal strings (JSON has no bigint), or null when it is not whole. */
function anchorOf(v: unknown): TutorialAnchor | null {
  if (!v || typeof v !== 'object') return null
  const a = v as Record<string, unknown>
  const n = (k: string): bigint | null => (typeof a[k] === 'string' && /^\d{1,40}$/.test(a[k] as string) ? BigInt(a[k] as string) : null)
  const x = n('x'), y = n('y'), z = n('z')
  if (x === null || y === null || z === null || (a.plane !== 0 && a.plane !== 1)) return null
  return { x, y, z, plane: a.plane }
}

export function readProgress(pubkey: string): TutorialProgress | null {
  try {
    const raw = localStorage.getItem(PROGRESS_PREFIX + pubkey)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<TutorialProgress>
    if (typeof v.step !== 'string') return null
    if (v.ended !== undefined && v.ended !== 'finished' && v.ended !== 'skipped') return null
    const choices = Array.isArray(v.choices) ? v.choices.filter((c): c is string => typeof c === 'string') : []
    // An anchor that is not whole is dropped, never the progress: the run is then laid out at the spawn.
    const anchor = anchorOf(v.anchor)
    return { step: v.step, ...(v.ended ? { ended: v.ended } : {}), ...(choices.length ? { choices } : {}), ...(anchor ? { anchor } : {}) }
  } catch { return null }
}

export function writeProgress(pubkey: string, p: TutorialProgress | null): void {
  try {
    if (p === null) localStorage.removeItem(PROGRESS_PREFIX + pubkey)
    else {
      const { anchor, ...rest } = p
      const kept = anchor ? { ...rest, anchor: { x: anchor.x.toString(), y: anchor.y.toString(), z: anchor.z.toString(), plane: anchor.plane } } : rest
      localStorage.setItem(PROGRESS_PREFIX + pubkey, JSON.stringify(kept))
    }
  } catch { /* private mode: this visit only */ }
}
