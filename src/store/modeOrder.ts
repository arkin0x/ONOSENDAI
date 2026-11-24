/**
 * modeOrder.ts - MODES: the order of the pad's modes, and which are on
 * (owner, 2026-11-24: "make a "MODES" settings panel in the menu where you
 * can drag to reorder the modes. Fully customizable. For example, someone
 * could make WALK be the default mode instead of HOP, and BUILD be the
 * always-present Secondary button mode"; and the same day: "also make it so
 * you can toggle MODES off so they aren't part of the rotation").
 *
 * THE ORDER IS THE PAD, in two parts (owner, 2026-11-24: "Make the first
 * position in the panel the toggle mode position, and the second position
 * the default mode position. then it will make more sense: default cycles
 * down through the list; toggle slot is separate").
 *
 * - The first place (TOGGLE_AT) is the TOGGLE MODE slot: the mode on the
 *   pad's second button, the dim toggle in RECALL's slot, where WALK has
 *   stood since 2026-11-12. It is its own slot: its mode is never in the
 *   ring as well. Switched off, there is no second button and the slot is
 *   RECALL's.
 * - Every place after it is the ring. The first of those (DEFAULT_AT) is
 *   the DEFAULT MODE, the one the app starts in, and the mode button goes
 *   down through it and every other mode on after it, round to the top.
 *
 * Today's pad is the default list, WALK, then HOP, VIEW, BUILD, SCAN, all
 * on: WALK the toggle, start in HOP, the ring HOP, VIEW, BUILD, SCAN.
 *
 * MOVING. Within the ring a mode moves to its new place and the others make
 * room. Into or out of the toggle slot it trades places: a mode moved into
 * the slot sends the slot's mode to where it came from, and the slot's mode
 * moved down trades with the mode at the place it lands on (moveModeTo).
 *
 * OFF is out of the rotation only. A mode switched off leaves the ring (or
 * the toggle slot's button), and stays in the list, dimmed, to be switched
 * back on. Whatever asks for it by name still gets it: B for BUILD, N for
 * SCAN, the tour, a link, PLACE from the workshop, TRY WALK. In a mode that
 * is not in the ring (the toggle's mode, or one switched off), the mode
 * button is the way back, dim, as it is in WALK today (store/padMode.ts).
 *
 * GUARDS. The default mode is always on: its switch is disabled, and a mode
 * moved to that place is switched on. So the ring always has a mode.
 *
 * WHO GETS IT. The list is the player's own: kept per identity in IndexedDB
 * (owner, 2026-11-19: all local data per npub), `onosendai:modes:<pubkey>`,
 * through lib/kvStore.ts. A new identity starts with the default list. The
 * newcomer view, a tour run, the /demo tour and Cyberspace TV all use the
 * default list (effectiveModes), so the tour's steps find the pad they
 * teach, and a newcomer sees MOVE, LOOK AROUND, BUILD, FIND HIDDEN as the
 * tour reveals them. Once the tour is finished or skipped, the list applies.
 *
 * A LIST FROM ANOTHER VERSION. A mode the stored list does not know (one
 * added later) joins at its default place, after the nearest mode above it
 * in the default list's ring, and never in the toggle slot or the default
 * place;
 * a mode this version does not know is dropped; a record that is not a list
 * reads as the default (mergeModes). Adding a mode is one row in MODES, and
 * nothing else here changes.
 *
 * A LIST KEPT BEFORE THE TOGGLE SLOT (record v1, PR #915, 2026-11-24): its
 * first mode was the one the app started in and the first mode on after it
 * was the second button. It is read as the same pad (fromV1): that second
 * button becomes the toggle slot and the first mode the default, so nobody's
 * pad changes. It is written back in the new form on the next change.
 */

import { useMemo } from 'react'
import { create } from 'zustand'
import { kvGet, kvRemove, kvSet } from '../lib/kvStore'
import type { PadMode } from './padMode'
import { useCyberspace } from './useCyberspace'
import { useTutorial } from './useTutorial'
import { useDemo } from './useDemo'
import { useTv } from './useTv'
import { newcomerViewOf, useNewcomer } from '../newcomer/useNewcomer'
import { useTutorialSwitch } from '../tutorial/gate'

export type ModeId = PadMode

/** One mode as MODES lists it: its word on the pad, its own key (if any), and a few plain words. */
export interface ModeInfo {
  id: ModeId
  /** The word on the pad's buttons. */
  word: string
  /** The key that goes in and out of it by name, wherever it stands in the list. */
  key?: string
  /** What it does, in a few words. */
  what: string
}

/** Every mode, in the order a new mode joins the list. A new mode is a row here. */
export const MODES: readonly ModeInfo[] = [
  { id: 'hop', word: 'HOP', what: 'Line up a move, COMMIT sends it' },
  { id: 'walk', word: 'WALK', what: 'First person, every press a step' },
  { id: 'view', word: 'VIEW', what: 'Look around, nothing moves' },
  { id: 'build', word: 'BUILD', key: 'B', what: 'Place things at a build cursor' },
  { id: 'scan', word: 'SCAN', key: 'N', what: 'Look for hidden things' },
]

/** The toggle slot's place in the list, and the default mode's: the first in the ring. */
export const TOGGLE_AT = 0
export const DEFAULT_AT = 1

/** The default toggle: WALK, on the second button since 2026-11-12. */
export const DEFAULT_TOGGLE: ModeId = 'walk'

/** The default list: the toggle slot, then the ring in MODES order. Today's pad. */
export const DEFAULT_MODE_ORDER: readonly ModeId[] = [DEFAULT_TOGGLE, ...MODES.map((m) => m.id).filter((id) => id !== DEFAULT_TOGGLE)]

export function modeInfo(id: ModeId): ModeInfo {
  return MODES.find((m) => m.id === id) ?? { id, word: id.toUpperCase(), what: '' }
}

/** The list: every mode in order, and the ones switched off. */
export interface ModeSettings {
  /** The toggle slot's mode (TOGGLE_AT), then the ring, the default mode first (DEFAULT_AT). */
  order: readonly ModeId[]
  off: readonly ModeId[]
}

export const DEFAULT_MODES: ModeSettings = { order: DEFAULT_MODE_ORDER, off: [] }

/** What the list makes of the pad. */
export interface ModeRoles {
  /** The mode the app starts in: the default mode, the first in the ring. */
  start: ModeId
  /** The second button's mode: the toggle slot's, or null while it is off. */
  second: ModeId | null
  /** The mode button's ring, in order: the default mode, then every other mode on after it. */
  ring: readonly ModeId[]
}

function isModeId(v: unknown, known: readonly ModeId[]): v is ModeId {
  return typeof v === 'string' && (known as readonly string[]).includes(v)
}

/** The default mode always on (the guard): turned on if it was off. */
function guarded(order: readonly ModeId[], off: readonly ModeId[]): ModeSettings {
  const first = order[DEFAULT_AT]
  return { order, off: off.filter((id) => id !== first) }
}

/**
 * A list read against `defaults`: known modes keep their stored place (the
 * first mention wins), a missing one joins after the nearest mode above it
 * in `defaults` (or at the top), but no higher than place `floor` while the
 * list reaches that far, and never after the mode at place `slot`, which is
 * not where its neighbours are; an unknown one is dropped.
 */
function mergeList(saved: unknown, defaults: readonly ModeId[], floor: number, slot: number): { order: ModeId[]; off: ModeId[] } {
  const s = (saved && typeof saved === 'object' ? saved : {}) as { order?: unknown; off?: unknown }
  const order: ModeId[] = []
  if (Array.isArray(s.order)) for (const id of s.order) if (isModeId(id, defaults) && !order.includes(id)) order.push(id)
  defaults.forEach((id, i) => {
    if (order.includes(id)) return
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(defaults[j])
      if (k >= 0 && k !== slot) { at = k + 1; break }
    }
    order.splice(Math.max(at, Math.min(floor, order.length)), 0, id)
  })
  const off: ModeId[] = []
  if (Array.isArray(s.off)) for (const id of s.off) if (isModeId(id, defaults) && !off.includes(id)) off.push(id)
  return { order, off }
}

/**
 * A stored list read against this version's modes (see the header): known
 * modes keep their stored place, a missing one joins after the nearest mode
 * above it in the default list, never in the toggle slot or the default
 * place (so a new mode changes neither), and an unknown one is dropped.
 * Anything that is not a list is the default.
 */
export function mergeModes(saved: unknown, defaults: readonly ModeId[] = DEFAULT_MODE_ORDER): ModeSettings {
  const { order, off } = mergeList(saved, defaults, DEFAULT_AT + 1, TOGGLE_AT)
  return guarded(order, off)
}

/**
 * A list kept before the toggle slot (record v1; see the header) as the
 * same pad: its first mode (always on) was the start, the first mode on
 * after it the second button. That second button goes to the toggle slot
 * and the rest keep their order, the start now first in the ring. With only
 * one mode on there was no second button: the mode after the start goes to
 * the slot, still off, so there is none now either.
 */
export function fromV1(saved: unknown): ModeSettings {
  const { order, off } = mergeList(saved, MODES.map((m) => m.id), 0, -1)
  const start = order[0]
  const on = (id: ModeId): boolean => id === start || !off.includes(id)
  const toggle = order.find((id) => id !== start && on(id)) ?? order[1]
  return mergeModes({ order: [toggle, ...order.filter((id) => id !== toggle)], off })
}

/** What the list makes of the pad (ModeRoles). */
export function rolesOf(s: ModeSettings): ModeRoles {
  const toggle = s.order[TOGGLE_AT]
  const ring = s.order.slice(DEFAULT_AT).filter((id) => !s.off.includes(id))
  const start = ring[0] ?? s.order[DEFAULT_AT] ?? 'hop'
  const second = toggle !== undefined && toggle !== start && !s.off.includes(toggle) ? toggle : null
  return { start, second, ring: ring.length ? ring : [start] }
}

/** Whether two lists are the same list. */
export function sameModes(a: ModeSettings, b: ModeSettings): boolean {
  return a.order.length === b.order.length && a.order.every((id, i) => id === b.order[i])
    && a.off.length === b.off.length && a.off.every((id) => b.off.includes(id))
}

/**
 * `id` moved to place `to` (TOGGLE_AT is the top), clamped to the list.
 * Within the ring the others make room; into or out of the toggle slot the
 * two modes trade places, so the slot always holds one mode and the rest of
 * the ring keeps its order. The default mode is always on, so one moved to
 * that place is switched on.
 */
export function moveModeTo(s: ModeSettings, id: ModeId, to: number): ModeSettings {
  const from = s.order.indexOf(id)
  if (from < 0) return s
  const at = Math.max(0, Math.min(s.order.length - 1, to))
  if (at === from) return s
  let order: ModeId[]
  if (from === TOGGLE_AT || at === TOGGLE_AT) {
    order = [...s.order]
    order[from] = s.order[at]
    order[at] = id
  } else {
    order = s.order.filter((m) => m !== id)
    order.splice(at, 0, id)
  }
  return guarded(order, s.off)
}

/** `id` one place up (-1) or down (+1): the default mode up, or the toggle down, trades the two. */
export function moveModeBy(s: ModeSettings, id: ModeId, delta: number): ModeSettings {
  return moveModeTo(s, id, s.order.indexOf(id) + delta)
}

/** Whether `id`'s switch can turn it off: never the default mode, so the ring always has one. */
export function canSwitchOff(s: ModeSettings, id: ModeId): boolean {
  return s.order[DEFAULT_AT] !== id
}

/** `id` switched on or off; the default mode stays on (canSwitchOff). */
export function setModeOn(s: ModeSettings, id: ModeId, on: boolean): ModeSettings {
  const isOff = s.off.includes(id)
  if (on === !isOff) return s
  if (!on && !canSwitchOff(s, id)) return s
  return guarded(s.order, on ? s.off.filter((m) => m !== id) : [...s.off, id])
}

/**
 * The mode the ring's button goes to from `current`: the next in the ring,
 * round to the first. From a mode not in the ring, the first mode of the
 * ring after its place in the list (store/padMode.ts uses the way back
 * instead, as WALK has; this is for a mode with nowhere to go back to).
 */
export function nextInRing(s: ModeSettings, current: ModeId): ModeId {
  const { ring } = rolesOf(s)
  const i = ring.indexOf(current)
  if (i >= 0) return ring[(i + 1) % ring.length]
  const at = s.order.indexOf(current)
  for (let k = 1; k <= s.order.length; k++) {
    const id = s.order[(at + k) % s.order.length]
    if (ring.includes(id)) return id
  }
  return ring[0]
}

// ---------- Kept per identity ----------

export const MODES_PREFIX = 'onosendai:modes:'
/** 2: the toggle slot first (2026-11-24). 1, or no version: the start first (fromV1). */
const RECORD_VERSION = 2

/** The stored list for `pubkey`, merged against this version's modes; null when there is none (the default applies). */
export function readModes(pubkey: string): ModeSettings | null {
  let raw: string | null = null
  try { raw = kvGet(MODES_PREFIX + pubkey) } catch { return null }
  if (!raw) return null
  try {
    const saved = JSON.parse(raw) as { v?: unknown } | null
    return saved && typeof saved === 'object' && saved.v === RECORD_VERSION ? mergeModes(saved) : fromV1(saved)
  } catch { return null }
}

/** Keep `pubkey`'s list; the default list is kept as no record, so a later default reaches it. */
export function writeModes(pubkey: string, s: ModeSettings | null): void {
  if (!s || sameModes(s, DEFAULT_MODES)) { kvRemove(MODES_PREFIX + pubkey); return }
  kvSet(MODES_PREFIX + pubkey, JSON.stringify({ v: RECORD_VERSION, order: s.order, off: s.off }))
}

interface ModesState {
  /** The identity the list is for. */
  pubkey: string | null
  /** Its list as stored, merged (null: the default). */
  saved: ModeSettings | null
  /**
   * The mode to go back to from the second button's mode, set when the
   * second button was pressed; else the last ring mode the pad was in
   * (lastRing). WALK keeps its own (useWalk `from`).
   */
  back: ModeId | null
  lastRing: ModeId | null
}

function initial(): ModesState {
  try {
    const pubkey = useCyberspace.getState().identity.pubkey
    return { pubkey, saved: readModes(pubkey), back: null, lastRing: null }
  } catch { return { pubkey: null, saved: null, back: null, lastRing: null } }
}

export const useModes = create<ModesState>(initial)

/** Read the list for `pubkey` (the identity on screen by default). */
export function loadModes(pubkey: string = useCyberspace.getState().identity.pubkey): void {
  useModes.setState({ pubkey, saved: readModes(pubkey), back: null, lastRing: null })
}

/** The identity on screen's list, read again first when the identity changed. */
export function storedModes(): ModeSettings {
  const me = useCyberspace.getState().identity.pubkey
  if (useModes.getState().pubkey !== me) loadModes(me)
  return useModes.getState().saved ?? DEFAULT_MODES
}

/** Change the identity on screen's list and keep it. */
export function updateModes(change: (s: ModeSettings) => ModeSettings): void {
  const cur = storedModes()
  const next = change(cur)
  if (next === cur || sameModes(next, cur)) return
  const pubkey = useModes.getState().pubkey ?? useCyberspace.getState().identity.pubkey
  writeModes(pubkey, next)
  useModes.setState({ saved: sameModes(next, DEFAULT_MODES) ? null : next })
}

/** RESET TO DEFAULT: today's pad again, and no record kept. */
export function resetModes(): void {
  const pubkey = useModes.getState().pubkey ?? useCyberspace.getState().identity.pubkey
  writeModes(pubkey, null)
  useModes.setState({ saved: null })
}

/**
 * Whether the player's own list applies now: not in the newcomer view, a
 * tour run, the /demo tour or Cyberspace TV, which all teach or show the
 * default pad.
 */
export function customModesApply(): boolean {
  if (newcomerViewOf(useNewcomer.getState().record)) return false
  if (useTutorial.getState().active || useDemo.getState().active || useTv.getState().on) return false
  return true
}

/** The list the pad follows now (customModesApply). */
export function effectiveModes(): ModeSettings {
  return customModesApply() ? storedModes() : DEFAULT_MODES
}

/** What the pad follows now. */
export function modeRoles(): ModeRoles {
  return rolesOf(effectiveModes())
}

/** The list the pad follows, for React. */
export function useEffectiveModes(): ModeSettings {
  const me = useCyberspace((s) => s.identity.pubkey)
  const pubkey = useModes((s) => s.pubkey)
  const saved = useModes((s) => s.saved)
  const record = useNewcomer((s) => s.record)
  const tourSwitch = useTutorialSwitch((s) => s.value)
  const touring = useTutorial((s) => s.active)
  const demo = useDemo((s) => s.active)
  const tv = useTv((s) => s.on)
  return useMemo(() => {
    if (newcomerViewOf(record) || touring || demo || tv) return DEFAULT_MODES
    return pubkey !== me ? storedModesFor(me) : saved ?? DEFAULT_MODES
    // tourSwitch: newcomerViewOf reads the tutorial's switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, pubkey, saved, record, touring, demo, tv, tourSwitch])
}

/** A render that saw a new identity before the store did: read its list without writing state mid-render. */
function storedModesFor(pubkey: string): ModeSettings {
  return readModes(pubkey) ?? DEFAULT_MODES
}

/** The pad's roles, for React. */
export function useModeRoles(): ModeRoles {
  const s = useEffectiveModes()
  return useMemo(() => rolesOf(s), [s])
}

/** The identity on screen's own list, for the MODES panel. */
export function useStoredModes(): ModeSettings {
  const me = useCyberspace((s) => s.identity.pubkey)
  const pubkey = useModes((s) => s.pubkey)
  const saved = useModes((s) => s.saved)
  return pubkey === me ? saved ?? DEFAULT_MODES : storedModesFor(me)
}

let started = false

/** Follow the identity on screen (App, beside the other starters). */
export function startModes(): void {
  if (started) return
  started = true
  storedModes()
  useCyberspace.subscribe((s, prev) => { if (s.identity.pubkey !== prev.identity.pubkey) loadModes(s.identity.pubkey) })
}
