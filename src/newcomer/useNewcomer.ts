/**
 * useNewcomer.ts: the newcomer view, per identity (new-user feedback,
 * 2026-11-21; owner: "lets see this on a preview deploy").
 *
 * WHO IS A NEWCOMER. An identity whose first-arrival tour started as a first
 * arrival (store/useTutorial.ts isNewArrival: a key this app just made, with
 * no chain) is a newcomer until the tour is finished or skipped; then it
 * graduates and keeps today's full HUD. Everyone else (an identity with a
 * chain, a returning player on /tutorial or RESTART) is experienced and sees
 * the full HUD as always.
 *
 * WHAT THE NEWCOMER VIEW IS. Plain names (newcomer/names.ts), and only the
 * parts of the screen the tour has reached (newcomer/reveal.ts): while a run
 * goes for this identity, each part shows once the step that introduces it
 * has come up. Outside a run it shows everything the tour teaches.
 *
 * THE SETTING. Settings > Interface: "Show everything" or "Newcomer view"
 * (hud/NewcomerSetting.tsx). A choice made there holds for this identity
 * whatever its stage; with none made the stage decides.
 *
 * KEPT PER IDENTITY IN INDEXEDDB (owner, 2026-11-19: "all local data per
 * npub, in IndexedDB"): one record per pubkey, `onosendai:newcomer:<pubkey>`,
 * through lib/kvStore.ts (the prefix is in its MOVED_PREFIXES), read
 * synchronously from memory so the first frame is already right.
 *
 * ?newcomer=1 (applyNewcomerFlag) starts the newcomer view over for this tab
 * only, and asks for a tour run, so the owner can try it on a preview without
 * a new key. The record it plays with lives in sessionStorage, for this tab;
 * the stored record is never touched. ?newcomer=0 ends it, as does closing
 * the tab.
 */

import { useMemo } from 'react'
import { create } from 'zustand'
import { kvGet, kvSet } from '../lib/kvStore'
import { keyMintedOnLoad, useCyberspace } from '../store/useCyberspace'
import { isNewArrival, onTutorialLifecycle, tutorialMayRun, useTutorial } from '../store/useTutorial'
import { arrivalModeAsked, readProgress, tutorialOn, useTutorialSwitch } from '../tutorial/gate'
import { useDemo } from '../store/useDemo'
import { useTv } from '../store/useTv'
import { SESSION_PREFIX, session, sessionNewcomer } from './flag'
import { REVEAL, revealed, type RevealId, type RevealState } from './reveal'

export type NewcomerStage = 'newcomer' | 'graduated'
export type HudChoice = 'newcomer' | 'everything'

/** One identity's record. */
export interface NewcomerRecord {
  /** Absent for an experienced player, who never was a newcomer here. */
  stage?: NewcomerStage
  /** The tour steps that have come up in this player's run, in the order seen. */
  seen: string[]
  /** Settings > Interface, when this player chose; absent lets the stage decide. */
  choice?: HudChoice
}

export const NEWCOMER_PREFIX = 'onosendai:newcomer:'

const EMPTY: NewcomerRecord = { seen: [] }

/** A stored record, or null when there is none or it is not one. */
export function parseRecord(raw: string | null): NewcomerRecord | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<NewcomerRecord> | null
    if (!v || typeof v !== 'object') return null
    const stage = v.stage === 'newcomer' || v.stage === 'graduated' ? v.stage : undefined
    const choice = v.choice === 'newcomer' || v.choice === 'everything' ? v.choice : undefined
    const seen = Array.isArray(v.seen) ? v.seen.filter((s): s is string => typeof s === 'string') : []
    return { ...(stage ? { stage } : {}), seen, ...(choice ? { choice } : {}) }
  } catch { return null }
}

/** The record for `pubkey`: this tab's while it plays a newcomer (a fresh newcomer when it has none yet), else the stored one. */
export function readRecord(pubkey: string): NewcomerRecord {
  if (sessionNewcomer()) {
    let raw: string | null = null
    try { raw = session()?.getItem(SESSION_PREFIX + pubkey) ?? null } catch { /* refused */ }
    return parseRecord(raw) ?? { stage: 'newcomer', seen: [] }
  }
  return parseRecord(kvGet(NEWCOMER_PREFIX + pubkey)) ?? EMPTY
}

/** Keep `pubkey`'s record: in this tab's storage while it plays a newcomer, else in the database (kvStore). */
export function writeRecord(pubkey: string, rec: NewcomerRecord): void {
  const text = JSON.stringify(rec)
  if (sessionNewcomer()) {
    try { session()?.setItem(SESSION_PREFIX + pubkey, text) } catch { /* this load only */ }
    return
  }
  kvSet(NEWCOMER_PREFIX + pubkey, text)
}

/**
 * Whether the newcomer view is on for a record: the choice in Settings, else
 * the stage, while the tour can still run on this device (its switch on): a
 * newcomer who turns the tutorial off is never left in a partial HUD with
 * nothing to bring the rest.
 */
export function newcomerViewOf(rec: NewcomerRecord, tourOn: boolean = tutorialOn()): boolean {
  if (rec.choice) return rec.choice === 'newcomer'
  return rec.stage === 'newcomer' && tourOn
}

interface NewcomerState {
  /** The identity the record is for. */
  pubkey: string | null
  record: NewcomerRecord
  /** When each part came into view in this page's life, for its arrival animation. */
  arrivals: Partial<Record<RevealId, number>>
}

/** The identity on screen as the app's modules load: its record is read before the first frame, so nothing shows and then goes. */
function initial(): NewcomerState {
  try {
    const pubkey = useCyberspace.getState().identity.pubkey
    return { pubkey, record: readRecord(pubkey), arrivals: {} }
  } catch { return { pubkey: null, record: EMPTY, arrivals: {} } }
}

export const useNewcomer = create<NewcomerState>(initial)

/** Read the record for the identity on screen, when it changed. */
export function loadNewcomer(pubkey: string = useCyberspace.getState().identity.pubkey): void {
  useNewcomer.setState({ pubkey, record: readRecord(pubkey), arrivals: {} })
}

/** Change a record and keep it; the store follows when it is the identity on screen. */
function update(pubkey: string, change: (rec: NewcomerRecord) => NewcomerRecord): void {
  const cur = useNewcomer.getState().pubkey === pubkey ? useNewcomer.getState().record : readRecord(pubkey)
  const next = change(cur)
  if (next === cur) return
  writeRecord(pubkey, next)
  if (useNewcomer.getState().pubkey === pubkey) useNewcomer.setState({ record: next })
}

/** Settings > Interface: "Show everything" or "Newcomer view", for the identity on screen. */
export function setHudChoice(choice: HudChoice): void {
  const pubkey = useNewcomer.getState().pubkey ?? useCyberspace.getState().identity.pubkey
  update(pubkey, (rec) => (rec.choice === choice ? rec : { ...rec, choice }))
  // Turned on mid-run: what the run has reached shows at once, never less than its step needs.
  if (choice === 'newcomer') noteStep(pubkey, false)
}

/**
 * The steps a run at `index` has passed through: every step up to it on the
 * way through (branches skipped), and the step itself (a branch included).
 */
export function stepsThrough(steps: ReadonlyArray<{ id: string; branch?: boolean }>, index: number): string[] {
  const out: string[] = []
  for (let i = 0; i < index && i < steps.length; i++) if (!steps[i].branch) out.push(steps[i].id)
  if (steps[index]) out.push(steps[index].id)
  return out
}

/** Note the step on screen as seen (and every step before it), stamping what it brings into view. */
function noteStep(pubkey: string, fresh: boolean): void {
  const t = useTutorial.getState()
  if (!t.active || t.pubkey !== pubkey) return
  const passed = stepsThrough(t.script.steps, t.index)
  const rec = useNewcomer.getState().pubkey === pubkey ? useNewcomer.getState().record : readRecord(pubkey)
  // A run begun from the first step starts the staging over.
  const base = fresh && t.index === 0 ? [] : rec.seen
  const add = passed.filter((id) => !base.includes(id))
  if (add.length === 0 && base === rec.seen) return
  if (useNewcomer.getState().pubkey === pubkey) {
    const now = Date.now()
    const arrivals = { ...useNewcomer.getState().arrivals }
    for (const [id, at] of Object.entries(REVEAL) as Array<[RevealId, string]>) if (add.includes(at)) arrivals[id] = now
    useNewcomer.setState({ arrivals })
  }
  update(pubkey, (r) => ({ ...r, seen: [...base, ...add] }))
}

/**
 * Keep the record in step with the identity on screen and its tour run: a
 * first arrival's run makes it a newcomer, each step it reaches is noted,
 * and a run finished or skipped graduates it. Returns what stops it (App).
 */
export function watchNewcomer(): () => void {
  if (useNewcomer.getState().pubkey !== useCyberspace.getState().identity.pubkey) loadNewcomer()
  let pending = false
  let fresh = false
  // After the change settles: start() sets the run active before it enters its first step.
  const settle = (): void => {
    pending = false
    const t = useTutorial.getState()
    const pubkey = useNewcomer.getState().pubkey
    if (!t.active || !pubkey || t.pubkey !== pubkey) { fresh = false; return }
    const rec = useNewcomer.getState().record
    if (!rec.stage && fresh && isNewArrival()) update(pubkey, (r) => ({ ...r, stage: 'newcomer', seen: [] }))
    if (newcomerViewOf(useNewcomer.getState().record)) noteStep(pubkey, fresh)
    fresh = false
  }
  const offId = useCyberspace.subscribe((s, prev) => {
    if (s.identity.pubkey !== prev.identity.pubkey) loadNewcomer(s.identity.pubkey)
  })
  const offTour = useTutorial.subscribe((s, prev) => {
    if (s.active === prev.active && s.index === prev.index && s.pubkey === prev.pubkey) return
    if (!pending) { pending = true; queueMicrotask(settle) }
  })
  // Only a run that ends graduates: a RESTART stops the run and starts it again at once.
  const offLife = onTutorialLifecycle({
    // A run starting (a first arrival, a resume, a RESTART): settled once it has entered its step.
    start: () => {
      fresh = true
      if (!pending) { pending = true; queueMicrotask(settle) }
    },
    stop: (how) => {
      if (how === 'pause') return
      const who = useTutorial.getState().pubkey
      if (!who) return
      queueMicrotask(() => {
        const t = useTutorial.getState()
        if (t.active && t.pubkey === who) return
        update(who, (rec) => (rec.stage === 'newcomer' ? { ...rec, stage: 'graduated' } : rec))
      })
    },
  })
  // A run already going when this starts (a hot reload): note it.
  if (useTutorial.getState().active) { pending = true; queueMicrotask(settle) }
  return () => { offId(); offTour(); offLife() }
}

/** Whether a run left unfinished will resume on this load for `pubkey` (store/useTutorial.ts tutorialStarts, without the first arrival). */
function resumable(pubkey: string): boolean {
  if (!tutorialMayRun() || arrivalModeAsked()) return false
  const p = readProgress(pubkey)
  return p !== null && !p.ended
}

/**
 * A key made on this very load, with no chain and no run yet, on a load the
 * tour will start on: the first arrival's tour is about to begin. Staged from
 * the first frame, so the full HUD never shows for a moment and then goes.
 */
function firstArrivalAhead(rec: NewcomerRecord, pubkey: string): boolean {
  if (rec.stage || rec.choice || keyMintedOnLoad() !== pubkey) return false
  if (useCyberspace.getState().events.length > 0 || !tutorialMayRun() || arrivalModeAsked()) return false
  return readProgress(pubkey) === null
}

/** How the newcomer view stands, from the record and the tour. Pure but for the progress read. */
export function revealStateOf(rec: NewcomerRecord, pubkey: string | null, tourMine: boolean): RevealState {
  // A first arrival whose tour is about to start is a newcomer already.
  const ahead = !tourMine && pubkey !== null && firstArrivalAhead(rec, pubkey)
  const newcomer = ahead || newcomerViewOf(rec)
  // A newcomer's run about to resume stages from the first frame, so nothing shows and then goes.
  const staged = newcomer && (tourMine || ahead || (rec.stage === 'newcomer' && pubkey !== null && resumable(pubkey)))
  return { newcomer, staged, seen: new Set(rec.seen) }
}

/** The newcomer view's state for the identity on screen. */
export function useRevealState(): RevealState {
  const rec = useNewcomer((s) => s.record)
  const pubkey = useNewcomer((s) => s.pubkey)
  const tourMine = useTutorial((s) => s.active && s.pubkey !== null && s.pubkey === pubkey)
  // What decides whether a run is about to start or resume (tutorialMayRun): read again when any changes.
  const moved = useCyberspace((s) => s.events.length > 0)
  const tour = useDemo((s) => s.active)
  const tv = useTv((s) => s.on)
  const tourSwitch = useTutorialSwitch((s) => s.value)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => revealStateOf(rec, pubkey, tourMine), [rec, pubkey, tourMine, moved, tour, tv, tourSwitch])
}

/** Whether the newcomer view is on (plain names) for the identity on screen. */
export function useNewcomerView(): boolean {
  const on = useTutorialSwitch((s) => s.value !== false)
  return useNewcomer((s) => newcomerViewOf(s.record, on))
}

/** Whether the newcomer view is on, outside React. */
export function newcomerViewNow(): boolean {
  return newcomerViewOf(useNewcomer.getState().record)
}

/** How long a part that just came into view wears its arrival, ms (styles.css .nc-arrive). */
export const ARRIVE_MS = 1600

/** Each part's class: hidden in place while not reached ('nc-veiled'), arriving for a moment once it is ('nc-arrive'), else none. */
export function useRevealClass(): (id: RevealId) => string {
  const state = useRevealState()
  const arrivals = useNewcomer((s) => s.arrivals)
  return (id) => {
    if (!revealed(id, state)) return ' nc-veiled'
    const at = arrivals[id]
    return at !== undefined && Date.now() - at < ARRIVE_MS ? ' nc-arrive' : ''
  }
}
