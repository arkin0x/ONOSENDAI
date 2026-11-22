/**
 * pieceKeys.ts: opening the SEALED PIECES a hidden shard places (DECK-0003
 * §1.10 with §3.4, "Sealed parts"), so a shard too big for one signature can
 * be split into pieces and hidden as one build (owner, 2026-11-22: "let's
 * move the carry work forward so we can split shards").
 *
 * A split build is a small parent shard that places its pieces by `a`
 * reference, and each piece is its own kind 33331 hidden object (§3.4):
 * sealed with the key of the bag that holds the parent, signed by the
 * parent's author, under a fresh random `d`. Nothing about a piece is public
 * but the hidden object's preview. A finder who opened the bag holds the key
 * that opens every piece, and nobody else does.
 *
 * Reading goes through the one cache every placed object comes through
 * (lib/parts.ts fetchRef), so the world, WALK's walls, pictures and the bench
 * all draw the pieces alike. What this file adds is the key: every bag item a
 * reader holds (store/useShards.ts notes rows and finds) says which addresses
 * its shard places under its own author, and with which bag key (notePieceKeys).
 * fetchRef opens a hidden object at one of those addresses with that key. A
 * piece that places pieces of its own passes its key on to them.
 *
 * Only addresses under the parent's author are noted: a sealed piece is the
 * parent author's own object (the pubkey that counts, §1.10). A reader with
 * the wrong key never opened the bag and so holds no key for its pieces; a
 * piece sealed under another bag's key does not open, and is a placeholder.
 */

import { parseAddress } from 'sno-core/parts'
import { ALGO, decryptForRegion } from './shardCrypto'
import { verifyOnce } from './verifiedSigs'
import { hexToBytes, type NostrEvent } from './events'

/** The kind of a hidden object (DECK-0003 §3.4), and so of a sealed piece. */
export const PIECE_KIND = 33331
/** FF-1's key derivation for a key computed from a place (DECK-0003 §3.4). */
const REGION = 'cyberspace:region'

/** Bag keys by the address of a piece they open, lowercase hex. */
const keys = new Map<string, Set<string>>()
/** Hears which addresses got a key for the first time: a draw that placed one and missed it asks again. */
const listeners = new Set<(addresses: ReadonlySet<string>) => void>()

/** Hear which addresses got a new key, once per noting; the return stops it. */
export function onPieceKeys(listener: (addresses: ReadonlySet<string>) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Note that `keyHex` opens the hidden object at `address`. True when it was not known. */
export function notePieceKey(address: string, keyHex: string): boolean {
  const k = keyHex.toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(k)) return false
  let held = keys.get(address)
  if (!held) keys.set(address, (held = new Set()))
  if (held.has(k)) return false
  held.add(k)
  return true
}

/**
 * The addresses a payload places that may be sealed pieces of `author`'s: every
 * `a` ref of a kind 33331 object under `author`, but none its own table holds
 * (a table entry is never fetched, §1.10). `refs` and `objects` as written in a
 * payload or a model: both are the same shapes.
 */
export function pieceAddresses(model: { refs?: unknown; objects?: unknown }, author: string | null | undefined): string[] {
  if (!author || !Array.isArray(model.refs)) return []
  const table = model.objects && typeof model.objects === 'object' && !Array.isArray(model.objects) ? (model.objects as Record<string, unknown>) : {}
  const out: string[] = []
  for (const r of model.refs) {
    if (!Array.isArray(r) || r[0] !== 'a' || typeof r[1] !== 'string') continue
    if (Object.prototype.hasOwnProperty.call(table, r[1]) || out.includes(r[1])) continue
    const a = parseAddress(r[1])
    if (a && a.kind === PIECE_KIND && a.pubkey === author) out.push(r[1])
  }
  return out
}

/**
 * Note the key of the bag a shard was read from for every piece it may place:
 * `author` is the shard's signer (the bag's, for an unsigned item), the one
 * pubkey whose pieces count. Says how many keys were new; listeners hear which, once.
 */
export function notePieceKeys(model: { refs?: unknown; objects?: unknown }, author: string | null | undefined, keyHex: string | null | undefined): number {
  if (!keyHex) return 0
  const fresh = new Set<string>()
  for (const address of pieceAddresses(model, author)) if (notePieceKey(address, keyHex)) fresh.add(address)
  if (fresh.size > 0) for (const l of listeners) l(fresh)
  return fresh.size
}

/** The keys noted for a piece's address, or none. */
export function pieceKeysFor(address: string): string[] {
  return [...(keys.get(address) ?? [])]
}

/** Addresses of pieces opened, so a change of identity can drop what was opened (forgetPieceKeys). */
const opened = new Set<string>()
const forgetListeners = new Set<(addresses: readonly string[]) => void>()

/** Note a piece opened here another way (sealed on this device, and its payload put in fetchRef's cache): dropped with the rest on a change of identity. */
export function markPieceOpened(address: string): void {
  opened.add(address)
}

/** Whether a piece at this address was opened, or sealed, on this device since the last change of identity: a sealed piece, not a live link. */
export function pieceWasOpened(address: string): boolean {
  return opened.has(address)
}

/** Hear which opened pieces to drop when every key is forgotten (lib/parts.ts drops them from its cache). */
export function onPiecesForgotten(listener: (addresses: readonly string[]) => void): () => void {
  forgetListeners.add(listener)
  return () => { forgetListeners.delete(listener) }
}

/** Forget every key and every piece opened with one: on a change of identity, and in tests. Says how many keys there were. */
export function forgetPieceKeys(): number {
  const n = keys.size
  keys.clear()
  const dropped = [...opened]
  opened.clear()
  for (const l of forgetListeners) l(dropped)
  return n
}

/** A hidden object's `encrypted` tag, when it has the form of DECK-0003 §3.4. */
function sealOf(ev: Pick<NostrEvent, 'tags'>): string[] | undefined {
  return ev.tags.find((t) => t[0] === 'encrypted')
}

/** Whether an event is a hidden object (DECK-0003 §3.4): an `encrypted` tag. A public object has none. */
export function isSealedObject(ev: Pick<NostrEvent, 'tags'>): boolean {
  return !!sealOf(ev)
}

/**
 * The payload of the piece at `address`, opened from `ev` with one of `keys`:
 * the JSON text, or null when it is not the event the address names, does not
 * verify, is not sealed in the form of §3.4, or opens with none of the keys.
 */
export async function openPiece(ev: NostrEvent, address: string, keyHexes: readonly string[]): Promise<string | null> {
  const a = parseAddress(address)
  if (!a || ev.kind !== a.kind || ev.pubkey !== a.pubkey || ev.tags.find((t) => t[0] === 'd')?.[1] !== a.d) return null
  const seal = sealOf(ev)
  if (!seal || seal[1] !== ALGO || !seal[2] || seal[3] !== REGION) return null
  if (!verifyOnce(ev)) return null
  for (const k of keyHexes) {
    const plain = await decryptForRegion(hexToBytes(k), seal[2]).catch(() => null)
    if (plain !== null) return plain
  }
  return null
}

/**
 * fetchRef's reading of a hidden object at an address (lib/parts.ts): undefined
 * when the event is no hidden object (a public object is read as before); else
 * its payload, parsed, opened with a key noted for the address, or null. What
 * it places under the same author is noted under the same key, so a piece's
 * own pieces open too.
 */
export async function readSealedPiece(ev: NostrEvent, address: string): Promise<unknown | null | undefined> {
  if (!isSealedObject(ev)) return undefined
  const held = pieceKeysFor(address)
  if (held.length === 0) return null
  const a = parseAddress(address)
  for (const k of held) {
    const plain = await openPiece(ev, address, [k])
    if (plain === null) continue
    let payload: unknown
    try { payload = JSON.parse(plain) } catch { return null }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    opened.add(address)
    notePieceKeys(payload as { refs?: unknown; objects?: unknown }, a?.pubkey, k)
    return payload
  }
  return null
}

/** Your own pieces signed here and not sent yet (a hide while LOCAL): fetchRef reads them before any relay. */
let localPieces: ((address: string) => NostrEvent | undefined) | null = null

/** Answer pieces from here first (store/useShards.ts wires the rows' unsent pieces), or stop (null). */
export function setLocalPieces(source: ((address: string) => NostrEvent | undefined) | null): void {
  localPieces = source
}

/** A piece of yours signed here and not sent yet, by its address, or undefined. */
export function localPiece(address: string): NostrEvent | undefined {
  return localPieces?.(address)
}
