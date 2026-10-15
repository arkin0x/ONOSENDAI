/**
 * chainHold.ts - whether this identity already has a chain, and what to do
 * with a chain started before anyone could say.
 *
 * Switching identity never signs a spawn, and neither does loading the page
 * (arkinox, 2026-10-01). An identity with nothing saved here sits at its own
 * spawn coordinate, unsigned, until its first move. That first move needs one
 * fact: does the identity already have a chain on the relays? If it does, the
 * move continues it. If it does not, the move signs a spawn and starts one. If
 * nobody can say (offline, the relays did not answer, the relay refused), the
 * move still signs a spawn, because an unreachable relay must never stop
 * anyone moving, but the new chain is HELD: kept on this device whatever the
 * LIVE switch says, until the relays answer. A held chain that turns out to be
 * the only one is released silently; one that meets a chain on the relays
 * puts the choice to the person, never to "newest spawn wins".
 *
 * The self-check answers the question, per relay outcome (relayOutcome.ts):
 *
 * | Relays said | Verdict |
 * |---|---|
 * | the chain came back with a hole no question could fill | unknown: unreachable, only part of the chain |
 * | any relay returned events that make a chain | found |
 * | the canonical relay answered (a real EOSE) and no relay returned a chain | none |
 * | anything else, with navigator.onLine false | unknown: offline |
 * | the canonical relay refused | unknown: refused, with its reason |
 * | the canonical relay did not answer | unknown: unreachable |
 *
 * Only the canonical relay (useRelays DEFAULT_RELAY, always in the set)
 * can say "none", because it is where every chain is published; a private
 * relay that answers "nothing" only knows about itself.
 *
 * Pure, so every row above is a test.
 */

import { normalizeURL } from 'nostr-tools/utils'
import { sectorTag, xyzToSectorId, type Plane } from 'cyberspace-core'
import { buildChain, type NostrEvent } from './events'
import type { Position } from './space'
import { PARTIAL_CHAIN_REASON, mergeAnswers, type RelayAnswer } from './relayOutcome'

/** Why the relays could not say whether this identity has a chain. */
export type CheckCause =
  | { kind: 'offline' }
  | { kind: 'unreachable'; reason: string }
  | { kind: 'refused'; url: string; reason: string }

export type CheckVerdict =
  | { status: 'found'; events: NostrEvent[] }
  | { status: 'none' }
  | { status: 'unknown'; cause: CheckCause }

/** The self-check for one identity, as the store keeps it. Reset on every switch. */
export type SelfCheck =
  | { pubkey: string; status: 'checking' }
  | { pubkey: string; status: 'found' }
  | { pubkey: string; status: 'none' }
  | { pubkey: string; status: 'unknown'; cause: CheckCause }

/** The table in the header, as a function. */
export function decideSelfCheck(answers: RelayAnswer[], canonical: string, online: boolean): CheckVerdict {
  const events = mergeAnswers(answers)
  // A chain with a hole resolves to the stretch before the hole, which is
  // not its head: continuing it would fork from an earlier point. Nobody
  // could say what the chain is, so the first move holds.
  if (answers.some((a) => a.outcome === 'unreachable' && a.reason === PARTIAL_CHAIN_REASON)) {
    return { status: 'unknown', cause: { kind: 'unreachable', reason: PARTIAL_CHAIN_REASON } }
  }
  // Events that build no chain (hops whose spawn the relay does not have)
  // are not a chain anyone can follow or continue, so they do not count as
  // one; the verdict falls to what the canonical relay said.
  if (events.length > 0 && buildChain(events).length > 0) return { status: 'found', events }
  const home = normalizeURL(canonical)
  const answer = answers.find((a) => normalizeURL(a.url) === home)
  if (answer?.outcome === 'answered') return { status: 'none' }
  if (!online) return { status: 'unknown', cause: { kind: 'offline' } }
  if (answer?.outcome === 'refused') return { status: 'unknown', cause: { kind: 'refused', url: answer.url, reason: answer.reason } }
  return { status: 'unknown', cause: { kind: 'unreachable', reason: answer?.outcome === 'unreachable' ? answer.reason : 'not asked' } }
}

/**
 * What a provisional identity's first move does, once the check has said what
 * it can (or the short wait for it ran out, which is `checking` here).
 *
 * | Check | Placed by the relay chain meanwhile | First move |
 * |---|---|---|
 * | any | yes | `adopted`: nothing is signed; re-aim from the relay head |
 * | none | no | `spawn`: a normal new chain, published per LIVE |
 * | found, unknown, checking | no | `spawn-held`: a new chain, held on this device |
 *
 * `found` without a placement is a relay chain that arrived in the instant
 * between the check and this decision; holding is the side that cannot
 * publish a rival spawn.
 */
export function firstMove(status: SelfCheck['status'], placed: boolean): 'adopted' | 'spawn' | 'spawn-held' {
  if (placed) return 'adopted'
  return status === 'none' ? 'spawn' : 'spawn-held'
}

/** A relay's refusal in words a person can act on. */
export function refusalText(reason: string): string {
  if (/^auth-required:/i.test(reason)) return 'it wants your signer to log in'
  if (/^rate-limited:/i.test(reason)) return 'too many requests, try again shortly'
  return reason
}

/** Why a chain is held, as a short clause: "relays did not answer". */
export function holdReason(check: SelfCheck | null): string {
  if (!check || check.status === 'checking') return 'checking the relays'
  if (check.status !== 'unknown') return 'waiting for the relays'
  switch (check.cause.kind) {
    case 'offline': return 'offline'
    case 'unreachable': return 'relays did not answer'
    case 'refused': return `the relay refused: ${refusalText(check.cause.reason)}`
  }
}

/** What the chain status is decided from. */
export interface StatusFacts {
  live: boolean
  held: boolean
  /**
   * A choice is waiting for the person: `held`, a held chain met a relay
   * chain; `branch`, unpublished moves fork against another device's
   * published ones (lib/branchConflict.ts).
   */
  conflict: 'held' | 'branch' | null
  /** Chain events signed here and not yet on a relay. */
  waiting: number
  /** navigator.onLine. */
  online: boolean
  /** Any configured relay connected, as far as the pool knows. */
  relayUp: boolean
  /** Published actions the canonical relay has not taken for a while (store canonicalLate); absent is none. */
  canonicalLate?: number
}

/**
 * Something about the chain's publishing that the LIVE/LOCAL switch cannot
 * say by itself, shown under it (hud/ChainStatus.tsx); null when there is
 * nothing to report. The switch keeps saying only what was chosen; this says
 * what is happening (arkinox, 2026-10-01).
 *
 * | Facts | Status |
 * |---|---|
 * | a held chain met a relay chain | conflict |
 * | unpublished moves fork against another device's published ones | diverged |
 * | the chain is held | held |
 * | LIVE, events waiting, offline | waiting: offline |
 * | LIVE, events waiting, no relay connected | waiting: no relay |
 * | anything else | null |
 *
 * LOCAL with events waiting is not a status: keeping them here is what
 * LOCAL means.
 */
export type ChainStatus =
  | { kind: 'conflict' }
  | { kind: 'diverged' }
  | { kind: 'held' }
  | { kind: 'waiting'; count: number; why: 'offline' | 'no-relay' }
  | { kind: 'canonical'; count: number }

export function chainStatusOf(f: StatusFacts): ChainStatus | null {
  if (f.conflict === 'held') return { kind: 'conflict' }
  if (f.conflict === 'branch') return { kind: 'diverged' }
  if (f.held) return { kind: 'held' }
  if (f.live && f.waiting > 0 && !f.online) return { kind: 'waiting', count: f.waiting, why: 'offline' }
  if (f.live && f.waiting > 0 && !f.relayUp) return { kind: 'waiting', count: f.waiting, why: 'no-relay' }
  if ((f.canonicalLate ?? 0) > 0) return { kind: 'canonical', count: f.canonicalLate! }
  return null
}

/** The status in the few words the strip under the switch has room for. */
export function chainStatusLabel(status: ChainStatus, check: SelfCheck | null): string {
  switch (status.kind) {
    case 'conflict': return 'CHAIN CONFLICT · CHOOSE'
    case 'diverged': return 'BRANCHES DIVERGED · CHOOSE'
    case 'held': {
      if (!check || check.status === 'checking') return 'HELD · CHECKING'
      if (check.status !== 'unknown') return 'HELD'
      return check.cause.kind === 'offline' ? 'HELD · OFFLINE' : check.cause.kind === 'refused' ? 'HELD · RELAY REFUSED' : 'HELD · NO ANSWER'
    }
    case 'waiting': return `${status.count} WAITING · ${status.why === 'offline' ? 'OFFLINE' : 'NO RELAY'}`
    case 'canonical': return `${status.count} NOT ON THE MAIN RELAY YET`
  }
}

/** One chain, as the conflict prompt shows it. */
export interface ChainSummary {
  /** created_at of the spawn, seconds. */
  startedAt: number
  /** Actions in the chain, spawn included. */
  actions: number
  /** created_at of the head, seconds. */
  lastActive: number
  position: Position
  plane: Plane
  /** The sector tag of the head, the same label the position panel uses. */
  sector: string
  headId: string
  spawnId: string
}

/** The active chain in `events` (newest spawn, then its links), summarized; null when there is none. */
export function summarizeChain(events: NostrEvent[]): ChainSummary | null {
  const chain = buildChain(events)
  if (chain.length === 0) return null
  const head = chain[chain.length - 1]
  return {
    startedAt: chain[0].createdAt,
    actions: chain.length,
    lastActive: head.createdAt,
    position: head.position,
    plane: head.plane,
    sector: sectorTag(xyzToSectorId(head.position.x, head.position.y, head.position.z)),
    headId: head.id,
    spawnId: chain[0].id,
  }
}

/**
 * Whether publishing the local chain would place you for every reader: true
 * when its spawn is the one §3.2 picks out of both (the newest, ties to the
 * larger id). It almost always is, since a held spawn was signed just now; it
 * is not when the relay chain itself was respawned later still.
 */
export function localSupersedes(local: NostrEvent[], relay: NostrEvent[]): boolean {
  const mine = buildChain(local)[0]
  const both = buildChain([...local, ...relay])[0]
  return !!mine && !!both && mine.id === both.id
}

/**
 * The conflict a held chain is in: the relay chain it met, which grows as
 * more of it arrives. Null when what arrived is no chain at all (nothing to
 * choose between), or is nothing new.
 */
export interface HeldConflict {
  kind: 'held'
  /** Everything the relays sent for this identity, merged by id. */
  relayEvents: NostrEvent[]
  at: number
}

export function foldHeldConflict(prev: HeldConflict | null, incoming: NostrEvent[], local: NostrEvent[], now: number): HeldConflict | null {
  const localIds = new Set(local.map((e) => e.id))
  const byId = new Map((prev?.relayEvents ?? []).map((e) => [e.id, e]))
  let added = 0
  for (const e of incoming) {
    if (localIds.has(e.id) || byId.has(e.id)) continue
    byId.set(e.id, e)
    added++
  }
  if (added === 0) return prev
  const relayEvents = [...byId.values()]
  if (buildChain(relayEvents).length === 0) return prev
  return { kind: 'held', relayEvents, at: prev?.at ?? now }
}
