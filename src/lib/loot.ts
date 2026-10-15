/**
 * loot.ts — every bag on the relay, as a seeker sees it.
 *
 * A LootItem is the public face of a kind:33330 envelope: who hid it, the
 * region height it can be found from (the height hint, spec §8.6), when, how
 * much is inside, and the riddle if the hider wrote one into the content field
 * (cyberspace-cli's --hint does this, and so does ONOSENDAI's deploy bar).
 * Where it is stays hidden unless the hider published a hint (spec §7.7): the
 * lookup id reveals nothing (spec §7.2). A sector hint names the sector, which
 * the row shows; the height may be withheld too, since `h` is optional (§8.6).
 */

import type { NostrEvent } from './events'
import { ciphertextOf, heightHint, HIDDEN_KIND } from './hidden'
import { parseHint, SECTOR_HEIGHT, type HintBox } from './hint'
import { formatCellSize } from 'sno-core/scale'

export interface LootItem {
  /** The envelope's event id; changes when the hider rewrites the bag. */
  bagId: string
  /** The bag's stable identity: author plus lookup id (kind 33330 is addressable). */
  key: string
  author: string
  lookupId: string
  /**
   * The height hint: the region height the bag is discoverable from, or null
   * when the hider did not publish it (`h` is optional, spec §8.6).
   */
  height: number | null
  createdAt: number
  /** Approximate size of the hidden payload, in bytes. */
  bytes: number
  /** The hider's plaintext riddle from the content field, trimmed; empty when none. */
  riddle: string
  /**
   * The sector the hider's hint names, as its `S` value "sx-sy-sz" (spec §7.7,
   * §10), or null when the bag carries no well-formed hint that fixes all
   * three axes. Sector tags that disagree with the hint are ignored (§7.7), so
   * this is computed from the hint, never read off `S`.
   */
  sector: string | null
  /** The hider's hint box (spec §7.7), or null when the bag carries no well-formed one. */
  hint: HintBox | null
}

const LOOKUP_ID = /^[0-9a-f]{64}$/

/**
 * Bytes behind an encoded ciphertext: hex is two chars a byte, base64 four
 * chars per three. A base64 string made only of hex-alphabet characters reads
 * as hex; random ciphertext of any real length never does, so the estimate is
 * honest where it matters and this is only ever a size for a row.
 */
export function payloadBytes(ciphertext: string): number {
  const s = ciphertext.trim()
  if (!s) return 0
  if (/^[0-9a-f]+$/i.test(s) && s.length % 2 === 0) return s.length / 2
  const padding = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((s.length * 3) / 4) - padding)
}

/** A kind:33330 event as a LootItem, or null when it is not a well-formed bag. */
export function summarizeBag(ev: NostrEvent): LootItem | null {
  if (ev.kind !== HIDDEN_KIND) return null
  const ciphertext = ciphertextOf(ev)
  if (!ciphertext) return null
  const lookupId = ev.tags.find((t) => t[0] === 'd')?.[1]?.toLowerCase()
  if (!lookupId || !LOOKUP_ID.test(lookupId)) return null
  return {
    bagId: ev.id,
    key: `${ev.pubkey}:${lookupId}`,
    author: ev.pubkey,
    lookupId,
    height: heightHint(ev),
    createdAt: ev.created_at,
    bytes: payloadBytes(ciphertext),
    riddle: ev.content.trim().replace(/\s+/g, ' '),
    sector: hintedSector(ev.tags, heightHint(ev) ?? 0),
    hint: parseHint(ev.tags, heightHint(ev) ?? 0),
  }
}

/**
 * The search a hint box asks of a seeker, as a power of two: one region key
 * per candidate region of the bag's height inside the box, summed over the
 * three axes (spec §7.7 "Why the hint is a knob"). An axis at 85 is open and
 * counts the whole axis.
 */
export function hintSearchExponent(hint: HintBox, bagHeight: number): number {
  return hint.heights.reduce((sum, h) => sum + Math.max(0, h - bagHeight), 0)
}

/** A hint box in words: a cube when the heights agree, a box otherwise, an open axis named. */
export function hintBoxLabel(hint: HintBox): string {
  const [hx, hy, hz] = hint.heights
  if (hx === hy && hy === hz) return hx === 85 ? 'all of cyberspace' : `a cube 2^${hx} gibsons on a side`
  const side = (h: number): string => (h === 85 ? 'open' : `2^${h}`)
  return `a box of ${side(hx)} by ${side(hy)} by ${side(hz)} gibsons`
}

/** The sector a well-formed hint fixes on all three axes, as "sx-sy-sz", or null (spec §7.7, §10). */
export function hintedSector(tags: string[][], bagHeight: number): string | null {
  const hint = parseHint(tags, bagHeight)
  if (!hint || hint.heights.some((h) => h > SECTOR_HEIGHT)) return null
  return [hint.base.x, hint.base.y, hint.base.z].map((v) => (v >> BigInt(SECTOR_HEIGHT)).toString()).join('-')
}

/**
 * Merge new items into a list: one entry per bag key, the newest version wins
 * (a rewritten bag replaces its older self), newest first.
 */
export function mergeLoot(prev: LootItem[], incoming: LootItem[]): LootItem[] {
  const byKey = new Map<string, LootItem>()
  for (const it of [...prev, ...incoming]) {
    const have = byKey.get(it.key)
    if (!have || it.createdAt > have.createdAt || (it.createdAt === have.createdAt && it.bagId < have.bagId)) byKey.set(it.key, it)
  }
  return [...byKey.values()].sort((a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key))
}

/**
 * The list after a backfill.
 *
 * A backfill that came back under its limit is the whole answer for that
 * relay set, so a bag missing from it is a bag the relay no longer has and it
 * goes. The list used to be the union of everything ever seen, kept on disk,
 * so a bag its hider took down stayed on screen for good and survived a
 * reload. An answer that hit the limit was cut short and says nothing about
 * what is missing, so nothing is dropped from it.
 */
export function afterBackfill(prev: LootItem[], found: LootItem[], limit: number): LootItem[] {
  return mergeLoot(found.length < limit ? [] : prev, found)
}

/**
 * The region a bag is encrypted to, as a size: a single gibson at height 0,
 * else the side of the aligned cube. Deliberately not "within X": on someone
 * else's bag that reads as a distance from the viewer, and where the bag is
 * stays hidden until its hider adds a hint. Null is a bag whose hider kept
 * the height to themselves.
 */
export function regionLabel(height: number | null): string {
  if (height === null) return 'height not published'
  return height === 0 ? 'single gibson' : `${formatCellSize(height)} cube`
}

/** A payload size for a row: bytes below a kilobyte, one decimal of KB above. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}
