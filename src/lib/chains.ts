/**
 * chains.ts — other people's chains, from the relay.
 *
 * The relay holds every kind:3333 ever published to it, and almost all of it
 * is v1: drift and noop actions from the proof-of-work era, which this client
 * cannot place. Every query here filters the `A` tag to the v2 actions, which
 * is what keeps a v1 avatar's ten thousand drifts from swamping the feed the
 * moment an old client comes back online.
 *
 * Pure helpers first, so the ordering and merging rules can be tested without
 * a socket; the relay calls below are thin.
 */

import { buildChain, parseAction, type ActionEvent, type NostrEvent } from './events'
import { nip19 } from 'nostr-tools'
import { query, subscribe } from './relay'

/** The actions this client understands, and therefore the only ones it asks for. */
export const V2_ACTIONS = ['spawn', 'hop', 'sidestep', 'enter-hyperspace', 'hyperjump']

const KIND = 3333

/** The newest v2 action per pubkey, newest pubkey first. */
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

/** Everything the relay has for one pubkey's v2 chain, raw. */
export function fetchChainEvents(pubkey: string): Promise<NostrEvent[]> {
  return query({ kinds: [KIND], authors: [pubkey], '#A': V2_ACTIONS })
}

/** The same, assembled. */
export async function fetchChain(pubkey: string): Promise<ActionEvent[]> {
  return buildChain(await fetchChainEvents(pubkey))
}

/** The newest v2 actions on the relay, any author. */
export function fetchRecent(limit = 400): Promise<NostrEvent[]> {
  return query({ kinds: [KIND], '#A': V2_ACTIONS, limit })
}

/** New v2 actions from anyone, from `since` on. */
export function watchRecent(since: number, onEvent: (ev: NostrEvent) => void): () => void {
  return subscribe({ kinds: [KIND], '#A': V2_ACTIONS, since }, onEvent)
}

/** New v2 actions from one author, from `since` on. */
export function watchAuthor(pubkey: string, since: number, onEvent: (ev: NostrEvent) => void): () => void {
  return subscribe({ kinds: [KIND], authors: [pubkey], '#A': V2_ACTIONS, since }, onEvent)
}

/** Accepts an npub or 64-char hex; returns hex, or null when it is neither. */
export function parsePubkey(input: string): string | null {
  const v = input.trim()
  if (/^[0-9a-f]{64}$/i.test(v)) return v.toLowerCase()
  if (!/^npub1/i.test(v)) return null
  try {
    const decoded = nip19.decode(v.toLowerCase())
    return decoded.type === 'npub' ? decoded.data : null
  } catch {
    return null
  }
}
