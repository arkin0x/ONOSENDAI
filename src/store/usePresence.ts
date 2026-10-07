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
 * Each author's newest action in the neighborhood says where they are: the
 * position it leaves them at, which for an enter-virtual is where they
 * entered a game from (spec §8.11). Someone
 * who leaves does not announce it here (their next action lands outside the
 * filter), so people not heard from in a while are confirmed by asking the
 * relay for their newest action and dropped if it is elsewhere.
 *
 * A newest action says where someone is only if their chain is valid up to
 * it. An invalid chain stands at its last valid position, frozen until a
 * respawn (arkinox, 2026-10-07), so each person's chain is read after each
 * newest action, one person at a time, through lib/neighborChains.ts, which
 * keeps each chain and asks only for what is newer. Someone whose chain is
 * broken is placed where it froze, or dropped if that is not here. Until a
 * read comes back, the newest action places them, except that someone known
 * to be frozen stays where they froze unless the new action is a spawn. A
 * read is applied only while it is still about the action the person shows
 * (`actionId`), so a slow read never overrides a newer action or a respawn.
 */

import { create } from 'zustand'
import { xyzToSectorId } from 'cyberspace-core'
import type { Filter } from 'nostr-tools/filter'
import { ACTION_KIND, parseAction, type NostrEvent, type ActionType, type ActionEvent } from '../lib/events'
import type { Plane } from 'cyberspace-core'
import { PLACING_ACTIONS } from '../lib/chains'
import { cachedVerdict, forgetNeighborChains, forgetNeighborEvents, readChain, type ChainVerdict } from '../lib/neighborChains'
import { query, subscribe } from '../lib/relay'
import type { Position } from '../lib/space'
import { useCyberspace } from './useCyberspace'
import { useChat } from './useChat'
import { chime } from '../lib/chime'

export interface Person {
  pubkey: string
  position: Position
  plane: Plane
  /** created_at of the action that put them here. */
  lastActive: number
  type: ActionType
  /** When the relay last confirmed this is still their newest action. */
  checkedAt: number
  /** The id of that newest action: what a chain read must still be about to be applied. */
  actionId: string
  /**
   * Their chain is broken: `position` is its last valid position, where they
   * stand until they respawn, whatever their newer actions say (checkChain).
   */
  frozen?: boolean
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
  return { kinds: [ACTION_KIND], '#A': PLACING_ACTIONS, '#X': around(s.sx), '#Y': around(s.sy), '#Z': around(s.sz) }
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
  /** People first seen after the backfill finished: arrivals, not history. */
  arrivals: number
  /** When the last arrival was noticed, ms since the epoch, or null. */
  lastArrivalAt: number | null
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
  arrivals: 0,
  lastArrivalAt: null,

  ingest: (ev, now = Math.floor(Date.now() / 1000)) => {
    const action = parseAction(ev)
    if (!action) return
    // An enter-virtual's sector tags are where it appears inside the game,
    // and its position is where the identity entered from, which it keeps
    // for the whole game (spec §8.11.4 rule 1). A game played here by
    // someone whose position is elsewhere does not put them here.
    if (action.declared && !inNeighborhood(action.position, useCyberspace.getState().position)) return
    const me = useCyberspace.getState().identity.pubkey
    if (action.pubkey === me) return
    const have = get().people[action.pubkey]
    if (have && have.lastActive >= action.createdAt) return
    const at = standing(action, have)
    // One rule for where anyone stands (lib/neighborChains.ts): where their
    // chain puts the action they show, and not here when that is not in the
    // neighborhood. An action placed by itself came through the
    // neighborhood's own filter; a place from a chain read or a freeze is
    // checked here, as applyVerdict and the sweep check theirs.
    if ((at.known || at.frozen) && !inNeighborhood(at.position, useCyberspace.getState().position)) {
      if (have) get().forget(action.pubkey)
      return
    }
    // Someone new, after the backfill: an arrival. During the backfill every
    // person is new and none of them just arrived. Your targets are not
    // arrivals either; you already know where they are.
    const arrived = !have && !get().loading && !useCyberspace.getState().targets[action.pubkey]
    set({
      people: { ...get().people, [action.pubkey]: {
        pubkey: action.pubkey, position: at.position, plane: at.plane,
        lastActive: action.createdAt, type: action.type, checkedAt: now, actionId: action.id, frozen: at.frozen,
      } },
      ...(arrived ? { arrivals: get().arrivals + 1, lastArrivalAt: Date.now() } : {}),
    })
    if (!at.known) queueChainCheck(action.pubkey, action.id)
    // The chat's mute is the one switch for sounds about other people.
    if (arrived && !useChat.getState().muted) chime()
  },

  forget: (pubkey) => {
    const people = { ...get().people }
    delete people[pubkey]
    set({ people })
    forgetNeighborEvents(pubkey)
  },

  others: () => {
    const { identity, targets } = useCyberspace.getState()
    return Object.values(get().people).filter((p) => p.pubkey !== identity.pubkey && !targets[p.pubkey])
  },
}))

let stopLive: (() => void) | null = null
let started = false
let sweepHandle: ReturnType<typeof setInterval> | null = null

/**
 * Where someone stands on their newest action, before or without a chain
 * read: the cached verdict for that action if there is one (`known`); else,
 * for someone known to be frozen, still where they froze unless the action
 * is a spawn, which starts a new chain; else where the action says.
 */
function standing(action: ActionEvent, have: Person | undefined): { position: Position; plane: Plane; frozen: boolean; known: boolean } {
  const v = cachedVerdict(action.pubkey, action.id)
  if (v) return { position: v.stand.position, plane: v.stand.plane, frozen: v.frozen, known: true }
  if (have?.frozen && action.type !== 'spawn') return { position: have.position, plane: have.plane, frozen: true, known: false }
  return { position: action.position, plane: action.plane, frozen: false, known: false }
}

/** Chains waiting to be read: the newest action id each person was last seen at. */
const chainChecks = new Map<string, string>()
let checking = false

/** Read someone's chain after a newest action of theirs that has no verdict yet. */
function queueChainCheck(pubkey: string, actionId: string): void {
  chainChecks.set(pubkey, actionId)
  if (started) void drainChainChecks()
}

/** For tests: the reads waiting, as [pubkey, actionId]. */
export function pendingChainChecks(): Array<[string, string]> {
  return [...chainChecks]
}

/** One chain at a time, so a busy neighborhood does not ask the relays for every chain at once. */
export async function drainChainChecks(): Promise<void> {
  if (checking) return
  checking = true
  try {
    while (chainChecks.size > 0) {
      const [pubkey, actionId] = chainChecks.entries().next().value as [string, string]
      chainChecks.delete(pubkey)
      try {
        const v = await readChain(pubkey, actionId)
        if (v) applyVerdict(pubkey, v)
      } catch { /* the newest action still places them */ }
    }
  } finally {
    checking = false
  }
}

/**
 * Place someone by what their chain said, if it is still about the action
 * they show: where their chain puts that action (frozen or not), and off the
 * neighborhood when that is not here, the same rule ingest and the sweep
 * use. A read for an action they have since moved past, or respawned past,
 * is dropped.
 */
function applyVerdict(pubkey: string, v: ChainVerdict): void {
  const person = usePresence.getState().people[pubkey]
  if (!person || person.actionId !== v.actionId) return
  if (!inNeighborhood(v.stand.position, useCyberspace.getState().position)) { usePresence.getState().forget(pubkey); return }
  usePresence.setState((s) => ({ people: { ...s.people, [pubkey]: { ...s.people[pubkey], position: v.stand.position, plane: v.stand.plane, frozen: v.frozen } } }))
}

/** Read one person's chain now, at the action they show, and place them by it. */
export async function checkChain(pubkey: string): Promise<void> {
  const person = usePresence.getState().people[pubkey]
  if (!person) return
  const v = await readChain(pubkey, person.actionId)
  if (v) applyVerdict(pubkey, v)
}

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
export async function sweep(): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const here = useCyberspace.getState().position
  const quiet = Object.values(usePresence.getState().people).filter((p) => now - p.checkedAt >= CONFIRM_AFTER_S)
  for (const person of quiet) {
    try {
      const newest = (await query({ kinds: [ACTION_KIND], authors: [person.pubkey], '#A': PLACING_ACTIONS, limit: 1 }))
        .sort((a, b) => b.created_at - a.created_at)[0]
      const action = newest ? parseAction(newest) : null
      if (!action) { usePresence.getState().forget(person.pubkey); continue }
      // Frozen on a broken chain: still there until a spawn says otherwise,
      // and the chain is read again at the new action all the same.
      const at = standing(action, person)
      if (!inNeighborhood(at.position, here)) { usePresence.getState().forget(person.pubkey); continue }
      usePresence.setState((s) => ({ people: { ...s.people, [person.pubkey]: {
        ...s.people[person.pubkey], position: at.position, plane: at.plane, lastActive: action.createdAt, type: action.type, checkedAt: now, actionId: action.id, frozen: at.frozen,
      } } }))
      if (!at.known) queueChainCheck(person.pubkey, action.id)
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
  chainChecks.clear()
  forgetNeighborChains()
  usePresence.setState({ people: {}, sector: null, loading: false, arrivals: 0, lastArrivalAt: null })
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __presence: typeof usePresence }).__presence = usePresence
}
