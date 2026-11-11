/**
 * gate.ts: whether the first-arrival tutorial may run on this device, and
 * where each player's progress is kept (first-arrival tutorial design,
 * 2026-11-10, T3).
 *
 * OFF in production until the owner turns it on for new identities. One
 * device switch, stored here:
 *   - absent: off, and the Settings row is not shown (every visitor today);
 *   - "on" / "off": the Settings row is shown with that state.
 * The address turns it on or off: `?tutorial=1` sets "on", `?tutorial=0`
 * sets "off" (applyTutorialFlag, before the first render in main.tsx), and
 * the flag is taken off the address so a
 * shared link does not carry it on. So a tester opens onosendai.tech/?tutorial=1
 * once, and the switch stays in Settings from then on.
 *
 * Progress is kept per player pubkey, so a reload resumes at the step it was
 * on and another identity on the same device has its own.
 */

import { create } from 'zustand'

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

/** Whether the tutorial may run on this device. */
export function tutorialEnabled(): boolean {
  return tutorialSwitch() === true
}

/** The switch as the Settings row reads it, so a change from anywhere (the address, the row) shows at once. */
export const useTutorialSwitch = create<{ value: boolean | null }>(() => ({ value: tutorialSwitch() }))

export function setTutorialSwitch(on: boolean): void {
  try { localStorage.setItem(TUTORIAL_SWITCH_KEY, on ? 'on' : 'off') } catch { /* private mode: this visit only */ }
  useTutorialSwitch.setState({ value: on })
}

/**
 * Whether the tutorial may run on this device: the stored switch, or this
 * visit's when storage refused it.
 */
export function tutorialOn(): boolean {
  return useTutorialSwitch.getState().value === true || tutorialEnabled()
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

/** What a player's progress says: the step it was on, and whether it ended (and how). */
export interface TutorialProgress {
  step: string
  ended?: 'finished' | 'skipped'
}

export function readProgress(pubkey: string): TutorialProgress | null {
  try {
    const raw = localStorage.getItem(PROGRESS_PREFIX + pubkey)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<TutorialProgress>
    if (typeof v.step !== 'string') return null
    if (v.ended !== undefined && v.ended !== 'finished' && v.ended !== 'skipped') return null
    return v.ended ? { step: v.step, ended: v.ended } : { step: v.step }
  } catch { return null }
}

export function writeProgress(pubkey: string, p: TutorialProgress | null): void {
  try {
    if (p === null) localStorage.removeItem(PROGRESS_PREFIX + pubkey)
    else localStorage.setItem(PROGRESS_PREFIX + pubkey, JSON.stringify(p))
  } catch { /* private mode: this visit only */ }
}
