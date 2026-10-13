/**
 * mentions.ts: tagging someone in local chat (arkinox, 2026-10-11).
 *
 * In the composer a mention is "@Name", which is what a person reads while
 * typing. On the wire it is NIP-27: the text carries "nostr:npub1..." where
 * the @Name was, and the inner chat event carries one ["p", <hex>] per person
 * mentioned, deduplicated and capped at MAX_MENTIONS. An agent's server reads
 * either one as "this line is addressed to me"; a reader that knows nothing
 * of mentions still reads the line, since a p tag is an ordinary tag and the
 * npub is ordinary text.
 *
 * On display the reverse: every nostr:npub1 (or nostr:nprofile1) in a line is
 * shown as @Name, and a line that mentions you is marked.
 */

import { nip19 } from 'nostr-tools'

/** The most people one line tags with p. More are still in the text, just not tagged. */
export const MAX_MENTIONS = 5

const HEX = /^[0-9a-f]{64}$/

/** Someone picked from the composer's list: who, and the name inserted as @Name. */
export interface Mention {
  pubkey: string
  label: string
}

/** Someone the composer can offer. */
export interface Candidate {
  pubkey: string
  label: string
  bot: boolean
  /** One of your own agents: listed first. */
  mine: boolean
}

/**
 * The mention being typed at the caret: an "@" at the start of the text or
 * after whitespace, followed by no whitespace up to the caret. `start` is the
 * index of the "@", `query` what follows it.
 */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(before[at - 1])) return null
  const query = before.slice(at + 1)
  if (/\s/.test(query)) return null
  return { start: at, query }
}

/** Replace the "@query" typed at [start, caret) with "@label ", and say where the caret goes. */
export function insertMention(text: string, start: number, caret: number, label: string): { text: string; caret: number } {
  const inserted = `@${label} `
  const rest = text.slice(caret).replace(/^\s+/, '')
  return { text: text.slice(0, start) + inserted + rest, caret: start + inserted.length }
}

/**
 * Who the picker shows for a query: your own agents first, then everyone
 * else, each group by label; a query keeps those whose label (or npub)
 * contains it, ignoring case, or whose npub starts with it. You are never offered.
 */
export function filterCandidates(all: readonly Candidate[], query: string, me: string, limit = 8): Candidate[] {
  const q = query.trim().toLowerCase()
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const c of all) {
    if (c.pubkey === me || seen.has(c.pubkey)) continue
    seen.add(c.pubkey)
    if (q && !c.label.toLowerCase().includes(q) && !(q.startsWith('npub1') && nip19.npubEncode(c.pubkey).startsWith(q))) continue
    out.push(c)
  }
  out.sort((a, b) => (a.mine === b.mine ? a.label.localeCompare(b.label) : a.mine ? -1 : 1))
  return out.slice(0, limit)
}

/**
 * The draft as it goes on the wire: each "@label" of a picked mention still
 * in the text becomes "nostr:npub1...", and the pubkeys mentioned, in the
 * order they appear, deduplicated, at most MAX_MENTIONS. A mention deleted
 * from the draft before sending is not tagged. Longer labels are replaced
 * first so "@Al" never eats the start of "@Alice".
 */
export function encodeMentions(text: string, picked: readonly Mention[]): { text: string; pubkeys: string[] } {
  const byLabel = new Map<string, string>()
  for (const m of picked) if (HEX.test(m.pubkey) && m.label && !byLabel.has(m.label)) byLabel.set(m.label, m.pubkey)
  const labels = [...byLabel.keys()].sort((a, b) => b.length - a.length)
  if (labels.length === 0) return { text, pubkeys: [] }
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`@(${labels.map(escape).join('|')})`, 'g')
  const out = text.replace(pattern, (_, label: string) => `nostr:${nip19.npubEncode(byLabel.get(label)!)}`)
  return { text: out, pubkeys: referencedPubkeys(out).slice(0, MAX_MENTIONS) }
}

/** The p tags for a line: one per pubkey, valid hex only, deduplicated, at most MAX_MENTIONS. */
export function mentionTags(pubkeys: readonly string[]): string[][] {
  return [...new Set(pubkeys.filter((p) => HEX.test(p)))].slice(0, MAX_MENTIONS).map((p) => ['p', p])
}

/** A piece of a line as shown: plain text, or a reference to someone. */
export type Segment = { text: string } | { pubkey: string; npub: string }

const REF = /nostr:(npub1[02-9ac-hj-np-z]+|nprofile1[02-9ac-hj-np-z]+)/g

function decodeRef(bech: string): string | null {
  try {
    const d = nip19.decode(bech)
    if (d.type === 'npub') return d.data
    if (d.type === 'nprofile') return d.data.pubkey
  } catch { /* not a reference after all */ }
  return null
}

/** A line split into text and NIP-27 profile references; a reference that does not decode stays text. */
export function segments(text: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(REF)) {
    const pubkey = decodeRef(m[1])
    if (!pubkey) continue
    const i = m.index ?? 0
    if (i > last) out.push({ text: text.slice(last, i) })
    out.push({ pubkey, npub: nip19.npubEncode(pubkey) })
    last = i + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** The pubkeys a line's text references, in order, deduplicated. */
export function referencedPubkeys(text: string): string[] {
  const out: string[] = []
  for (const s of segments(text)) if ('pubkey' in s && !out.includes(s.pubkey)) out.push(s.pubkey)
  return out
}

/** The pubkeys an inner event's p tags name, valid hex only, deduplicated. */
export function pTagged(tags: readonly string[][]): string[] {
  return [...new Set(tags.filter((t) => t[0] === 'p' && HEX.test(t[1] ?? '')).map((t) => t[1]))]
}

/** Whether a line is addressed to `me`: a p tag, or a reference in its text. Your own lines never are. */
export function mentionsMe(line: { text: string; mentions?: readonly string[]; from: string }, me: string): boolean {
  if (!HEX.test(me) || line.from === me) return false
  return (line.mentions ?? []).includes(me) || referencedPubkeys(line.text).includes(me)
}

/**
 * Everyone the @ list can offer: your own agents (whether or not they have
 * acted nearby lately, since they are yours to address), then the people in
 * the 27 sectors around you (usePresence). `profileOf` gives each one's
 * name and whether its profile says it is a bot; `labelOf` the name shown
 * and inserted.
 */
export function buildCandidates(
  nearby: readonly string[],
  myAgents: readonly string[],
  profileOf: (pubkey: string) => { bot?: boolean } | null | undefined,
  labelOf: (pubkey: string) => string,
): Candidate[] {
  const mine = new Set(myAgents)
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (const pubkey of [...myAgents, ...nearby]) {
    if (!HEX.test(pubkey) || seen.has(pubkey)) continue
    seen.add(pubkey)
    out.push({ pubkey, label: labelOf(pubkey), bot: mine.has(pubkey) || profileOf(pubkey)?.bot === true, mine: mine.has(pubkey) })
  }
  return out
}

/**
 * The draft with `@label ` put at its start, for CHAT on someone's avatar card
 * (arkinox, 2026-10-13: "opens the local chat and inserts the @tag for them at
 * the beginning of the message"). The person joins `picked`, exactly as a pick
 * from the @ list does, so send turns the name into nostr:npub and a p tag. A
 * draft that already mentions them is left as it is, with the caret at its end.
 */
export function prependMention(
  draft: string,
  picked: readonly Mention[],
  mention: Mention,
  maxLength = Infinity,
): { draft: string; picked: Mention[]; caret: number } {
  const tag = `@${mention.label}`
  const already = picked.some((m) => m.pubkey === mention.pubkey) && draft.includes(tag)
  if (already) return { draft, picked: [...picked], caret: draft.length }
  const next = `${tag} ${draft.replace(/^\s+/, '')}`.slice(0, maxLength)
  return {
    draft: next,
    picked: [...picked.filter((m) => m.pubkey !== mention.pubkey), mention],
    caret: Math.min(tag.length + 1, next.length),
  }
}

/** How old a line may be and still count as just arrived: older ones are a relay replaying the room. */
export const MENTION_FRESH_S = 600

/**
 * The lines of `add` that tag `me` and have just arrived (arkinox, 2026-10-13:
 * "a tag should probably do something more significant"): not your own, not
 * a line this device already holds, and said within MENTION_FRESH_S of now,
 * so a room replayed on load or on reconnect raises nothing.
 */
export function freshMentions<L extends { id: string; text: string; from: string; at: number; mentions?: readonly string[] }>(
  add: readonly L[],
  have: ReadonlySet<string>,
  me: string,
  now: number,
): L[] {
  const seen = new Set<string>()
  return add.filter((l) => {
    if (have.has(l.id) || seen.has(l.id)) return false
    seen.add(l.id)
    return now - l.at <= MENTION_FRESH_S && mentionsMe(l, me)
  })
}

/** A line as words, every reference shown as @Name, cut to `max` characters with an ellipsis. */
export function previewText(text: string, labelOf: (pubkey: string, npub: string) => string, max = 60): string {
  const words = segments(text).map((s) => ('pubkey' in s ? `@${labelOf(s.pubkey, s.npub)}` : s.text)).join('').replace(/\s+/g, ' ').trim()
  return words.length > max ? `${words.slice(0, max - 1).trimEnd()}…` : words
}
