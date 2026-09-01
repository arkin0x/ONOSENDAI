/**
 * loot.ts — every bag on the relay, as a seeker sees it.
 *
 * A LootItem is the public face of a kind:33330 envelope: who hid it, the
 * region height it can be found from (the height hint, spec §8.6), when, how
 * much is inside, and the riddle if the hider wrote one into the content field
 * (cyberspace-cli's --hint does this). Where it is stays hidden: the lookup id
 * reveals nothing (spec §7.2). Geometric hints arrive with the spec amendment;
 * until then this list answers the newcomer's first question, "is there
 * anything out there?", with the count and the names.
 */

import type { NostrEvent } from './events'
import { ciphertextOf, heightHint, HIDDEN_KIND } from './hidden'
import { formatCellSize } from './scale'

export interface LootItem {
  /** The envelope's event id; changes when the hider rewrites the bag. */
  bagId: string
  /** The bag's stable identity: author plus lookup id (kind 33330 is addressable). */
  key: string
  author: string
  lookupId: string
  /** The height hint: the region height the bag is discoverable from. */
  height: number
  createdAt: number
  /** Approximate size of the hidden payload, in bytes. */
  bytes: number
  /** The hider's plaintext riddle from the content field, trimmed; empty when none. */
  riddle: string
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
  }
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

/** "exact gibson" at height 0, else the discovery radius as a cell size. */
export function heightLabel(height: number): string {
  return height === 0 ? 'exact gibson' : `within ${formatCellSize(height)}`
}

/** A payload size for a row: bytes below a kilobyte, one decimal of KB above. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}
