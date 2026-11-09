/**
 * sealed.ts: sealed entries, kind 33335 (spec §7.6 "Sealed entries", merged
 * 2026-11-09, cyberspace #89).
 *
 * A sealed entry is one entry of a bag published as its own event, so that it
 * takes almost no space in the bag: its encrypted payload is exactly the item
 * the bag would otherwise hold inline (any kind but a door, signed or a rumor,
 * byte for byte), sealed with the bag's own key (the region key, or the room
 * key at any depth), and the bag names it with an ordinary `a` reference. A
 * reader that opens the bag opens the sealed entry with the same key and reads
 * the item exactly as if it stood inline: same id, same lineage, same place,
 * same author. Only where the entry is stored changes.
 *
 * The event says nothing about the entry: the same preview sentence on every
 * one, a fresh random `d`, the `encrypted` tag, an optional `alt`, and nothing
 * else (no `client` tag: lib/client.ts leaves the kind unattributed).
 *
 * This file holds what is pure about them, and the two relay sequences (send a
 * bag after its sealed entries; retract a sealed entry a bag stopped naming)
 * with the relays injected, so both run against a mock in tests. The reader is
 * lib/hidden.ts fromReference; the writer's plan is lib/bagFit.ts; the store
 * wires both in store/useShards.ts.
 */

import { normalizeURL } from 'nostr-tools/utils'
import { ALGO, decryptForRegion, encryptForRegion } from './shardCrypto'
import type { EventTemplate, NostrEvent } from './events'

/** The sealed entry's kind: addressable, beside the bag (33330) and the object (33331). */
export const SEALED_KIND = 33335
/** FF-1's key derivation for a key computed from a place (spec §7.6 References); the same string lib/hidden.ts writes. */
const REGION_DERIVATION = 'cyberspace:region'
/**
 * The preview every sealed entry carries as its `content` and its `alt`
 * (spec §7.6, "The event"): the same sentence on every one, so no two differ
 * in anything but their `d`, ciphertext, time and signature.
 */
export const SEALED_PREVIEW = 'This is hidden at a place in cyberspace. Find it with ONOSENDAI: https://onosendai.tech'

/** Tags a reader drops a sealed entry for (Reading): each says where the entry is, which only the key may say. */
const PLACE_TAGS: ReadonlySet<string> = new Set(['C', 'H', 'h', 'hint', 'X', 'Y', 'Z', 'S'])

/** A fresh `d` for one placement: 16 bytes from a cryptographically secure source, 32 lowercase hex, derived from nothing. */
export function freshSealedD(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The address a sealed entry of `pubkey` under `d` has: `33335:<pubkey>:<d>`. */
export function sealedAddress(pubkey: string, d: string): string {
  return `${SEALED_KIND}:${pubkey}:${d}`
}

/** The parts of an `a` reference to a sealed entry, or null when the reference names something else. */
export function sealedRefParts(ref: readonly string[]): { pubkey: string; d: string } | null {
  if (ref[0] !== 'a' || typeof ref[1] !== 'string') return null
  const [kind, pubkey, ...rest] = ref[1].split(':')
  if (kind !== String(SEALED_KIND) || !/^[0-9a-f]{64}$/.test(pubkey ?? '')) return null
  return { pubkey, d: rest.join(':') }
}

/** Whether a bag entry is an `a` reference to a sealed entry (of anyone). */
export function isSealedRef(e: unknown): e is string[] {
  return Array.isArray(e) && sealedRefParts(e as string[]) !== null
}

/**
 * The template of a sealed entry holding `item`, sealed with the bag's key:
 * the preview, `d`, the one `encrypted` tag, `alt`, and nothing else (spec
 * §7.6, "The event"). The payload is the item's JSON exactly as the bag would
 * carry it inline, `C`, `-` and lineage `d` included.
 */
export async function sealedTemplate(item: object, key: Uint8Array, d: string, createdAt: number): Promise<EventTemplate> {
  const ciphertext = await encryptForRegion(key, JSON.stringify(item))
  return {
    kind: SEALED_KIND,
    created_at: createdAt,
    content: SEALED_PREVIEW,
    tags: [['d', d], ['encrypted', ALGO, ciphertext, REGION_DERIVATION], ['alt', SEALED_PREVIEW]],
  }
}

/** The `a` reference a bag names a sealed entry by (spec §7.6 Writing): its address, the relay hint, and the item's own `C`. */
export function sealedReference(pubkey: string, d: string, hint: string, coordHex: string): string[] {
  return ['a', sealedAddress(pubkey, d), hint, coordHex]
}

/**
 * Why a fetched sealed entry is not read, or null when it is (spec §7.6
 * Reading, rules 1 to 3, before the payload): signed by someone other than
 * the bag's signer, not of the kind, carrying a tag that says where it is,
 * or emptied (no `encrypted` tag, Retracting), which is a missing entry.
 */
export function sealedEventRefusal(ev: Pick<NostrEvent, 'kind' | 'pubkey' | 'tags'>, bagSigner: string): 'signer' | 'kind' | 'placed' | 'emptied' | 'cipher' | null {
  if (ev.kind !== SEALED_KIND) return 'kind'
  if (ev.pubkey !== bagSigner) return 'signer'
  if (ev.tags.some((t) => PLACE_TAGS.has(t[0]))) return 'placed'
  const enc = ev.tags.filter((t) => t[0] === 'encrypted')
  if (enc.length === 0) return 'emptied'
  if (enc.length !== 1 || enc[0][1] !== ALGO || !enc[0][2]) return 'cipher'
  return null
}

/** An inline item as a payload decrypts to it, before it is checked as an item. */
export interface SealedItem { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig?: string }

/**
 * Why a decrypted payload is refused, or null with the item (spec §7.6
 * Reading, rule 4): not a single JSON object that is a nostr event (a
 * reference, a list, opaque bytes), itself a sealed entry, or a door (a chest
 * that carries a `door` tag), whose room is then never opened.
 */
export function sealedPayload(plain: string): { item: SealedItem; refused: null } | { item: null; refused: 'shape' | 'nested' | 'door' } {
  let parsed: unknown
  try { parsed = JSON.parse(plain) } catch { return { item: null, refused: 'shape' } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { item: null, refused: 'shape' }
  const ev = parsed as Partial<SealedItem>
  if (typeof ev.kind !== 'number' || typeof ev.pubkey !== 'string' || typeof ev.id !== 'string' || typeof ev.content !== 'string' || typeof ev.created_at !== 'number') return { item: null, refused: 'shape' }
  if (!Array.isArray(ev.tags) || !ev.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === 'string'))) return { item: null, refused: 'shape' }
  if (ev.kind === SEALED_KIND) return { item: null, refused: 'nested' }
  // A door is a chest that carries a `door` tag (DECK-0004 §3.7), well formed or not: never read from a sealed entry.
  if (ev.kind === 3341 && ev.tags.some((t) => t[0] === 'door')) return { item: null, refused: 'door' }
  return { item: ev as SealedItem, refused: null }
}

/** Open a sealed entry's payload with the bag's key: the decrypted JSON, or null when it does not open (a missing entry). */
export async function openSealed(ev: Pick<NostrEvent, 'tags'>, key: Uint8Array): Promise<string | null> {
  const enc = ev.tags.find((t) => t[0] === 'encrypted')
  if (!enc || enc[1] !== ALGO || !enc[2]) return null
  return decryptForRegion(key, enc[2])
}

/**
 * The items sealed entries were read or written to hold, by address: what
 * §7.7 counts a sealed entry by ("read when opening or kept when sealing"),
 * what a rewrite matches a row of yours against when its item now stands in a
 * sealed entry, and the event a retraction empties. Session-local and bounded,
 * least recently touched first out; it holds plaintext, so it goes with the
 * identity (forgetSealedItems).
 */
const KEPT_SEALED = 4096
const sealedItems = new Map<string, { item: SealedItem; event?: NostrEvent }>()

/** Note that the sealed entry at `address` holds `item` (and is `event`, when known). */
export function rememberSealed(address: string, item: SealedItem, event?: NostrEvent): void {
  const was = sealedItems.get(address)
  sealedItems.delete(address)
  sealedItems.set(address, { item, event: event ?? (was && was.item.id === item.id ? was.event : undefined) })
  while (sealedItems.size > KEPT_SEALED) sealedItems.delete(sealedItems.keys().next().value as string)
}

/** The item a reference's sealed entry is known to hold, or undefined (unread: counts as nothing, §7.7). */
export function sealedItemOf(ref: readonly string[]): SealedItem | undefined {
  return ref[0] === 'a' && typeof ref[1] === 'string' ? sealedItems.get(ref[1])?.item : undefined
}

/** The signed sealed entry last seen at a reference's address, when known. */
export function sealedEventOf(ref: readonly string[]): NostrEvent | undefined {
  return ref[0] === 'a' && typeof ref[1] === 'string' ? sealedItems.get(ref[1])?.event : undefined
}

/** Forget every sealed item: on a change of identity, and in tests. */
export function forgetSealedItems(): void {
  sealedItems.clear()
}

/** The emptied sealed entry (spec §7.6 Retracting): only its `d`, an empty `content`, no `encrypted` tag. */
export function emptiedTemplate(d: string, createdAt: number): EventTemplate {
  return { kind: SEALED_KIND, created_at: createdAt, content: '', tags: [['d', d]] }
}

/**
 * The NIP-09 deletion of a sealed entry (spec §7.6 Retracting): its address,
 * an `e` tag for each event (the ciphertext it replaced, then the emptied
 * one), and `k`.
 */
export function sealedDeletionTemplate(pubkey: string, d: string, eventIds: readonly string[], createdAt: number): EventTemplate {
  return { kind: 5, created_at: createdAt, content: '', tags: [['a', sealedAddress(pubkey, d)], ...eventIds.map((id) => ['e', id]), ['k', String(SEALED_KIND)]] }
}

/** A relay publish, as lib/relay.ts publishMany answers. */
export type Publish = (relays: string[], event: NostrEvent) => Promise<{ ok: boolean; accepted?: string[] }>

/** What sending a bag after its sealed entries needs. */
export interface SendDeps {
  publish: Publish
  /** Retract the sealed entries a bag that was just published no longer names (retractSealed, bound). */
  retract?: (ref: string[]) => Promise<void>
}

/** A relay URL as lib/relay.ts reports what took an event. */
function norm(url: string): string {
  try { return normalizeURL(url) } catch { return url }
}

/**
 * A signed sealed entry going out before the bag that names it, and the relay
 * its reference names. `fresh` when it was sealed for this very bag: only such
 * an entry is retracted when the bag does not go out, since one carried from
 * an earlier version may still be the one a row of yours names.
 */
export interface OutgoingSealed { event: NostrEvent; hint: string; fresh?: boolean }

/** The reference that names a signed sealed entry, for retracting it. */
function refOf(s: OutgoingSealed): string[] {
  return ['a', sealedAddress(s.event.pubkey, s.event.tags.find((t) => t[0] === 'd')?.[1] ?? ''), s.hint]
}

/**
 * Send a bag after the sealed entries it names (spec §7.6 Writing): each goes
 * first to the relay its reference names, which must take it, then to the
 * other relays; the bag goes only to the relays that took every one, so a
 * reader who asks one relay never finds the bag without its entries. When the
 * bag cannot go out (the hinted relay refused an entry, no relay took them
 * all, or no relay took the bag), the entries sealed for it that did go out
 * are retracted, since no bag names them. Once the bag is out, the sealed
 * entries the bag before it named and this one does not (`dropped`) are
 * retracted.
 */
export async function sendBagWithSealed(relays: string[], bag: NostrEvent, sealed: readonly OutgoingSealed[], dropped: readonly string[][], deps: SendDeps): Promise<{ ok: boolean; accepted: string[]; reason?: string }> {
  let open = [...relays]
  const out: OutgoingSealed[] = []
  const undo = async (reason: string): Promise<{ ok: false; accepted: string[]; reason: string }> => {
    for (const done of out) if (done.fresh) await deps.retract?.(refOf(done)).catch(() => undefined)
    return { ok: false, accepted: [], reason }
  }
  for (const s of sealed) {
    const first = s.hint && relays.includes(s.hint) ? [s.hint] : []
    const rest = relays.filter((r) => !first.includes(r))
    const head = first.length > 0 ? await deps.publish(first, s.event).catch(() => ({ ok: false as const })) : null
    if (head && !head.ok) return undo('No relay took an entry moved out of the bag. Nothing was sent.')
    if (head) out.push(s)
    const tail = rest.length > 0 ? await deps.publish(rest, s.event).catch(() => ({ ok: false as const, accepted: [] as string[] })) : { ok: true, accepted: [] as string[] }
    // A relay that did not say it took this entry gets no bag naming it.
    const took = new Set([...first, ...(tail.accepted ?? (tail.ok ? rest : []))].map(norm))
    if (!head && took.size > 0) out.push(s)
    if (took.size === 0) return undo('No relay took an entry moved out of the bag. Nothing was sent.')
    open = open.filter((r) => took.has(norm(r)))
  }
  if (open.length === 0) return undo('No relay took every entry moved out of the bag. Nothing was sent.')
  const result = await deps.publish(open, bag).catch(() => ({ ok: false as const, accepted: [] as string[] }))
  if (!result.ok) return undo('No relay took the bag.')
  for (const ref of dropped) await deps.retract?.(ref).catch(() => undefined)
  return { ok: true, accepted: result.accepted ?? open }
}

/** What retracting a sealed entry needs. */
export interface RetractDeps {
  /** Whose key signs: only its own sealed entries are ever retracted. */
  me: string
  sign: (template: EventTemplate) => Promise<NostrEvent>
  publish: Publish
  /** The events at an address, as the relays answer, for the id of the one being replaced when it is not known. */
  fetch: (pubkey: string, d: string) => Promise<NostrEvent[]>
  relays: string[]
  now?: () => number
  /** The ciphertext event, when the caller knows it. */
  known?: NostrEvent
}

/**
 * Retract a sealed entry no bag names now (spec §7.6 Retracting), in two
 * steps: empty it (a newer event at the same address with only its `d`), which
 * takes the ciphertext off every relay that accepts the newer event whether or
 * not it honours deletions; then request its deletion, naming the address and
 * both events. The caller has already published the bag that stopped naming it:
 * a sealed entry is never emptied while the newest version of its bag names it.
 * Returns the two events sent, or null when there was nothing of ours to retract.
 */
export async function retractSealed(ref: readonly string[], deps: RetractDeps): Promise<{ emptied: NostrEvent; deletion: NostrEvent } | null> {
  const parts = sealedRefParts(ref)
  if (!parts || parts.pubkey !== deps.me || !parts.d) return null
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000)
  let current = deps.known
  if (!current) {
    const found = (await deps.fetch(parts.pubkey, parts.d).catch(() => [] as NostrEvent[]))
      .filter((e) => e.kind === SEALED_KIND && e.pubkey === parts.pubkey && e.tags.find((t) => t[0] === 'd')?.[1] === parts.d)
      .sort((a, b) => b.created_at - a.created_at)
    current = found[0]
  }
  // Already emptied: only the deletion is owed.
  const live = current && current.tags.some((t) => t[0] === 'encrypted') ? current : undefined
  const emptied = await deps.sign(emptiedTemplate(parts.d, Math.max(now, (current?.created_at ?? 0) + 1)))
  await deps.publish(deps.relays, emptied)
  const ids = [...(live ? [live.id] : current ? [current.id] : []), emptied.id]
  const deletion = await deps.sign(sealedDeletionTemplate(parts.pubkey, parts.d, ids, Math.max(now, emptied.created_at)))
  await deps.publish(deps.relays, deletion)
  sealedItems.delete(sealedAddress(parts.pubkey, parts.d))
  return { emptied, deletion }
}
