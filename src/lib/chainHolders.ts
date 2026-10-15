/**
 * chainHolders.ts - the relays that hold this identity's chain.
 *
 * Confirming a head before a signature waits for every relay that holds the
 * chain, for up to 2.5 s from when its requests go out (chains.ts
 * HEAD_CONFIRM_MS), and for no other (arkinox's ruling of 2026-10-08 on the
 * slow-relay grace). A relay holds the chain once
 * it has taken one of this identity's chain events (OK true on a publish) or
 * sent one back in a fetch, in this session or an earlier one. The canonical
 * relay always does.
 *
 * Kept per identity beside the saved chain, as the publisher keeps the
 * actions still owed to the canonical relay, so a reload still knows which
 * relays another device of this identity has been publishing to. A relay is
 * never dropped from the set: one that stops answering costs a move at most
 * those 2.5 s, until the player takes it out of the relay
 * list (only the configured relays are asked, so only they are waited for).
 */

import { normalizeURL } from 'nostr-tools/utils'
import type { NostrEvent } from './events'
import type { RelayAnswer } from './relayOutcome'
import { DEFAULT_RELAY } from '../store/useRelays'

/** Where an identity's set is saved: normalized relay URLs, the canonical relay left implicit. */
const holdersKeyFor = (pubkey: string): string => `onosendai:chain-holders:${pubkey}`

/** Each identity's set as loaded this session, so storage is read once. */
const known = new Map<string, Set<string>>()

function load(pubkey: string): Set<string> {
  const had = known.get(pubkey)
  if (had) return had
  const set = new Set<string>()
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(holdersKeyFor(pubkey)) ?? '[]')
    if (Array.isArray(saved)) for (const url of saved) if (typeof url === 'string') set.add(normalizeURL(url))
  } catch { /* nothing saved, or no storage here: an empty set */ }
  known.set(pubkey, set)
  return set
}

/** The relays that hold `pubkey`'s chain (normalized URLs), the canonical relay always among them. */
export function chainHolders(pubkey: string): Set<string> {
  return new Set([normalizeURL(DEFAULT_RELAY), ...load(pubkey)])
}

/** These relays hold `pubkey`'s chain: one took a chain event, or sent one back. Saved at once. */
export function noteChainHolders(pubkey: string, urls: string[]): void {
  if (!pubkey || urls.length === 0) return
  const set = load(pubkey)
  const before = set.size
  for (const url of urls) set.add(normalizeURL(url))
  if (set.size === before) return
  try { localStorage.setItem(holdersKeyFor(pubkey), JSON.stringify([...set])) } catch { /* private mode: kept for this page */ }
}

/** The relays whose answer to a chain question held one of `pubkey`'s events. */
export function noteHoldersFrom(pubkey: string, answers: RelayAnswer[]): void {
  const holds = (events: NostrEvent[]): boolean => events.some((e) => e.pubkey === pubkey)
  noteChainHolders(pubkey, answers.filter((a) => holds(a.events)).map((a) => a.url))
}
