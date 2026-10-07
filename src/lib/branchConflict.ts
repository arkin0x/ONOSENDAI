/**
 * branchConflict.ts - this device's unpublished moves against moves another
 * device already published, from the same point of the same chain.
 *
 * The sharpest multi-device case (arkinox, 2026-10-01). Device B is LOCAL or
 * offline and keeps moving on its chain; device A, signed in as the same
 * identity, keeps publishing from the same chain. When B goes LIVE or comes
 * back online, B's unpublished moves and A's published ones both name the
 * same earlier action as their `previous`: the chain has forked. Every reader
 * resolves a fork the same way (events.ts buildChain, and cyberspace spec PR
 * #42): the newest spawn, then at each fork the OLDER child by created_at
 * continues the chain, a tie going to the smaller event id. The rule itself
 * is not changed here.
 *
 * What changes is that B no longer publishes into that fork blindly. If B's
 * first divergent move is the older one, publishing it wins the fork for
 * every reader the moment it lands, and the moves A already published stop
 * being in the chain. If it is the newer one, publishing it changes nothing
 * for anyone: it would sit on the relays as a branch no reader follows. Either
 * way the person decides, with both branches in front of them.
 *
 * Pure: the store and the prompt call these, and the tests call them
 * directly.
 */

import { actionLink, buildChain, type ActionEvent, type NostrEvent } from './events'

/** Two versions of the chain from one fork point, waiting for a choice. */
export interface BranchConflict {
  kind: 'branch'
  /** The last action both versions share: the `previous` of both first divergent moves. */
  forkId: string
  /** Everything the relays sent for this identity, merged by id. */
  relayEvents: NostrEvent[]
  at: number
}

export interface Divergence {
  forkId: string
  /** Position of the fork point in the local chain (0 is the spawn). */
  forkIndex: number
  /** This device's actions after the fork, oldest first. All unpublished. */
  local: ActionEvent[]
  /** The relays' actions after the fork, as the fork rule reads them, oldest first. */
  relay: ActionEvent[]
  /**
   * Publishing the local branch would win the fork for every reader: its
   * first action is older than the relays' first action at the fork (or the
   * same second with the smaller id), so the relays' branch would stop being
   * in the chain.
   */
  overrides: boolean
}

/** The fork rule's order between two children of one action: true when `a` continues the chain over `b`. */
export function continuesOver(a: { createdAt: number; id: string }, b: { createdAt: number; id: string }): boolean {
  return a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id)
}

/**
 * Where this device's unpublished moves fork against moves the relays hold,
 * or null when they do not.
 *
 * A fork needs all of: a relay action of the same chain (same genesis) that
 * this device does not have, naming an action of the local chain as its
 * `previous`, where the local chain's own next action from that point is one
 * this device has not published. A relay action that extends the local head
 * is not a fork, and a fork between two published actions is not this case
 * (both are on the relays already, and every reader has resolved it).
 * The earliest such fork is the one reported. "Relay action" means any
 * event on the chain, whatever its action is called: a game client's
 * enter-virtual, or an action this client does not recognize, forks the
 * chain exactly as a hop does (spec §8.9 rule 1).
 */
export function findDivergence(
  localEvents: NostrEvent[],
  published: Record<string, string | undefined>,
  relayEvents: NostrEvent[],
): Divergence | null {
  const chain = buildChain(localEvents)
  if (chain.length === 0) return null
  const genesis = chain[0].id
  const index = new Map(chain.map((a, i) => [a.id, i]))
  const localIds = new Set(localEvents.map((e) => e.id))
  let forkIndex = -1
  for (const ev of relayEvents) {
    if (localIds.has(ev.id)) continue
    const a = actionLink(ev)
    if (!a || a.genesisId !== genesis) continue
    const at = index.get(a.previousId)
    if (at === undefined || at >= chain.length - 1) continue
    const ours = chain[at + 1]
    if (published[ours.id] === 'ok') continue
    if (forkIndex === -1 || at < forkIndex) forkIndex = at
  }
  if (forkIndex === -1) return null
  const fork = chain[forkIndex]
  // The relays' version: everything up to the fork, then what the relays sent.
  const sharedEvents = localEvents.filter((e) => {
    const i = index.get(e.id)
    return i !== undefined && i <= forkIndex
  })
  const relayVersion = buildChain([...sharedEvents, ...relayEvents.filter((e) => !localIds.has(e.id) || index.get(e.id)! <= forkIndex)])
  const relay = relayVersion[0]?.id === genesis ? relayVersion.slice(forkIndex + 1) : []
  const local = chain.slice(forkIndex + 1)
  if (relay.length === 0 || local.length === 0) return null
  return { forkId: fork.id, forkIndex, local, relay, overrides: continuesOver(local[0], relay[0]) }
}

/**
 * The conflict after more relay events arrive: started when a divergence is
 * found, grown while one is pending, unchanged when nothing new came. Null
 * when there is nothing to choose between.
 */
export function foldBranchConflict(
  prev: BranchConflict | null,
  incoming: NostrEvent[],
  localEvents: NostrEvent[],
  published: Record<string, string | undefined>,
  now: number,
): BranchConflict | null {
  const byId = new Map((prev?.relayEvents ?? []).map((e) => [e.id, e]))
  let added = 0
  for (const e of incoming) {
    if (byId.has(e.id)) continue
    byId.set(e.id, e)
    added++
  }
  if (prev && added === 0) return prev
  const relayEvents = [...byId.values()]
  const div = findDivergence(localEvents, published, relayEvents)
  if (!div) return prev
  return { kind: 'branch', forkId: div.forkId, relayEvents, at: prev?.at ?? now }
}

/**
 * The chain once "Keep the relay's version" is chosen: the shared part, then
 * the relays' branch. This device's unpublished moves after the fork are
 * gone. Returned as raw events in chain order, with the ids that are on the
 * relays.
 */
export function relayVersion(localEvents: NostrEvent[], relayEvents: NostrEvent[], div: Divergence): { events: NostrEvent[]; onRelay: Set<string> } {
  const keep = new Set(buildChain(localEvents).slice(0, div.forkIndex + 1).map((a) => a.id))
  const pool = [...localEvents.filter((e) => keep.has(e.id)), ...relayEvents]
  const byId = new Map(pool.map((e) => [e.id, e]))
  const events = buildChain(pool).map((a) => byId.get(a.id)).filter((e): e is NostrEvent => !!e)
  return { events, onRelay: new Set(relayEvents.map((e) => e.id)) }
}

/** One side of a fork, as the prompt shows it. */
export interface BranchSummary {
  /** Actions after the fork point. */
  count: number
  /** created_at of its first and last action, seconds. */
  firstAt: number
  lastAt: number
  /** Where its last action puts you. */
  position: ActionEvent['position']
  plane: ActionEvent['plane']
  coordHex: string
}

export function summarizeBranch(actions: ActionEvent[]): BranchSummary | null {
  if (actions.length === 0) return null
  const last = actions[actions.length - 1]
  return { count: actions.length, firstAt: actions[0].createdAt, lastAt: last.createdAt, position: last.position, plane: last.plane, coordHex: last.coordHex }
}
