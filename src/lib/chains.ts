/**
 * chains.ts — other people's chains, from the relay.
 *
 * The relay holds every kind:3333 ever published to it, and almost all of it
 * is v1: drift and noop actions from the proof-of-work era, which this client
 * cannot place. Those must never swamp a feed or a chain the moment an old
 * client comes back online. Two kinds of question are asked here, and each
 * keeps the v1 flood out its own way:
 *
 * | Question | Filter | Why it keeps v1 out |
 * |---|---|---|
 * | where is anyone (the feed, presence, targets) | `#A` = the recognized actions | v1's names are not in the list |
 * | what is this one identity's chain | its spawns by `#A` = spawn, then `#e` = the newest spawn's id | v1 events name v1 genesis events, never a v2 spawn |
 *
 * The first question can list names because only a recognized action can
 * say where an identity is (spec §8.9 rule 5, §8.11.4 rules 1 and 7): an
 * action this client does not recognize never moves anyone, and a game's
 * moves inside a bracket never move the identity in cyberspace. The second
 * cannot: a chain is followed through every one of its events, whatever its
 * action is called (§8.9 rule 1), and a game names its own actions inside a
 * bracket (§8.11.2). Asking a chain by name made every chain stop before the
 * first action outside the list, so a game client playing on the same
 * identity was invisible, and this client's next move forked from an
 * earlier point and lost to the game's older branch (§8.7.3). Asking by the
 * genesis returns every event of the current chain and nothing of any other.
 *
 * Pure helpers first, so the ordering, merging and paging rules can be
 * tested without a socket; the relay calls below are thin.
 */

import type { Filter } from 'nostr-tools/filter'
import { RECOGNIZED_ACTIONS, buildChain, chainGap, parseAction, type ActionEvent, type NostrEvent } from './events'
import { nip19 } from 'nostr-tools'
import { query, queryEach, subscribe } from './relay'
import { PARTIAL_CHAIN_REASON, mergeAnswers, type RelayAnswer } from './relayOutcome'

export { PARTIAL_CHAIN_REASON }

/**
 * The actions that say where an identity is, and therefore the only ones the
 * position feeds ask for: every recognized action (events.ts
 * RECOGNIZED_ACTIONS), the bracket actions included, since an enter-virtual
 * says the identity is held where it entered.
 */
export const PLACING_ACTIONS: string[] = [...RECOGNIZED_ACTIONS]

const KIND = 3333

/**
 * The newest placing action per pubkey, newest pubkey first. Each one's
 * `position` is where that action leaves the identity in cyberspace: for an
 * enter-virtual the position it entered from, never a place inside a game.
 */
export function latestByPubkey(events: NostrEvent[]): ActionEvent[] {
  const best = new Map<string, ActionEvent>()
  for (const ev of events) {
    const a = parseAction(ev)
    if (!a) continue
    const cur = best.get(a.pubkey)
    if (!cur || a.createdAt > cur.createdAt || (a.createdAt === cur.createdAt && a.id > cur.id)) {
      best.set(a.pubkey, a)
    }
  }
  return [...best.values()].sort((x, y) => y.createdAt - x.createdAt || (x.id < y.id ? 1 : -1))
}

/** Union by id, order preserved: what was there first stays first. */
export function mergeEvents(existing: NostrEvent[], incoming: NostrEvent[]): NostrEvent[] {
  const seen = new Set(existing.map((e) => e.id))
  const out = existing.slice()
  for (const e of incoming) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    out.push(e)
  }
  return out
}

/** Every spawn an identity has signed: few, and what says which chain is current (§8.7.3 rule 1). */
export function spawnsFilter(pubkey: string): Filter {
  return { kinds: [KIND], authors: [pubkey], '#A': ['spawn'] }
}

/**
 * Every event of the chain a spawn starts, whatever its actions are called:
 * each one names the spawn in its `e` genesis tag (§8.7.3 rule 2), and a
 * relay indexes `e`. `until` asks for the page older than a page already in
 * hand (inclusive, so nothing at the boundary second is lost).
 */
export function chainFilter(pubkey: string, spawnId: string, until?: number): Filter {
  return { kinds: [KIND], authors: [pubkey], '#e': [spawnId], ...(until !== undefined ? { until } : {}) }
}

/** The id of the spawn the active chain starts from (§8.7.3 rule 1), or null with none. */
export function newestSpawnId(events: NostrEvent[]): string | null {
  return buildChain(events.filter((e) => parseAction(e)?.type === 'spawn'))[0]?.id ?? null
}

/** The most extra questions one chain fetch asks to fill holes (chainGap). */
export const MAX_CHAIN_PAGES = 60


/**
 * A chain fetch that could not fill a hole: some event of the chain is on no
 * relay asked, or finding it took more than MAX_CHAIN_PAGES questions. A
 * chain with a hole resolves to its stretch before the hole, which is a
 * wrong head, so the caller is told so rather than handed that head.
 */
export class ChainGapError extends Error {
  constructor(readonly events: NostrEvent[]) {
    super(PARTIAL_CHAIN_REASON)
  }
}

/**
 * One relay's answers to two questions, as one answer: the events of both,
 * and an outcome that is only `answered` when both were answered. A relay
 * that answered the spawns but not the chain has not said what the chain is.
 */
export function combineAnswers(first: RelayAnswer[], second: RelayAnswer[]): RelayAnswer[] {
  const byUrl = new Map(second.map((a) => [a.url, a]))
  const out = first.map((a): RelayAnswer => {
    const b = byUrl.get(a.url)
    byUrl.delete(a.url)
    if (!b) return a
    const events = mergeEvents(a.events, b.events)
    if (a.outcome !== 'answered') return { ...a, events }
    return { ...b, events }
  })
  return [...out, ...byUrl.values()]
}

/** Every answered relay marked as not having said what the chain is (PARTIAL_CHAIN_REASON). */
export function markPartial(answers: RelayAnswer[]): RelayAnswer[] {
  return answers.map((a): RelayAnswer => (a.outcome === 'answered' ? { url: a.url, outcome: 'unreachable', reason: PARTIAL_CHAIN_REASON, events: a.events } : a))
}

/**
 * The fetch every chain read shares, over any way of asking: the spawns,
 * then the newest spawn's chain by genesis, then, while the chain has a hole
 * (events.ts chainGap), the page ending at the hole nearest the head, or the
 * missing event by id when that page brought nothing new (one second holding
 * more events than a relay returns at once). With the genesis already known
 * (your own chain, a chain being followed) the chain and the spawns are asked
 * at once, and the chain is asked again only if a newer spawn turned up.
 * `have` is what the caller already holds, which fills holes without asking:
 * your own chain's events, so a look before a commit asks only for what is
 * newer. It never decides which chain is asked for: that is the relays'
 * newest spawn alone. Resolves to what was gathered and whether a hole is
 * left.
 */
async function gatherChain<T>(
  ask: (f: Filter) => Promise<T>,
  eventsOf: (t: T) => NostrEvent[],
  combine: (a: T, b: T) => T,
  pubkey: string,
  knownSpawnId: string | undefined,
  have: NostrEvent[],
): Promise<{ got: T; whole: boolean }> {
  let got: T
  let spawnId: string | null
  if (knownSpawnId) {
    const [spawns, chain] = await Promise.all([ask(spawnsFilter(pubkey)), ask(chainFilter(pubkey, knownSpawnId))])
    got = combine(spawns, chain)
    // The relays' newest spawn, from what the relays hold and nothing else.
    // A chain held on this device has a newer spawn than any on the relays
    // (it was signed before they could answer), and choosing from it here
    // would never ask for the relay chain at all: the held-chain prompt
    // would show that chain as a bare spawn and offer to replace it.
    spawnId = newestSpawnId(eventsOf(got))
    if (spawnId && spawnId !== knownSpawnId) got = combine(got, await ask(chainFilter(pubkey, spawnId)))
  } else {
    got = await ask(spawnsFilter(pubkey))
    spawnId = newestSpawnId(eventsOf(got))
    if (!spawnId) return { got, whole: true }
    got = combine(got, await ask(chainFilter(pubkey, spawnId)))
  }
  if (!spawnId) return { got, whole: true }
  const genesis = spawnId
  const hole = (): ReturnType<typeof chainGap> => chainGap([...have, ...eventsOf(got)], genesis)
  for (let asked = 0; asked < MAX_CHAIN_PAGES; asked++) {
    const gap = hole()
    if (!gap) return { got, whole: true }
    const before = eventsOf(got).length
    got = combine(got, await ask(chainFilter(pubkey, genesis, gap.until)))
    if (eventsOf(got).length > before) continue
    asked++
    got = combine(got, await ask({ kinds: [KIND], authors: [pubkey], ids: [gap.missingId] }))
    if (eventsOf(got).length === before) break
  }
  return { got, whole: hole() === null }
}

/**
 * Everything the relays have for one pubkey's current chain, raw: every
 * spawn it has signed, and every event of the chain the newest one starts.
 * `knownSpawnId` saves a round trip when the caller already holds a chain,
 * and `have` (its events) lets it ask only for what it does not hold.
 * Rejects with ChainGapError when a hole could not be filled.
 */
export async function fetchChainEvents(pubkey: string, knownSpawnId?: string, have: NostrEvent[] = []): Promise<NostrEvent[]> {
  const { got, whole } = await gatherChain(query, (e) => e, mergeEvents, pubkey, knownSpawnId, have)
  if (!whole) throw new ChainGapError(got)
  return got
}

/** How long the own-chain check waits for each relay's real answer, per question. */
export const CHAIN_CHECK_MS = 6000

/**
 * The same question, with each relay's answer kept: answered, refused or
 * unreachable (relayOutcome.ts), and every answer marked unreachable when the
 * chain came back with a hole (markPartial). The self-check decides from these whether
 * this identity has a chain, has none, or cannot be told (chainHold.ts).
 */
export async function askChainEvents(pubkey: string, knownSpawnId?: string, have: NostrEvent[] = []): Promise<RelayAnswer[]> {
  const { got, whole } = await gatherChain((f) => queryEach(f, CHAIN_CHECK_MS), mergeAnswers, combineAnswers, pubkey, knownSpawnId, have)
  // A hole left in the chain is not an answer to "what is this chain": the
  // self-check reads it as unknown, so a first move holds rather than
  // continuing from a head that is not the head (chainHold.ts).
  return whole ? got : markPartial(got)
}

/** The same, assembled. */
export async function fetchChain(pubkey: string): Promise<ActionEvent[]> {
  return buildChain(await fetchChainEvents(pubkey))
}

/** The newest placing actions on the relay, any author. */
export function fetchRecent(limit = 400): Promise<NostrEvent[]> {
  return query({ kinds: [KIND], '#A': PLACING_ACTIONS, limit })
}

/** New placing actions from anyone, from `since` on. */
export function watchRecent(since: number, onEvent: (ev: NostrEvent) => void): () => void {
  return subscribe({ kinds: [KIND], '#A': PLACING_ACTIONS, since }, onEvent)
}

/**
 * Every new action from one author, from `since` on, whatever it is called:
 * a chain grows by actions this client does not recognize and by a game's
 * moves as well as by its own (§8.9, §8.11). No `#A` filter, so the v1 flood
 * is kept out the other way: an old client of the same identity running at
 * this moment would send its new events here, and buildChain drops them,
 * because they name a v1 genesis. Only events from `since` on arrive, so
 * the ten thousand old drifts never do.
 */
export function watchAuthor(pubkey: string, since: number, onEvent: (ev: NostrEvent) => void, onEose?: () => void): () => void {
  return subscribe({ kinds: [KIND], authors: [pubkey], since }, onEvent, onEose)
}

/** Accepts an npub, an nprofile (its relay hints dropped) or 64-char hex; returns hex, or null when it is none of them. */
export function parsePubkey(input: string): string | null {
  const v = input.trim()
  if (/^[0-9a-f]{64}$/i.test(v)) return v.toLowerCase()
  if (!/^(npub|nprofile)1/i.test(v)) return null
  try {
    const decoded = nip19.decode(v.toLowerCase())
    if (decoded.type === 'npub') return decoded.data
    if (decoded.type === 'nprofile') return decoded.data.pubkey
    return null
  } catch {
    return null
  }
}
