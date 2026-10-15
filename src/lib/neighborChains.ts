/**
 * neighborChains.ts - other people's chains, read once and kept, so the
 * client knows where each one really stands.
 *
 * A newest action says where someone is only if their chain is valid up to
 * it. An invalid chain stands at its last valid position, frozen until a
 * respawn (arkinox, 2026-10-07, Q3), so presence (store/usePresence.ts) and
 * the recent-avatars list (hooks/useRecentAvatars.ts) read a person's chain
 * and keep what it said, the verdict, for the newest action it was read at.
 *
 * Three things the review of #227 asked of this, each here:
 *
 * - The chain's events are kept per person, and a later read asks only for
 *   what is newer than the newest one held (chains.ts fetchChainEvents with
 *   `knownSpawnId`, `have` and `since`). Only a new newest spawn reads a
 *   chain whole again, and then the old chain's events are let go.
 * - The verdict is cached by person and newest action id, so someone met
 *   again after crossing a sector is placed at once, frozen or not, without
 *   asking the relays again.
 * - A verdict is for one newest action: one read for an action the person
 *   has since moved past (or respawned past) is never applied (usePresence
 *   checks `actionId`), and a read whose chain does not hold the action at
 *   all says nothing.
 *
 * And from its final review:
 *
 * - Both caches hold the NEIGHBORS_KEPT people seen most recently; the
 *   least recently seen is let go first, and presence drops a person's
 *   chain when it forgets them.
 * - A later read asks from SINCE_MARGIN_S before the newest event held, so
 *   an event of an older second that arrives late (a fork, a relay that was
 *   behind) is still asked for, the overlap deduplicated by id; an event
 *   dated in the future (beyond FUTURE_SKEW_S) never sets that point, so
 *   one bad clock cannot stop every later read from seeing anything.
 * - One placement rule: a person stands where their chain puts the action
 *   they show, which is its own place on a valid stretch and the frozen
 *   place from the first break on (`stand`), and is off the neighborhood
 *   when that place is.
 */

import { fetchChainEvents, mergeEvents } from './chains'
import { actionLink, buildChain, firstBreak, newestSpawn, type ActionEvent, type NostrEvent, type Placed } from './events'

export interface ChainVerdict {
  /** The newest action the chain was read at. */
  actionId: string
  /** The spawn the chain starts from. */
  spawnId: string
  /** Where the chain puts that action: its own place on a valid stretch, the chain's last valid position from the first break on. */
  stand: Placed
  /** The action is at or after the chain's first break, and `stand` is where it froze. */
  frozen: boolean
}

/** How many people's chains and verdicts are kept: the most recently seen. */
export const NEIGHBORS_KEPT = 200
/** How far before the newest event held a later read asks from, so a late older-second event is still found. */
export const SINCE_MARGIN_S = 10 * 60
/** How far ahead of this clock an event may be dated and still set where a later read asks from. */
export const FUTURE_SKEW_S = 5 * 60

/** Each person's chain events, as far as they have been read, least recently seen first. */
const held = new Map<string, NostrEvent[]>()
/** Each person's last verdict, least recently seen first. */
const verdicts = new Map<string, ChainVerdict>()

/** Put `value` at the most recent end of `map` and let the least recently seen go past the cap. */
function keep<V>(map: Map<string, V>, pubkey: string, value: V): void {
  map.delete(pubkey)
  map.set(pubkey, value)
  while (map.size > NEIGHBORS_KEPT) map.delete(map.keys().next().value as string)
}

/** The verdict for `pubkey` at exactly this newest action, or null when the chain has not been read there. Seeing it counts as seeing them. */
export function cachedVerdict(pubkey: string, actionId: string): ChainVerdict | null {
  const v = verdicts.get(pubkey)
  if (!v || v.actionId !== actionId) return null
  keep(verdicts, pubkey, v)
  const events = held.get(pubkey)
  if (events) keep(held, pubkey, events)
  return v
}

/**
 * The second a later read of `events` asks from: SINCE_MARGIN_S before the
 * newest one dated no later than now plus FUTURE_SKEW_S, or undefined when
 * there is none. A loop rather than Math.max over a spread, which overflows
 * the stack on a long chain.
 */
export function sinceFor(events: NostrEvent[], now: number = Math.floor(Date.now() / 1000)): number | undefined {
  let newest: number | undefined
  for (const e of events) {
    if (e.created_at > now + FUTURE_SKEW_S) continue
    if (newest === undefined || e.created_at > newest) newest = e.created_at
  }
  return newest === undefined ? undefined : Math.max(0, newest - SINCE_MARGIN_S)
}

/** The events of `spawnId`'s chain in `events`: the spawn and everything naming it as genesis. */
function chainOf(events: NostrEvent[], spawnId: string): NostrEvent[] {
  return events.filter((e) => e.id === spawnId || actionLink(e)?.genesisId === spawnId)
}

/**
 * Read `pubkey`'s chain as of their newest action `actionId`: only what is
 * newer than what is held, unless the newest spawn changed. Resolves to the
 * verdict, also cached, or null when the chain the relays hold does not
 * contain that action (not arrived yet, or on a chain since replaced).
 */
export async function readChain(pubkey: string, actionId: string): Promise<ChainVerdict | null> {
  const have = held.get(pubkey) ?? []
  const spawnId = newestSpawn(have, pubkey)?.id
  const since = spawnId ? sinceFor(chainOf(have, spawnId)) : undefined
  const got = await fetchChainEvents(pubkey, spawnId, have, since)
  let events = mergeEvents(have, got)
  const now = newestSpawn(events, pubkey)
  // A new newest spawn: the old chain is history, and what is kept is the
  // new one's, read whole by the fetch above.
  if (now && now.id !== spawnId) events = [...chainOf(events, now.id), ...events.filter((e) => e.id !== now.id && actionLink(e) === null)]
  keep(held, pubkey, events)
  const chain = buildChain(events, pubkey)
  const at = chain.findIndex((a) => a.id === actionId)
  if (at < 0) return null
  const shown = chain[at]
  const broken = firstBreak(chain)
  const v: ChainVerdict = {
    actionId,
    spawnId: chain[0].id,
    stand: { coordHex: shown.coordHex, position: shown.position, plane: shown.plane, sector: shown.sector },
    frozen: broken !== null && at >= broken.index,
  }
  keep(verdicts, pubkey, v)
  return v
}

/**
 * Someone's newest action as the place they stand: where their chain froze
 * when the cached verdict for that action says it is broken, the action as
 * it is otherwise. Never asks the relays.
 */
export function standingOf(a: ActionEvent): ActionEvent {
  const v = cachedVerdict(a.pubkey, a.id)
  return v ? { ...a, ...v.stand } : a
}

/** Let one person's chain events go (presence forgot them); their verdict stays, so meeting them again is instant. */
export function forgetNeighborEvents(pubkey: string): void {
  held.delete(pubkey)
}

/** For tests: how many people's chains and verdicts are kept. */
export function neighborCacheSizes(): { held: number; verdicts: number } {
  return { held: held.size, verdicts: verdicts.size }
}

/** Forget every chain and verdict (tests, and presence stopping). */
export function forgetNeighborChains(): void {
  held.clear()
  verdicts.clear()
}

/** For tests: the events held for one person. */
export function heldChain(pubkey: string): NostrEvent[] {
  return held.get(pubkey) ?? []
}
