/**
 * muteList.ts - the person's NIP-51 mute list (kind 10000), read and edited
 * without losing what other clients wrote.
 *
 * Nostr has one standard list of people and things a person does not want to
 * see: kind 10000. There is no separate "block list" kind (10006 blocks
 * relays, 30007 mutes a pubkey per kind, 30000 `d=mute` is deprecated), so
 * in ONOSENDAI a BLOCK is a `p` entry on this list, and every other client
 * that reads the list honors it the same way (arkinox, 2026-10-23: "support
 * mute lists and block lists that are standard on Nostr").
 *
 * The list has two halves. Public entries are the event's tags. Private
 * entries are a JSON array shaped like tags, encrypted to the author's own
 * key in `content`: NIP-44 now, NIP-04 in older lists ("?iv=" in the
 * ciphertext tells them apart). ONOSENDAI writes:
 *
 * | Entry | Tag | Half | Why |
 * |---|---|---|---|
 * | BLOCK AUTHOR | `["p", <pubkey>]` | private | a public block tells the person they were blocked and who did it |
 * | MUTE THIS ITEM | `["e", <item event id>]` | private | the item sits sealed in a bag; a public id shows you found it |
 *
 * Unblocking removes the entry from whichever half holds it, public too, so
 * a block made in another client can be undone here.
 *
 * Editing is read, merge, write. A list is one replaceable event: whoever
 * publishes last replaces the whole thing. So an edit always starts from the
 * newest copy on the relays, keeps every tag it does not understand (public
 * and private, words, hashtags, threads, anything a future NIP adds), and is
 * refused outright when that copy cannot be fetched or its private half
 * cannot be opened: a list written from a blank or half-read start would
 * erase the person's mutes everywhere. Nothing here talks to a relay or a
 * signer; the store (store/useMutes) does, through the shapes below.
 */

import type { EventTemplate, NostrEvent } from './events'
import type { RelayAnswer } from './relayOutcome'

export const MUTE_LIST_KIND = 10000

export type Tag = string[]

/** How a list's private half is sealed: nothing there, NIP-44 v2, or the legacy NIP-04. */
export type Scheme = 'none' | 'nip44' | 'nip04'

/** NIP-51: an "iv" in the ciphertext is the NIP-04 form; anything else non-empty is NIP-44. */
export function schemeOf(content: string): Scheme {
  if (!content || !content.trim()) return 'none'
  return content.includes('?iv=') ? 'nip04' : 'nip44'
}

/** Encryption to and from the person's own key, as the signer offers it. Each is absent when the signer lacks it. */
export interface SelfCrypto {
  nip44Decrypt?: (payload: string) => Promise<string>
  nip44Encrypt?: (plaintext: string) => Promise<string>
  nip04Decrypt?: (payload: string) => Promise<string>
  nip04Encrypt?: (plaintext: string) => Promise<string>
}

/** A list read whole: both halves, and how the private half was sealed. */
export interface ReadList {
  /** The event this was read from; null when the person has no list yet. */
  event: NostrEvent | null
  publicTags: Tag[]
  privateTags: Tag[]
  scheme: Scheme
}

/** Why a list could not be read whole, so it must not be written over. */
export class MuteListUnreadable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MuteListUnreadable'
  }
}

/** Words the person sees when an edit is refused. Short: they land in a toast. */
export const WORDS = {
  noAnswer: 'No relay answered, so your mute list was left as it is. Try again.',
  outboxSilent: 'None of your own relays answered, so your mute list was left as it is. Try again.',
  cannotOpen: 'Your signer could not open the private part of your mute list, so it was left as it is.',
  noDecrypt: 'Your signer cannot decrypt, so the private part of your mute list cannot be kept. Nothing was changed.',
  noEncrypt: 'Your signer cannot encrypt, so a private entry cannot be written. Nothing was changed.',
  malformed: 'The private part of your mute list is not a list this app can read, so it was left as it is.',
} as const

/** A tag array as written: every element a string, at least a name. Anything else is dropped. */
function isTag(t: unknown): t is Tag {
  return Array.isArray(t) && t.length > 0 && t.every((x) => typeof x === 'string')
}

/** The decrypted private half: a JSON array of tags. Throws MuteListUnreadable when it is not one. */
export function parsePrivate(plain: string): Tag[] {
  let v: unknown
  try { v = JSON.parse(plain) } catch { throw new MuteListUnreadable(WORDS.malformed) }
  if (!Array.isArray(v)) throw new MuteListUnreadable(WORDS.malformed)
  // A stray non-tag element is dropped rather than refusing the whole list:
  // nothing could be done with it, and it is not an entry anyone wrote.
  return v.filter(isTag).map((t) => [...t])
}

/** Opens the private half with the scheme it was sealed with. Throws MuteListUnreadable when it cannot. */
export async function openPrivate(content: string, crypto: SelfCrypto): Promise<{ tags: Tag[]; scheme: Scheme }> {
  const scheme = schemeOf(content)
  if (scheme === 'none') return { tags: [], scheme }
  const open = scheme === 'nip04' ? crypto.nip04Decrypt : crypto.nip44Decrypt
  if (!open) throw new MuteListUnreadable(WORDS.noDecrypt)
  let plain: string
  try { plain = await open(content) } catch (err) {
    // A signer on another account, or one that could not say, is its own
    // readable error from the store's decrypt: pass it on as it is.
    if (err instanceof Error && (err.name === 'SignerAccountMismatch' || err.name === 'SignerUnconfirmed')) throw err
    throw new MuteListUnreadable(WORDS.cannotOpen)
  }
  return { tags: parsePrivate(plain), scheme }
}

/** Reads a list whole. `event` null is a person with no list. */
export async function readList(event: NostrEvent | null, crypto: SelfCrypto): Promise<ReadList> {
  if (!event) return { event: null, publicTags: [], privateTags: [], scheme: 'none' }
  const { tags, scheme } = await openPrivate(event.content, crypto)
  return { event, publicTags: event.tags.filter(isTag).map((t) => [...t]), privateTags: tags, scheme }
}

/** What ONOSENDAI hides by: pubkeys (`p`) and single things (`e`). */
export interface Muted {
  pubkeys: ReadonlySet<string>
  items: ReadonlySet<string>
}

export const NOTHING_MUTED: Muted = { pubkeys: new Set(), items: new Set() }

const HEX64 = /^[0-9a-f]{64}$/

/**
 * The pubkeys and item ids both halves name. Your own pubkey is never in it:
 * a list naming you (another client's slip, a test) must not hide your own
 * world from you.
 */
export function mutedBy(tags: readonly Tag[], self: string | null): Muted {
  const pubkeys = new Set<string>()
  const items = new Set<string>()
  for (const t of tags) {
    const v = (t[1] ?? '').trim().toLowerCase()
    if (!HEX64.test(v)) continue
    if (t[0] === 'p' && v !== self) pubkeys.add(v)
    else if (t[0] === 'e') items.add(v)
  }
  return { pubkeys, items }
}

/** One edit to the list. */
export type MuteEdit =
  | { op: 'add'; tag: ['p' | 'e', string]; private: boolean }
  | { op: 'remove'; tag: ['p' | 'e', string] }

function same(t: Tag, name: string, value: string): boolean {
  return t[0] === name && (t[1] ?? '').trim().toLowerCase() === value
}

/**
 * The halves after an edit, and whether anything changed. An add already
 * present in either half changes nothing (it is not moved between halves).
 * A remove takes the entry out of both. Every other tag is kept in place;
 * a new entry goes on the end (NIP-51: chronological order).
 */
export function applyEdit(list: Pick<ReadList, 'publicTags' | 'privateTags'>, edit: MuteEdit): { publicTags: Tag[]; privateTags: Tag[]; changed: boolean } {
  const [name, raw] = edit.tag
  const value = raw.trim().toLowerCase()
  const publicTags = list.publicTags.map((t) => [...t])
  const privateTags = list.privateTags.map((t) => [...t])
  if (edit.op === 'add') {
    if ([...publicTags, ...privateTags].some((t) => same(t, name, value))) return { publicTags, privateTags, changed: false }
    ;(edit.private ? privateTags : publicTags).push([name, value])
    return { publicTags, privateTags, changed: true }
  }
  const pub = publicTags.filter((t) => !same(t, name, value))
  const priv = privateTags.filter((t) => !same(t, name, value))
  return { publicTags: pub, privateTags: priv, changed: pub.length !== publicTags.length || priv.length !== privateTags.length }
}

/**
 * The next kind 10000. The private half is sealed again with the scheme it
 * came in, so a client that only reads NIP-04 still reads the list it wrote;
 * a new private half is NIP-44. An empty private half is an empty content.
 * Another client's `client` tag is dropped (the signer adds ONOSENDAI's):
 * it names who wrote the event, and this event is not theirs. `created_at`
 * is pushed past the copy it replaces, because a replaceable event older
 * than the relay's is dropped without a word.
 */
export async function listTemplate(
  next: { publicTags: Tag[]; privateTags: Tag[] },
  previous: Pick<ReadList, 'event' | 'scheme'>,
  crypto: SelfCrypto,
  now: number,
): Promise<EventTemplate> {
  let content = ''
  if (next.privateTags.length > 0) {
    const scheme: Scheme = previous.scheme === 'nip04' ? 'nip04' : 'nip44'
    const seal = scheme === 'nip04' ? crypto.nip04Encrypt : crypto.nip44Encrypt
    if (!seal) throw new MuteListUnreadable(WORDS.noEncrypt)
    content = await seal(JSON.stringify(next.privateTags))
  }
  return {
    kind: MUTE_LIST_KIND,
    created_at: Math.max(now, (previous.event?.created_at ?? 0) + 1),
    tags: next.publicTags.filter((t) => t[0] !== 'client'),
    content,
  }
}

/** The newest kind 10000 by this author among events, or null. Ties go to the lower id (NIP-01). */
export function newestList(events: readonly (NostrEvent | null | undefined)[], pubkey: string): NostrEvent | null {
  let best: NostrEvent | null = null
  for (const ev of events) {
    if (!ev || ev.pubkey !== pubkey || ev.kind !== MUTE_LIST_KIND) continue
    if (!best || ev.created_at > best.created_at || (ev.created_at === best.created_at && ev.id < best.id)) best = ev
  }
  return best
}

/** The write relays a kind 10002 names (NIP-65: `write`, or unmarked), secure sockets only. */
export function writeRelaysOf(ev: Pick<NostrEvent, 'tags'> | null | undefined): string[] {
  if (!ev) return []
  const out: string[] = []
  for (const t of ev.tags) {
    if (t[0] !== 'r' || !t[1] || (t[2] && t[2] !== 'write')) continue
    const url = t[1].trim().replace(/\/+$/, '')
    if (/^wss:\/\/[^\s/]+/.test(url) && !out.includes(url)) out.push(url)
  }
  return out
}

function norm(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '')
}

/**
 * Whether the relays' answers are enough to edit on. At least one relay
 * must have answered (an EOSE, not a timeout); and when the person names
 * write relays of their own (NIP-65), one of THOSE must have answered,
 * since that is where other clients put the list. Null when it is enough,
 * else the words for why not.
 */
export function fetchRefusal(answers: readonly RelayAnswer[], writeRelays: readonly string[]): string | null {
  const answered = answers.filter((a) => a.outcome === 'answered')
  if (answered.length === 0) return WORDS.noAnswer
  if (writeRelays.length === 0) return null
  const own = new Set(writeRelays.map(norm))
  return answered.some((a) => own.has(norm(a.url))) ? null : WORDS.outboxSilent
}

/**
 * Whether a thing is hidden by the list: any of its authors is muted, or any
 * of its ids is. A thing can have more than one author (the bag's signer,
 * and the object a LIVE LINK places, or the claimed author of what a chest
 * holds) and more than one id (its own, and the lineage `d` a moved item
 * keeps). Never a thing that is yours (`mine`), nor anyone's by your pubkey.
 */
export function hidesThing(
  muted: Muted,
  thing: { authors: readonly (string | null | undefined)[]; ids?: readonly (string | null | undefined)[]; mine?: boolean },
  self?: string | null,
): boolean {
  if (thing.mine) return false
  // The first author is whoever holds it (the bag's signer): yours, it is never hidden.
  if (self && thing.authors[0] === self) return false
  if (muted.pubkeys.size > 0 && thing.authors.some((a) => !!a && a !== self && muted.pubkeys.has(a))) return true
  return muted.items.size > 0 && (thing.ids ?? []).some((id) => !!id && muted.items.has(id))
}

/** Events less those by someone muted or muted by id; yours always stay. The same array when nothing is muted. */
export function withoutMuted<T extends { pubkey: string; id: string }>(events: T[], muted: Muted, self?: string | null): T[] {
  if (muted.pubkeys.size === 0 && muted.items.size === 0) return events
  return events.filter((e) => e.pubkey === self || !hidesThing(muted, { authors: [e.pubkey], ids: [e.id] }, self))
}
