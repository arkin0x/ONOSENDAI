/**
 * followAgent.ts: ACTIVATE in the AGENTS panel (arkinox, 2026-11-11, D5).
 *
 * The agent replies to its operator with its npub; the operator pastes it
 * into the AGENTS panel and taps ACTIVATE. That adds the agent to the
 * operator's own kind 3 follow list, which is what MY AGENTS keeps to
 * (lib/agentInvite.ts followedAgents). The agent never reads the list.
 *
 * The list is edited, never rebuilt: every tag and the content of the newest
 * kind 3 stay as they are, and one `p` tag is added at the end. A kind 3 is
 * replaceable, so one built from less than the whole list would wipe the
 * person's follows everywhere. So the edit is refused, and nothing is signed,
 * when too few relays answered the fetch (lib/muteList.ts fetchRefusal, the
 * rule the mute list edits by): with a list found, two of the general
 * relays, or most of the person's own write relays (NIP-65), must have
 * answered; with no list found, every one of them must have answered "none"
 * before a new list is made. A failed or timed-out fetch is never "none".
 * One ACTIVATE runs at a time. Nothing here runs untapped.
 */

import type { EventTemplate, NostrEvent } from '../lib/events'
import type { RelayAnswer } from '../lib/relayOutcome'
import { parsePubkey } from '../lib/chains'
import { GENERAL_RELAYS, parseContacts } from '../lib/contacts'
import { RELAY_LIST_KIND } from '../lib/inbox'
import { fetchRefusal, writeRelaysOf } from '../lib/muteList'
import { publishMany, queryEachAt, relaySet, type PublishResult } from '../lib/relay'
import { DEFAULT_RELAY } from './useRelays'
import { useCyberspace } from './useCyberspace'

export const CONTACTS_KIND = 3
/** How long the fetch waits on each relay. */
const FETCH_MS = 6000
/** A person is reading the signer's prompt. */
const SIGN_PATIENCE_MS = 120_000

/** What ACTIVATE says when it does not go. Short and plain. */
export const ACTIVATE_WORDS = {
  empty: "Paste your agent's npub first.",
  invalid: 'That is not an npub.',
  self: "That is your own npub. Paste your agent's.",
  already: 'You already follow that agent.',
  unread: 'Could not read your follow list from enough relays. Nothing changed. Try again.',
  switched: 'Your account changed. Nothing changed.',
  busy: 'One moment.',
} as const

/** The pasted text as a pubkey to follow, or why not. Trims; takes an npub (or nprofile) or 64 hex. */
export function checkAgentKey(input: string, me: string, follows: Iterable<string> = []): { pubkey: string } | { error: string } {
  if (!input.trim()) return { error: ACTIVATE_WORDS.empty }
  const pubkey = parsePubkey(input)
  if (!pubkey) return { error: ACTIVATE_WORDS.invalid }
  if (pubkey === me) return { error: ACTIVATE_WORDS.self }
  for (const f of follows) if (f === pubkey) return { error: ACTIVATE_WORDS.already }
  return { pubkey }
}

/** The newest kind 3 by `me` among events, or null. Ties go to the lower id (NIP-01). */
export function newestContacts(events: readonly NostrEvent[], me: string): NostrEvent | null {
  let best: NostrEvent | null = null
  for (const ev of events) {
    if (ev.pubkey !== me || ev.kind !== CONTACTS_KIND) continue
    if (!best || ev.created_at > best.created_at || (ev.created_at === best.created_at && ev.id < best.id)) best = ev
  }
  return best
}

/** `prev` with one more follow: every tag and the content kept as they were; a new list when `prev` is null. */
export function followTemplate(prev: NostrEvent | null, pubkey: string, now: number): EventTemplate {
  return {
    kind: CONTACTS_KIND,
    created_at: Math.max(now, (prev?.created_at ?? 0) + 1),
    tags: [...(prev?.tags ?? []).map((t) => [...t]), ['p', pubkey]],
    content: prev?.content ?? '',
  }
}

/** What ACTIVATE needs from the outside world; replaced in tests (setFollowDeps). */
export interface FollowDeps {
  /** Every relay's answer to "this person's kind 3 (and 10002)", and the write relays their 10002 names. */
  fetch: (pubkey: string) => Promise<{ answers: RelayAnswer[]; writeRelays: string[] }>
  publish: (event: NostrEvent, writeRelays: string[]) => Promise<PublishResult>
  sign: (template: EventTemplate) => Promise<NostrEvent>
  self: () => string
  now: () => number
}

const norm = (url: string): string => url.trim().toLowerCase().replace(/\/+$/, '')
function baseRelays(): string[] {
  const out: string[] = []
  for (const r of [...GENERAL_RELAYS, ...relaySet()]) if (!out.some((x) => norm(x) === norm(r))) out.push(r)
  return out
}

const liveDeps: FollowDeps = {
  fetch: async (pubkey) => {
    const base = baseRelays()
    const first = await queryEachAt(base, { kinds: [CONTACTS_KIND, RELAY_LIST_KIND], authors: [pubkey] }, FETCH_MS)
    const relayLists = first.flatMap((a) => a.events).filter((e) => e.kind === RELAY_LIST_KIND && e.pubkey === pubkey)
    const writeRelays = writeRelaysOf(relayLists.sort((a, b) => b.created_at - a.created_at)[0])
    const extra = writeRelays.filter((w) => !base.some((b) => norm(b) === norm(w)))
    const second = extra.length ? await queryEachAt(extra, { kinds: [CONTACTS_KIND], authors: [pubkey] }, FETCH_MS) : []
    return { answers: [...first, ...second], writeRelays }
  },
  publish: (event, writeRelays) => {
    const to = baseRelays()
    for (const w of writeRelays) if (!to.some((x) => norm(x) === norm(w))) to.push(w)
    return publishMany(to, event)
  },
  sign: (template) => useCyberspace.getState().signEvent(template, SIGN_PATIENCE_MS),
  self: () => useCyberspace.getState().identity.pubkey,
  now: () => Math.floor(Date.now() / 1000),
}

let deps: FollowDeps = liveDeps

/** Tests only: swap the relays and the signer. Returns the previous deps. */
export function setFollowDeps(next: Partial<FollowDeps> | null): FollowDeps {
  const prev = deps
  deps = next ? { ...liveDeps, ...next } : liveDeps
  return prev
}

let running = false

/**
 * ACTIVATE: follow the agent whose npub was pasted. Fetches the newest kind
 * 3 again, refuses on too few answers, then signs and publishes the list
 * with the agent added. The pubkey on success, or the words for why not.
 */
export async function activateAgent(input: string): Promise<{ ok: true; pubkey: string } | { ok: false; error: string }> {
  const me = deps.self()
  const first = checkAgentKey(input, me)
  if ('error' in first) return { ok: false, error: first.error }
  if (running) return { ok: false, error: ACTIVATE_WORDS.busy }
  running = true
  try {
    let fetched: Awaited<ReturnType<FollowDeps['fetch']>>
    try { fetched = await deps.fetch(me) } catch { return { ok: false, error: ACTIVATE_WORDS.unread } }
    // Every event heard, whichever relay sent it, so the newest list is the one edited.
    const prev = newestContacts(fetched.answers.flatMap((a) => a.events), me)
    const refusal = fetchRefusal(fetched.answers, { writeRelays: fetched.writeRelays, general: GENERAL_RELAYS, canonical: DEFAULT_RELAY, found: prev !== null })
    if (refusal) return { ok: false, error: ACTIVATE_WORDS.unread }
    if (deps.self() !== me) return { ok: false, error: ACTIVATE_WORDS.switched }
    const checked = checkAgentKey(input, me, prev ? parseContacts(prev).map((c) => c.pubkey) : [])
    if ('error' in checked) return { ok: false, error: checked.error }
    const signed = await deps.sign(followTemplate(prev, checked.pubkey, deps.now()))
    if (signed.pubkey !== me || deps.self() !== me) return { ok: false, error: ACTIVATE_WORDS.switched }
    const result = await deps.publish(signed, fetched.writeRelays)
    if (!result.ok) return { ok: false, error: `Not saved: ${result.reason}` }
    return { ok: true, pubkey: checked.pubkey }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    running = false
  }
}
