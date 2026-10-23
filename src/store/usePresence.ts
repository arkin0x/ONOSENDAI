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
 * Each author's newest action says where they are: the position it leaves
 * them at, which for an enter-virtual is where they entered a game from
 * (spec §8.11). Someone who leaves does not announce it on the
 * neighborhood's filter: their next action lands outside it. So the people
 * here are also watched by author (watchPeople, one live filter over all of
 * them), which hears a hop, a sidestep or a hyperjump out the moment it is
 * published, and someone whose newest action stands elsewhere is dropped
 * (arkinox, 2026-10-21: "I told XOR to go to a different block location,
 * but his avatar stays in its last local position near me"). A backfill
 * only says what someone last did HERE, not that it is still their newest
 * action, so everyone present after one is confirmed by one read by author
 * (confirmPresent). The sweep still asks about anyone quiet for a while, in
 * case a feed missed something.
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
import { query, queryEach, subscribe } from '../lib/relay'
import type { Position } from '../lib/space'
import { useCyberspace, type SpectateState } from './useCyberspace'
import { useChat } from './useChat'
import { chime } from '../lib/chime'
import { useMutes } from './useMutes'

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

/**
 * Most tag filters a relay accepts in one filter. The cyberspace relay
 * (strfry) refuses a filter with more, answering CLOSED "bad req: too many
 * tags in filter", so a query that asks for four never gets an answer
 * (arkinox, 2026-10-08: presence sat on SCANNING everywhere).
 */
export const MAX_TAG_FILTERS = 3

/**
 * The 27 sectors around a position, as one relay filter. Only the three
 * sector tags go to the relay: the action name is checked on arrival
 * instead (ingest drops anything that is not a recognized action), which
 * loses nothing, since an event without sector tags never matches anyway.
 */
export function neighborhoodFilter(p: Position): Filter {
  const s = xyzToSectorId(p.x, p.y, p.z)
  const around = (v: bigint): string[] => [v - 1n, v, v + 1n].map(String)
  return { kinds: [ACTION_KIND], '#X': around(s.sx), '#Y': around(s.sy), '#Z': around(s.sz) }
}

/** Whether a position's sector is within one of the given sector on every axis. */
export function inNeighborhood(p: Position, of: Position): boolean {
  const a = xyzToSectorId(p.x, p.y, p.z)
  const b = xyzToSectorId(of.x, of.y, of.z)
  const near = (u: bigint, v: bigint): boolean => u >= v - 1n && u <= v + 1n
  return near(a.sx, b.sx) && near(a.sy, b.sy) && near(a.sz, b.sz)
}

/**
 * The people PresenceAvatars draws: everyone here in your plane except the
 * avatars something else already draws. You are scene/Avatar's; a target is
 * TargetAvatars'; and the avatar you spectate is scene/Avatar's too, since
 * spectating draws them in your place (useCyberspace focusPubkey).
 *
 * That last one was missing (arkinox, 2026-10-12: "if I spectate XOR while
 * he's sweeping an area, when his new move lands, his avatar appears at the
 * new coordinate AND the previous coordinate, and the previous coordinate
 * LERPS to the new coordinate"). An untargeted XOR was drawn twice: once by
 * Avatar, gliding from his old place, and once here, from the presence feed,
 * which had already put him at his new one. At rest the two sat on the same
 * cell and looked like one; every move pulled them apart.
 */
export function presenceDrawn(
  people: Record<string, Person>,
  skip: { me: string; focus: string; targets: Record<string, unknown>; plane: Plane; muted?: ReadonlySet<string> },
): Person[] {
  // Nor anyone blocked (store/useMutes): still tracked, so an UNBLOCK draws them at once.
  return Object.values(people).filter((p) =>
    p.pubkey !== skip.me && p.pubkey !== skip.focus && !skip.targets[p.pubkey] && p.plane === skip.plane && !skip.muted?.has(p.pubkey))
}

/**
 * The people last seen here, kept on the device per identity, so a reload
 * draws them at once where they last stood instead of after the relay
 * answers (arkinox, 2026-10-12: "when I refresh the page XOR disappears until
 * it loads. then he's next to me again. his should be cached. shouldn't need
 * to reload every time"). localStorage, as the profile cache is: it is read
 * synchronously when the neighborhood is entered, so the first frame has
 * them. The relay then refreshes them as before; a newer position glides
 * there (lib/avatarLerp.ts), and anyone gone is dropped by the sweep, which
 * runs on the seeded people as soon as the backfill is in.
 */
export const PRESENCE_CACHE_PREFIX = 'onosendai:presence:'
/** Someone the relay has not confirmed for this long is not drawn from the cache. */
export const PRESENCE_CACHE_MAX_AGE_S = 24 * 60 * 60
/** The most people kept per identity, the most recently confirmed first. */
export const PRESENCE_CACHE_KEPT = 200

interface KeptPerson extends Omit<Person, 'position'> { position: { x: string; y: string; z: string } }

/** Keep `people` as `me`'s neighbors; quota and private mode are not errors. */
export function savePresenceCache(me: string, people: Record<string, Person>): void {
  if (!me) return
  const kept: KeptPerson[] = Object.values(people)
    .sort((a, b) => b.checkedAt - a.checkedAt)
    .slice(0, PRESENCE_CACHE_KEPT)
    .map((p) => ({ ...p, position: { x: p.position.x.toString(), y: p.position.y.toString(), z: p.position.z.toString() } }))
  try { localStorage.setItem(PRESENCE_CACHE_PREFIX + me, JSON.stringify(kept)) } catch { /* quota or private mode */ }
}

/**
 * `me`'s kept neighbors who can still be here: confirmed within
 * PRESENCE_CACHE_MAX_AGE_S of `nowS`, inside the 27 sectors around `at`,
 * and not `me`.
 */
export function loadPresenceCache(me: string, at: Position, nowS = Math.floor(Date.now() / 1000)): Record<string, Person> {
  if (!me) return {}
  try {
    const raw = localStorage.getItem(PRESENCE_CACHE_PREFIX + me)
    const list = raw ? (JSON.parse(raw) as KeptPerson[]) : []
    const out: Record<string, Person> = {}
    for (const k of Array.isArray(list) ? list : []) {
      if (!k || typeof k.pubkey !== 'string' || k.pubkey === me || !k.position) continue
      if (!(nowS - k.checkedAt <= PRESENCE_CACHE_MAX_AGE_S)) continue
      const position = { x: BigInt(k.position.x), y: BigInt(k.position.y), z: BigInt(k.position.z) }
      if (!inNeighborhood(position, at)) continue
      out[k.pubkey] = { ...k, position }
    }
    return out
  } catch { return {} }
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
  /**
   * Take an action event in: the newest per author wins. `quiet`: someone
   * first seen this way is not an arrival (a spectated chain's head).
   */
  ingest: (ev: NostrEvent, now?: number, opts?: { quiet?: boolean }) => void
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

  ingest: (ev, now = Math.floor(Date.now() / 1000), opts = {}) => {
    const action = parseAction(ev)
    if (!action) return
    // An enter-virtual's sector tags are where it appears inside the game,
    // and its position is where the identity entered from, which it keeps
    // for the whole game (spec §8.11.4 rule 1). A game played here by
    // someone whose position is elsewhere does not put them here.
    if (action.declared && !inNeighborhood(action.position, useCyberspace.getState().position)) return
    const me = useCyberspace.getState().identity.pubkey
    if (action.pubkey === me) return
    // An action no newer than the one that took them away is not news: a
    // read by author answers newest first, so their hyperjump out comes
    // before the hop they made here, and that hop must not bring them back.
    const gone = departed.get(action.pubkey)
    if (gone !== undefined && gone.createdAt >= action.createdAt) return
    const have = get().people[action.pubkey]
    if (have && have.lastActive >= action.createdAt) return
    const at = standing(action, have)
    // One rule for where anyone stands (lib/neighborChains.ts): where their
    // chain puts the action they show, and not here when that is not in the
    // neighborhood. Checked for every action, whatever feed brought it: the
    // watch on the people here (watchPeople), the confirmation after a
    // backfill and a spectated chain all carry actions that land elsewhere,
    // and such an action is how someone leaves (arkinox, 2026-10-21: XOR
    // hyperjumped away and stayed drawn where he boarded).
    if (!inNeighborhood(at.position, useCyberspace.getState().position)) {
      // Their chain says so: they have gone.
      if (at.known) { leave(action.pubkey, action.createdAt, at.position); return }
      // Not read there yet. A chain that broke before this action stands
      // frozen where it broke, which may be here, so the read decides
      // (applyVerdict): they stay where they are, showing this action,
      // until it says they left or froze. Someone not here is not added.
      // `checkedAt` stays as it was: should the read fail, the sweep still
      // settles them when it is due, not ten minutes from now.
      if (!have) return
      set({ people: { ...get().people, [action.pubkey]: {
        ...have, lastActive: action.createdAt, type: action.type, actionId: action.id,
      } } })
      queueChainCheck(action.pubkey, action.id, true)
      return
    }
    // Someone new, after the backfill: an arrival. During the backfill every
    // person is new and none of them just arrived. Your targets are not
    // arrivals either; you already know where they are.
    // Nor is anyone blocked: no count, no chime (store/useMutes).
    const arrived = !have && !opts.quiet && !get().loading && !useCyberspace.getState().targets[action.pubkey] && !useMutes.getState().muted.pubkeys.has(action.pubkey)
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
    const blocked = useMutes.getState().muted.pubkeys
    return Object.values(get().people).filter((p) => p.pubkey !== identity.pubkey && !targets[p.pubkey] && !blocked.has(p.pubkey))
  },
}))

let stopLive: (() => void) | null = null
let started = false
/** Bumped when presence stops, so a read still in flight is not applied to what comes after. */
let generation = 0
let sweepHandle: ReturnType<typeof setInterval> | null = null

/** Most departures remembered, the most recent kept. */
export const DEPARTED_KEPT = 500
/**
 * Per pubkey, the newest action known to stand outside the neighborhood:
 * when, and where it stands. Entering another neighborhood forgets those
 * whose place is inside it, since that same action may put them beside you.
 */
const departed = new Map<string, { createdAt: number; position: Position }>()

/**
 * `pubkey`'s action of `createdAt` stands at `position`, outside the
 * neighborhood: drop them, and remember it, so none of their older actions
 * puts them back.
 */
function leave(pubkey: string, createdAt: number, position: Position): void {
  const was = departed.get(pubkey)
  departed.delete(pubkey)
  departed.set(pubkey, was && was.createdAt > createdAt ? was : { createdAt, position })
  while (departed.size > DEPARTED_KEPT) departed.delete(departed.keys().next().value as string)
  if (usePresence.getState().people[pubkey]) usePresence.getState().forget(pubkey)
}

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
/** Of those, the people whose action lands elsewhere: read first, since they may have left. */
const urgentChecks = new Set<string>()
let checking = false

/**
 * Read someone's chain after a newest action of theirs that has no verdict
 * yet. `urgent`: the action lands outside the neighborhood, so the read
 * says whether they are still drawn here at all, and it goes ahead of the
 * reads a backfill queued.
 */
function queueChainCheck(pubkey: string, actionId: string, urgent = false): void {
  chainChecks.set(pubkey, actionId)
  if (urgent) urgentChecks.add(pubkey)
  else urgentChecks.delete(pubkey)
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
      const first = urgentChecks.values().next()
      const pubkey = first.done ? (chainChecks.keys().next().value as string) : first.value
      const actionId = chainChecks.get(pubkey)
      chainChecks.delete(pubkey)
      urgentChecks.delete(pubkey)
      if (actionId === undefined) continue
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
  if (!inNeighborhood(v.stand.position, useCyberspace.getState().position)) { leave(pubkey, person.lastActive, v.stand.position); return }
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
  for (const [pk, d] of departed) if (inNeighborhood(d.position, at)) departed.delete(pk)
  // Seeded from the device, so the people last seen here are drawn before
  // the relay answers; the backfill and the live feed refresh them.
  const seeded = loadPresenceCache(useCyberspace.getState().identity.pubkey, at)
  usePresence.setState({ sector: key, people: seeded, loading: true })
  // The watch on them starts now, not when the set of people next changes:
  // after a reload that finds the same people, it never would.
  watchPeople()
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
  // Everyone here now came from the device or from the backfill, and
  // neither says their action is still their newest: someone who left
  // since would be drawn where they last stood until the sweep reached
  // them, minutes later, on every reload (arkinox, 2026-10-21).
  if (usePresence.getState().sector === key) await confirmPresent()
}

/** Most events the confirmation after a backfill asks for. */
export const CONFIRM_LIMIT = 200

/**
 * The people here by author, from `since` on: each one's own placing
 * actions, wherever they land. One tag filter (`#A`), so the relay takes it
 * (MAX_TAG_FILTERS).
 */
export function peopleFilter(pubkeys: string[], since: number): Filter {
  return { kinds: [ACTION_KIND], authors: pubkeys, '#A': PLACING_ACTIONS, since }
}

/** Most people the watch and the confirmation name in one filter, the most recently active first. */
export const WATCH_MAX = 200

/** Who the watch covers: everyone here but you, the most recently active first, at most WATCH_MAX, sorted. */
export function watchedPubkeys(people: Record<string, Person>, me: string): string[] {
  return Object.values(people)
    .filter((p) => p.pubkey !== me)
    .sort((a, b) => b.lastActive - a.lastActive)
    .slice(0, WATCH_MAX)
    .map((p) => p.pubkey)
    .sort()
}

/** Most batched reads one confirmation makes before asking about the rest one at a time. */
export const CONFIRM_PAGES = 4

/**
 * Confirm everyone here by author, in batched reads: their placing actions
 * since the oldest newest action among them, newest first, up to
 * CONFIRM_LIMIT. A read that came back whole speaks for everyone it asked
 * about. One cut at the limit speaks only for the people it names (it holds
 * each one's newest action), so the people it did not name are asked again
 * in a read of their own, up to CONFIRM_PAGES reads; one busy neighbor
 * filling the limit costs one more read, not one per person. Whoever is
 * still unconfirmed after that is asked about alone, as the sweep asks.
 * Every newer action is then taken in, newest first across the relays, so
 * someone who moved within the neighborhood moves and someone who left is
 * dropped (ingest). With no relay answering, nobody is dropped and the
 * sweep asks again later.
 */
export async function confirmPresent(): Promise<void> {
  const gen = generation
  const me = useCyberspace.getState().identity.pubkey
  let remaining = watchedPubkeys(usePresence.getState().people, me)
  const events: NostrEvent[] = []
  const covered: string[] = []
  for (let page = 0; page < CONFIRM_PAGES && remaining.length > 0; page++) {
    const people = usePresence.getState().people
    remaining = remaining.filter((pk) => people[pk])
    if (remaining.length === 0) break
    let since = Infinity
    for (const pk of remaining) since = Math.min(since, people[pk].lastActive)
    let answers
    try {
      answers = await queryEach({ ...peopleFilter(remaining, since), limit: CONFIRM_LIMIT })
    } catch {
      break
    }
    if (gen !== generation) return
    const answered = answers.filter((a) => a.outcome === 'answered')
    if (answered.length === 0) break
    for (const a of answered) events.push(...a.events)
    // A relay that answered with fewer than the limit gave every one of
    // their actions since `since`: whoever it did not name has done nothing
    // since.
    if (answered.some((a) => a.events.length < CONFIRM_LIMIT)) { covered.push(...remaining); remaining = []; break }
    const named = new Set(answered.flatMap((a) => a.events.map((e) => e.pubkey)))
    covered.push(...remaining.filter((pk) => named.has(pk)))
    remaining = remaining.filter((pk) => !named.has(pk))
  }
  if (gen !== generation) return
  const now = Math.floor(Date.now() / 1000)
  // Newest first across every relay: one relay missing someone's newest
  // action must not have its older one taken first.
  const seen = new Set<string>()
  const ordered = events.filter((e) => !seen.has(e.id) && seen.add(e.id)).sort((a, b) => b.created_at - a.created_at)
  for (const ev of ordered) usePresence.getState().ingest(ev, now)
  // Confirmed unchanged is confirmed: the sweep need not ask about them.
  usePresence.setState((st) => {
    const people = { ...st.people }
    for (const pk of covered) if (people[pk]) people[pk] = { ...people[pk], checkedAt: now }
    return { people }
  })
  const left = remaining.map((pk) => usePresence.getState().people[pk]).filter((p): p is Person => !!p)
  if (left.length > 0) await confirmEach(left)
}

/**
 * Confirm the quiet ones. A person's newest action in the neighborhood is
 * where they are only until they act somewhere else, and that action never
 * arrives on the neighborhood's filter; the watch by author hears it, and
 * this is for anything a feed missed. Ask the relay for their newest action
 * of any kind; keep them if it is still in the neighborhood, at its
 * position, or drop them.
 */
export async function sweep(): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await confirmEach(Object.values(usePresence.getState().people).filter((p) => now - p.checkedAt >= CONFIRM_AFTER_S))
}

/** Ask about each of `persons` alone, by their newest placing action. */
async function confirmEach(persons: Person[]): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const here = useCyberspace.getState().position
  for (const person of persons) {
    try {
      // Only an answer can say someone has gone (arkinox, 2026-10-12: XOR
      // vanished after the app came back from the background and returned
      // only while spectated). Right after a resume the sockets are still
      // reconnecting, and query() hands back an empty list for "nobody
      // answered", which read as "no actions" and dropped him; idle, he
      // never came back. With no relay answering, he is kept for the next sweep.
      const answers = await queryEach({ kinds: [ACTION_KIND], authors: [person.pubkey], '#A': PLACING_ACTIONS, limit: 1 })
      if (!answers.some((a) => a.outcome === 'answered')) continue
      const newest = answers.flatMap((a) => a.events).sort((a, b) => b.created_at - a.created_at)[0]
      const action = newest ? parseAction(newest) : null
      if (!action) { usePresence.getState().forget(person.pubkey); continue }
      // Frozen on a broken chain: still there until a spawn says otherwise,
      // and the chain is read again at the new action all the same.
      const at = standing(action, person)
      if (!inNeighborhood(at.position, here)) { leave(person.pubkey, action.createdAt, at.position); continue }
      usePresence.setState((s) => ({ people: { ...s.people, [person.pubkey]: {
        ...s.people[person.pubkey], position: at.position, plane: at.plane, lastActive: action.createdAt, type: action.type, checkedAt: now, actionId: action.id, frozen: at.frozen,
      } } }))
      if (!at.known) queueChainCheck(person.pubkey, action.id)
    } catch {
      /* ask again next sweep */
    }
  }
}

/** How long after the set of people changes the watch on them is reissued. */
export const WATCH_AFTER_MS = 250
/** Seconds back a reissued watch starts from, so nothing falls between the old one and the new. */
const WATCH_OVERLAP_S = 60
/** The watch on the people here: its closer, and the pubkeys it names, joined. */
let watch: { close: () => void; key: string } | null = null
let watchHandle: ReturnType<typeof setTimeout> | null = null

/**
 * Watch the people here by author, one live filter over all of them
 * (peopleFilter), so whatever they do next arrives wherever it lands: a
 * move within the neighborhood moves them, one out of it drops them
 * (ingest). Reissued only when the set of people changes, the new one
 * opened before the old one closes.
 */
function watchPeople(): void {
  const pubkeys = watchedPubkeys(usePresence.getState().people, useCyberspace.getState().identity.pubkey)
  const key = pubkeys.join(',')
  if (key === (watch?.key ?? '')) return
  const old = watch
  watch = null
  if (pubkeys.length > 0) {
    const since = Math.floor(Date.now() / 1000) - WATCH_OVERLAP_S
    const close = subscribe(peopleFilter(pubkeys, since), (ev) => {
      if (watch?.key !== key) return
      usePresence.getState().ingest(ev)
    })
    watch = { close, key }
  }
  old?.close()
}

/**
 * The newest action of the avatar you spectate, taken in as presence's own.
 * Spectating reads their chain by author, so it knows where they are even
 * when they left the neighborhood before the watch began; ending the
 * spectation must not draw them back where presence last saw them
 * (arkinox, 2026-10-21).
 */
function takeSpectated(sp: SpectateState): void {
  const head = sp.actions[sp.actions.length - 1]
  const ev = head ? sp.events.find((e) => e.id === head.id) : undefined
  if (ev) usePresence.getState().ingest(ev, undefined, { quiet: true })
}

let stopFollowing: (() => void) | null = null

/** Idempotent. Follows your avatar from sector to sector for the life of the page. */
export function startPresence(): void {
  if (started) return
  started = true
  stopFollowing = useCyberspace.subscribe((s, prev) => {
    if (s.position !== prev.position) void enter(s.position)
    if (s.spectate && s.spectate.actions !== prev.spectate?.actions) takeSpectated(s.spectate)
  })
  sweepHandle = setInterval(() => { void sweep() }, SWEEP_EVERY_MS)
  // Kept on the device a moment after each change, not on every ingest.
  stopSaving = usePresence.subscribe((st, prev) => {
    if (st.people === prev.people) return
    if (watchHandle === null) {
      watchHandle = setTimeout(() => { watchHandle = null; watchPeople() }, WATCH_AFTER_MS)
    }
    if (saveHandle !== null) return
    saveHandle = setTimeout(() => {
      saveHandle = null
      savePresenceCache(useCyberspace.getState().identity.pubkey, usePresence.getState().people)
    }, SAVE_AFTER_MS)
  })
  // Entered last, so every change it makes is heard by the listeners above.
  void enter(useCyberspace.getState().position)
}

/** How long after a change the neighbors are written to the device. */
const SAVE_AFTER_MS = 1000
let saveHandle: ReturnType<typeof setTimeout> | null = null
let stopSaving: (() => void) | null = null

/** For tests: forget everything and stop listening. */
export function stopPresence(): void {
  stopLive?.()
  stopLive = null
  if (sweepHandle) { clearInterval(sweepHandle); sweepHandle = null }
  stopSaving?.()
  stopSaving = null
  stopFollowing?.()
  stopFollowing = null
  if (saveHandle) { clearTimeout(saveHandle); saveHandle = null }
  if (watchHandle) { clearTimeout(watchHandle); watchHandle = null }
  watch?.close()
  watch = null
  started = false
  generation++
  chainChecks.clear()
  urgentChecks.clear()
  departed.clear()
  forgetNeighborChains()
  usePresence.setState({ people: {}, sector: null, loading: false, arrivals: 0, lastArrivalAt: null })
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __presence: typeof usePresence }).__presence = usePresence
}
