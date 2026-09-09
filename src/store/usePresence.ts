/**
 * usePresence.ts — who is in this part of cyberspace, targeted or not.
 *
 * Until now the only people ever drawn were your targets. Cyberspace is
 * 2^85 gibsons on a side; passing an avatar without knowing is the normal
 * case, and the first meeting in it happened only because both people
 * targeted each other by hand. This is the feed that makes the meeting
 * happen on its own.
 *
 * Every action carries its destination's sector on four tags: X, Y and Z per
 * axis and S combined, a sector being 2^30 gibsons on a side (spec §10). A
 * relay indexes single-letter tags, and tag filters combine with AND across
 * tags and OR within one, so one subscription on the three axis tags, each
 * listing your sector and its two neighbors, returns every action landing in
 * the 27 sectors around you. One filter, reissued when you cross a sector.
 *
 * Each author's newest action in the neighborhood is where they are. Someone
 * who leaves does not announce it here (their next action lands outside the
 * filter), so people not heard from in a while are confirmed by asking the
 * relay for their newest action and dropped if it is elsewhere.
 */

import { create } from 'zustand'
import { xyzToSectorId } from 'cyberspace-core'
import type { Filter } from 'nostr-tools/filter'
import { ACTION_KIND, parseAction, type NostrEvent, type ActionType } from '../lib/events'
import type { Plane } from 'cyberspace-core'
import { V2_ACTIONS } from '../lib/chains'
import { query, subscribe } from '../lib/relay'
import type { Position } from '../lib/space'
import { useCyberspace } from './useCyberspace'

export interface Person {
  pubkey: string
  position: Position
  plane: Plane
  /** created_at of the action that put them here. */
  lastActive: number
  type: ActionType
  /** When the relay last confirmed this is still their newest action. */
  checkedAt: number
}

/** Newest actions fetched when a neighborhood is entered. */
export const BACKFILL_LIMIT = 500
/** A person not heard from for this long is asked about before being kept. */
export const CONFIRM_AFTER_S = 10 * 60
/** How often the sweep that confirms quiet people runs. */
export const SWEEP_EVERY_MS = 5 * 60 * 1000

/** The sector a position is in, as the string the S tag carries. */
export function sectorKey(p: Position): string {
  const s = xyzToSectorId(p.x, p.y, p.z)
  return `${s.sx}-${s.sy}-${s.sz}`
}

/** The 27 sectors around a position, as one relay filter. */
export function neighborhoodFilter(p: Position): Filter {
  const s = xyzToSectorId(p.x, p.y, p.z)
  const around = (v: bigint): string[] => [v - 1n, v, v + 1n].map(String)
  return { kinds: [ACTION_KIND], '#A': V2_ACTIONS, '#X': around(s.sx), '#Y': around(s.sy), '#Z': around(s.sz) }
}

/** Whether a position's sector is within one of the given sector on every axis. */
export function inNeighborhood(p: Position, of: Position): boolean {
  const a = xyzToSectorId(p.x, p.y, p.z)
  const b = xyzToSectorId(of.x, of.y, of.z)
  const near = (u: bigint, v: bigint): boolean => u >= v - 1n && u <= v + 1n
  return near(a.sx, b.sx) && near(a.sy, b.sy) && near(a.sz, b.sz)
}

interface PresenceState {
  people: Record<string, Person>
  /** The sector the feed is anchored to, or null before the first. */
  sector: string | null
  /** True while the neighborhood's backfill is in flight. */
  loading: boolean
  /** Take an action event in: the newest per author wins. */
  ingest: (ev: NostrEvent, now?: number) => void
  /** Drop someone; the sweep does this when their newest action is elsewhere. */
  forget: (pubkey: string) => void
  /** Everyone here who is not you and not already a target. */
  others: () => Person[]
}

export const usePresence = create<PresenceState>((set, get) => ({
  people: {},
  sector: null,
  loading: false,

  ingest: (ev, now = Math.floor(Date.now() / 1000)) => {
    const action = parseAction(ev)
    if (!action) return
    const me = useCyberspace.getState().identity.pubkey
    if (action.pubkey === me) return
    const have = get().people[action.pubkey]
    if (have && have.lastActive >= action.createdAt) return
    set({ people: { ...get().people, [action.pubkey]: {
      pubkey: action.pubkey, position: action.position, plane: action.plane,
      lastActive: action.createdAt, type: action.type, checkedAt: now,
    } } })
  },

  forget: (pubkey) => {
    const people = { ...get().people }
    delete people[pubkey]
    set({ people })
  },

  others: () => {
    const { identity, targets } = useCyberspace.getState()
    return Object.values(get().people).filter((p) => p.pubkey !== identity.pubkey && !targets[p.pubkey])
  },
}))

let stopLive: (() => void) | null = null
let started = false
let sweepHandle: ReturnType<typeof setInterval> | null = null

/** Enter the neighborhood around `at`: forget the old one, fetch, then listen. */
async function enter(at: Position): Promise<void> {
  const key = sectorKey(at)
  if (usePresence.getState().sector === key) return
  stopLive?.()
  stopLive = null
  usePresence.setState({ sector: key, people: {}, loading: true })
  const filter = neighborhoodFilter(at)
  // Listen from a minute back before the fetch, so nothing lands in the gap.
  const since = Math.floor(Date.now() / 1000) - 60
  stopLive = subscribe({ ...filter, since }, (ev) => {
    if (usePresence.getState().sector !== key) return
    usePresence.getState().ingest(ev)
  })
  try {
    const events = await query({ ...filter, limit: BACKFILL_LIMIT })
    if (usePresence.getState().sector !== key) return
    for (const ev of events) usePresence.getState().ingest(ev)
  } catch {
    /* the live feed still stands */
  } finally {
    if (usePresence.getState().sector === key) usePresence.setState({ loading: false })
  }
}

/**
 * Confirm the quiet ones. A person's newest action in the neighborhood is
 * where they are only until they act somewhere else, and that action never
 * arrives here. Ask the relay for their newest action of any kind; keep them
 * if it is still in the neighborhood, at its position, or drop them.
 */
async function sweep(): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const here = useCyberspace.getState().position
  const quiet = Object.values(usePresence.getState().people).filter((p) => now - p.checkedAt >= CONFIRM_AFTER_S)
  for (const person of quiet) {
    try {
      const newest = (await query({ kinds: [ACTION_KIND], authors: [person.pubkey], '#A': V2_ACTIONS, limit: 1 }))
        .sort((a, b) => b.created_at - a.created_at)[0]
      const action = newest ? parseAction(newest) : null
      if (!action || !inNeighborhood(action.position, here)) { usePresence.getState().forget(person.pubkey); continue }
      usePresence.setState((s) => ({ people: { ...s.people, [person.pubkey]: {
        ...s.people[person.pubkey], position: action.position, plane: action.plane, lastActive: action.createdAt, type: action.type, checkedAt: now,
      } } }))
    } catch {
      /* ask again next sweep */
    }
  }
}

/** Idempotent. Follows your avatar from sector to sector for the life of the page. */
export function startPresence(): void {
  if (started) return
  started = true
  void enter(useCyberspace.getState().position)
  useCyberspace.subscribe((s, prev) => {
    if (s.position !== prev.position) void enter(s.position)
  })
  sweepHandle = setInterval(() => { void sweep() }, SWEEP_EVERY_MS)
}

/** For tests: forget everything and stop listening. */
export function stopPresence(): void {
  stopLive?.()
  stopLive = null
  if (sweepHandle) { clearInterval(sweepHandle); sweepHandle = null }
  started = false
  usePresence.setState({ people: {}, sector: null, loading: false })
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __presence: typeof usePresence }).__presence = usePresence
}
