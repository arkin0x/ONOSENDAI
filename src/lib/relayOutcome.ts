/**
 * relayOutcome.ts - what one relay said to one question, told apart.
 *
 * A one-shot query used to come back as a bare list of events, and an empty
 * list meant three different things: the relay answered that it has nothing,
 * the relay never answered, or the relay refused to answer. nostr-tools makes
 * the first two look the same on purpose: when a subscription's own EOSE timer
 * runs out it calls the very handler a real EOSE calls. For most reads that is
 * harmless. For the one read that decides whether a switched-in identity
 * already has a chain, it is the difference between continuing that chain and
 * quietly starting a rival one (arkinox, 2026-10-01).
 *
 * So the query path (relay.ts queryEach) hands nostr-tools a timer far longer
 * than anything we wait for, runs its own shorter deadline, and reports each
 * relay as one of three outcomes:
 *
 * | Outcome | Meaning |
 * |---|---|
 * | answered | a real EOSE arrived before our deadline: the events are all it has |
 * | refused | the relay ended the subscription with a NIP-01 reason (auth-required:, restricted:, ...) |
 * | unreachable | the connection failed, dropped, or no EOSE came by our deadline |
 *
 * Pure: no sockets here, so the classification is tested on its own.
 */

import type { NostrEvent } from './events'

export type RelayAnswer =
  | { url: string; outcome: 'answered'; events: NostrEvent[] }
  | { url: string; outcome: 'refused'; reason: string; events: NostrEvent[] }
  | { url: string; outcome: 'unreachable'; reason: string; events: NostrEvent[] }

/**
 * The machine-readable prefixes NIP-01 gives a relay for CLOSED (and OK
 * false). A reason that starts with one of these came from the relay itself
 * and is its answer; anything else (our own "closed by caller", the pool's
 * "relay connection closed", a ping timeout) is the connection, not a reply.
 */
const REFUSAL_PREFIXES = ['auth-required', 'restricted', 'blocked', 'rate-limited', 'invalid', 'error', 'pow', 'duplicate', 'mute'] as const
const REFUSAL = new RegExp(`^(${REFUSAL_PREFIXES.join('|')}):`, 'i')

/**
 * The reason a relay's answer carries when it answered, but the chain it
 * returned has a hole no further question could fill (chains.ts
 * markPartial): it did not say what the chain is.
 */
export const PARTIAL_CHAIN_REASON = 'the relays returned only part of this chain'

/** True when a close reason is a relay's own refusal rather than a dropped connection. */
export function isRefusal(reason: string): boolean {
  return REFUSAL.test(reason.trim())
}

/** One relay's subscription ended before any EOSE: a refusal, or the connection going away. */
export function classifyClose(url: string, reason: string, events: NostrEvent[]): RelayAnswer {
  const r = reason.trim()
  return isRefusal(r)
    ? { url, outcome: 'refused', reason: r, events }
    : { url, outcome: 'unreachable', reason: r || 'connection closed', events }
}

/** Every event any relay returned, once each, in arrival order. */
export function mergeAnswers(answers: RelayAnswer[]): NostrEvent[] {
  const byId = new Map<string, NostrEvent>()
  for (const a of answers) for (const e of a.events) if (!byId.has(e.id)) byId.set(e.id, e)
  return [...byId.values()]
}
