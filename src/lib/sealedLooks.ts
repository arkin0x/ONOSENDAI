/**
 * sealedLooks.ts: writing a chest's or a door's look as a SEALED LOOK
 * (DECK-0004 §3.6, "A look sealed as its own event"), so a custom look can be
 * far larger than what a `look` tag carries (lib/looks.ts MAX_LOOK_BYTES).
 *
 * A look in its tag rides in every rewrite of its bag, which is why a tag
 * carries at most MAX_LOOK_BYTES (arkinox, 2026-11-01: a look's bytes in every
 * bag were what filled it). A larger one goes exactly as a large hidden shard
 * goes (lib/hidden.ts objectTemplateOf): its payload is sealed with the key of
 * the bag that holds the chest (the region key, or the room key of a room
 * bag) into a kind 33331 hidden object under a fresh random `d`, signed by the
 * chest's signer, and the tag carries a small wrapper placing it, unturned at
 * the origin (sealedLookPayload). Exactly whoever can read the chest can draw
 * its look. Nothing about it is public but the hidden object's preview: the
 * look itself is never published in the clear.
 *
 * Reading is lib/looks.ts (sealedLookState): the chest is drawn without that
 * look until the object is fetched and opened, and opening the chest never
 * waits for it.
 *
 * The size limit of a sealed look is the size limit of one event of its own:
 * BAG_SAFE_BYTES (lib/bagSize.ts), what this client holds a bag and a sealed
 * entry to (lib/bagFit.ts sealFor), measured on the hidden object as signed.
 */

import { toPayload, fromPayload, type ShardModel } from 'sno-core/shards'
import { BAG_SAFE_BYTES, signedBytes } from './bagSize'
import { OBJECT_KIND, OBJECT_PREVIEW, REGION_KEY_DERIVATION, objectTemplateOf } from './hidden'
import { LOOK_TAG, MAX_LOOK_BYTES, lookRefusal, sealedLookAddress } from './looks'
import { ALGO, decryptForRegion } from './shardCrypto'
import { resolveReference } from './references'
import { verifyOnce } from './verifiedSigs'
import { bytesToHex, hexToBytes, type EventTemplate, type NostrEvent } from './events'
import { parseAddress } from 'sno-core/parts'

const bytesOf = (s: string): number => new TextEncoder().encode(s).length

/** How many hex characters a sealed look's fresh `d` has (store/useShards placementId: 16 random bytes). */
export const SEALED_LOOK_D_CHARS = 32

/**
 * The largest look payload, in UTF-8 bytes, whose hidden object fits the size
 * limit of one event (BAG_SAFE_BYTES) as this client signs it: the object's
 * own bytes (its preview, `d`, `alt`, client tag, id, pubkey and signature)
 * and the payload sealed (a 12-byte nonce and a 16-byte tag, base64,
 * lib/bagFit.ts sealedLength). Measured, not guessed: the same measure
 * sealFor holds a sealed entry to.
 */
export function sealedLookLimit(): number {
  const overhead = signedBytes(sealedLookShape(''))
  return Math.floor((BAG_SAFE_BYTES - overhead) / 4) * 3 - 28
}

/** A sealed look's hidden object as objectTemplateOf writes it, around a ciphertext of this text. */
function sealedLookShape(ciphertext: string): EventTemplate {
  // A ten-digit created_at, as every timestamp until the year 2286 is.
  return { kind: OBJECT_KIND, created_at: 9_999_999_999, content: OBJECT_PREVIEW, tags: [['d', '0'.repeat(SEALED_LOOK_D_CHARS)], ['alt', OBJECT_PREVIEW], ['encrypted', ALGO, ciphertext, REGION_KEY_DERIVATION]] }
}

/** Whether a look payload of this many bytes goes as a sealed look: more than a tag carries. */
export function sealsLook(bytes: number): boolean {
  return bytes > MAX_LOOK_BYTES
}

/**
 * The look a tag carries for a sealed look (§3.6): no geometry and no table,
 * one `a` ref naming the hidden object, one placement of it at the origin,
 * unturned, at its own size, under the sealed payload's name and unit, and
 * standing as it stands, so a reader that predates sealed looks draws its
 * placeholder where the look would stand.
 */
export function sealedLookPayload(payload: string, address: string, hint?: string): string {
  let inner: ShardModel | null = null
  try { inner = fromPayload(JSON.parse(payload), 'sealed-look') } catch { inner = null }
  const wrapper: ShardModel = {
    id: `look:${address}`, name: inner?.name ?? 'look', unit: inner?.unit ?? 0, extent: inner?.extent ?? 0, mode: 'solid',
    vertices: [], faces: [], up: inner?.up ?? false, spin: inner?.spin ?? 0, updatedAt: 0,
    refs: [hint ? ['a', address, hint] : ['a', address]],
    parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }],
  }
  return JSON.stringify(toPayload(wrapper))
}

/** The sealed looks a chest's `look` tags name, by address, under `author`: what a move reseals and a removal retracts. */
export function sealedLookAddresses(tags: readonly unknown[] | undefined, author: string): string[] {
  const out: string[] = []
  for (const t of tags ?? []) {
    if (!Array.isArray(t) || t[0] !== LOOK_TAG || typeof t[1] !== 'string') continue
    const address = wrapperAddress(t[1], author)
    if (address && !out.includes(address)) out.push(address)
  }
  return out
}

/** A look that names nothing (no `refs`): its own geometry, which sealAll seals. A wrapper, or a look that places live objects, stays as it is. */
function ownGeometry(payload: string): boolean {
  try {
    const p = JSON.parse(payload) as { refs?: unknown }
    return !Array.isArray(p.refs) || p.refs.length === 0
  } catch { return false }
}

function wrapperAddress(payload: string, author: string): string | null {
  // A wrapper is small; anything larger is a look in its own right.
  if (bytesOf(payload) > MAX_LOOK_BYTES) return null
  try {
    const model = fromPayload(JSON.parse(payload), 'look-wrapper')
    return model ? sealedLookAddress(model, author) : null
  } catch { return null }
}

/**
 * A sealed look's payload, fetched (lib/references.ts) and opened with the key
 * of the bag it was sealed for, or null: not fetched, not the author's, not
 * verifying, or not opening. A public object (no `encrypted` tag) is no sealed
 * look at all, but a FEED look of your own published object, which has the
 * same shape: `public`, and never moved, resealed or retracted as one.
 */
export async function openSealedLookPayload(address: string, keyHex: string, fetch: (ref: string[]) => Promise<NostrEvent | null> = resolveReference): Promise<{ payload: string; event: NostrEvent; public?: false } | { public: true; event: NostrEvent } | null> {
  const a = parseAddress(address)
  if (!a) return null
  const ev = await fetch(['a', address, '']).catch(() => null)
  if (!ev || ev.kind !== a.kind || ev.pubkey !== a.pubkey || ev.tags.find((t) => t[0] === 'd')?.[1] !== a.d || !verifyOnce(ev)) return null
  const enc = ev.tags.find((t) => t[0] === 'encrypted')
  if (!enc) return { public: true, event: ev }
  if (enc[1] !== ALGO || !enc[2] || enc[3] !== REGION_KEY_DERIVATION) return null
  const payload = await decryptForRegion(hexToBytes(keyHex), enc[2])
  return payload === null ? null : { payload, event: ev }
}

/** What sealing a chest's looks needs: the bag's key, its signer, and how to sign and send one object. */
export interface SealLooksIo {
  /** The key of the bag the chest goes into. */
  key: Uint8Array
  /** The chest's signer: every sealed look is theirs. */
  owner: string
  createdAt: number
  /** A fresh random `d`, SEALED_LOOK_D_CHARS hex characters. */
  newD: () => string
  sign: (template: EventTemplate) => Promise<NostrEvent>
  /** Send a signed object before anything names it: the relay that took it, '' while LOCAL (nothing is sent). Throws, in words, when no relay takes it. */
  send: (object: NostrEvent) => Promise<string>
  /**
   * A moved chest: the key of the bag it comes from, hex. A sealed look of
   * the owner's sealed under another key is opened with it and sealed again
   * under `key` at a fresh address (§3.6, Moving a sealed look).
   */
  fromKeyHex?: string
  /**
   * False for a look MOVE keeps as it is (store/useShards LookChoice `kept`: one
   * this client will not read): a payload in its tag stays exactly as written,
   * whatever its size, and only a sealed look is sealed again for a new bag.
   */
  sealLarge?: boolean
  /**
   * True for a chest near its cap (lib/chests.ts sealsLooksFor): every look
   * goes sealed, whatever its size, because a chest of 131,072 bytes leaves
   * about 3,900 bytes of its event for tags (DECK-0004 §3.2, Size) and the tag
   * that names a sealed look is under 300.
   */
  sealAll?: boolean
  /** Opens a sealed look under its old key (openSealedLookPayload by default). */
  open?: (address: string, keyHex: string) => Promise<{ payload: string; public?: false } | { public: true } | null>
}

/** The tags as they go into the chest, the objects sealed for them (sent already, or kept for BROADCAST while LOCAL), and the sealed looks they no longer name. */
export interface SealedLookTags {
  tags: string[][]
  objects: NostrEvent[]
  dropped: string[]
}

/** The words a move uses when a sealed look cannot be fetched to seal it again. */
export const LOOK_NOT_FETCHED = "This chest's model could not be fetched from your relays, so it was not moved. Try again when a relay answers."

/**
 * A chest's `look` tags as they go out (§3.6): each payload over
 * MAX_LOOK_BYTES sealed as its own hidden object with the bag's key and
 * named by a wrapper, refused in lookRefusal's words over sealedLookLimit;
 * each payload of a tag carries inline as it is. For a moved chest, a sealed
 * look sealed under another bag's key is opened and sealed again under this
 * one, at a fresh address, and its old address is `dropped`, to retract once
 * no bag names it. A sealed look already under this key is kept as it is. A
 * sealed look that cannot be opened stops the move, in words: carried as it
 * is, it would never open in its new bag.
 */
export async function sealLookTags(tags: readonly string[][], io: SealLooksIo): Promise<SealedLookTags> {
  const limit = sealedLookLimit()
  const toKeyHex = bytesToHex(io.key)
  const objects: NostrEvent[] = []
  const dropped: string[] = []
  const out: string[][] = []
  for (const t of tags) {
    if (t[0] !== LOOK_TAG || typeof t[1] !== 'string') { out.push([...t]); continue }
    let payload = t[1]
    const moved = io.fromKeyHex && io.fromKeyHex.toLowerCase() !== toKeyHex ? wrapperAddress(payload, io.owner) : null
    if (moved && io.fromKeyHex) {
      const opened = await (io.open ?? openSealedLookPayload)(moved, io.fromKeyHex)
      if (!opened) throw new Error(LOOK_NOT_FETCHED)
      // A FEED look of your own published object: a live placement, which moves as it is.
      if (opened.public) { out.push([...t]); continue }
      payload = opened.payload
      dropped.push(moved)
    }
    const bytes = bytesOf(payload)
    if (!(sealsLook(bytes) || (io.sealAll && ownGeometry(payload))) || (io.sealLarge === false && !moved)) { out.push([LOOK_TAG, payload, ...t.slice(2)]); continue }
    const refusal = lookRefusal(bytes, limit)
    if (refusal) throw new Error(refusal)
    const d = io.newD()
    const object = await io.sign(await objectTemplateOf(payload, io.key, d, io.createdAt))
    const hint = await io.send(object)
    objects.push(object)
    out.push([LOOK_TAG, sealedLookPayload(payload, `${OBJECT_KIND}:${io.owner}:${d}`, hint || undefined), ...t.slice(2)])
  }
  return { tags: out, objects, dropped }
}

/** The bytes of the largest look payload among these tags, and whether any of them goes sealed: what the hide bar's MODEL row shows. */
export function lookTagsSize(tags: readonly string[][]): { bytes: number; sealed: boolean } {
  let bytes = 0
  for (const t of tags) if (t[0] === LOOK_TAG && typeof t[1] === 'string') bytes = Math.max(bytes, bytesOf(t[1]))
  return { bytes, sealed: sealsLook(bytes) }
}
