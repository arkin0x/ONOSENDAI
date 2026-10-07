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
 */

import { fetchChainEvents, mergeEvents } from './chains'
import { actionLink, buildChain, chainHead, firstBreak, newestSpawn, type ActionEvent, type NostrEvent, type Placed } from './events'

export interface ChainVerdict {
  /** The newest action the chain was read at. */
  actionId: string
  /** The spawn the chain starts from. */
  spawnId: string
  /** Where the identity stands: the chain's last valid position when it is broken, its head's position otherwise. */
  stand: Placed
  /** The chain is broken, and `stand` is where it froze. */
  frozen: boolean
}

/** Each person's chain events, as far as they have been read. */
const held = new Map<string, NostrEvent[]>()
/** Each person's last verdict. */
const verdicts = new Map<string, ChainVerdict>()

/** The verdict for `pubkey` at exactly this newest action, or null when the chain has not been read there. */
export function cachedVerdict(pubkey: string, actionId: string): ChainVerdict | null {
  const v = verdicts.get(pubkey)
  return v && v.actionId === actionId ? v : null
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
  const mine = spawnId ? chainOf(have, spawnId) : []
  const since = mine.length > 0 ? Math.max(...mine.map((e) => e.created_at)) : undefined
  const got = await fetchChainEvents(pubkey, spawnId, have, since)
  let events = mergeEvents(have, got)
  const now = newestSpawn(events, pubkey)
  // A new newest spawn: the old chain is history, and what is kept is the
  // new one's, read whole by the fetch above.
  if (now && now.id !== spawnId) events = [...chainOf(events, now.id), ...events.filter((e) => e.id !== now.id && actionLink(e) === null)]
  held.set(pubkey, events)
  const chain = buildChain(events, pubkey)
  if (!chain.some((a) => a.id === actionId)) return null
  const head = chainHead(chain)!
  const v: ChainVerdict = {
    actionId,
    spawnId: chain[0].id,
    stand: { coordHex: head.coordHex, position: head.position, plane: head.plane, sector: head.sector },
    frozen: firstBreak(chain) !== null,
  }
  verdicts.set(pubkey, v)
  return v
}

/**
 * Someone's newest action as the place they stand: where their chain froze
 * when the cached verdict for that action says it is broken, the action as
 * it is otherwise. Never asks the relays.
 */
export function standingOf(a: ActionEvent): ActionEvent {
  const v = cachedVerdict(a.pubkey, a.id)
  return v?.frozen ? { ...a, ...v.stand } : a
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
