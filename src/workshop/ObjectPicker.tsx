/**
 * ObjectPicker.tsx - reading published objects for STAMP's LINK (DECK-0003
 * §1.10): an address typed or pasted, and the objects a key has published.
 * The picker itself is STAMP's library now (workshop/StampLibrary.tsx, owner
 * 2026-11-23), which lists your whole workshop library for COPY and LINK and
 * uses these for what LINK reaches beyond it. Before it:
 *
 * ONOSENDAI has no public feed, so the choice is the objects this key has
 * published (kind 33331, from snocrash or anywhere else), newest first, and a
 * field for anyone's object by address: an `naddr1…` or `33331:<pubkey>:<d>`.
 * Hidden objects (a 33331 whose payload is sealed to a place, DECK-0003 §3.4)
 * are left out: their content is a preview, not a shape. The choice is always
 * an `a` reference, which follows its author's newest version (arkinox,
 * 2026-09-25: NIP-01 lets relays drop old versions, so an `e` may find nothing).
 */

import { nip19 } from 'nostr-tools'
import { fromPayload, type ShardModel } from 'sno-core/shards'
import type { NostrEvent } from '../lib/events'
import { keepOwnTable } from '../lib/carried'

const OBJECT_KIND = 33331

export interface Found { address: string; relay?: string; shard: ShardModel; at: number }

/** An `naddr1…` or a bare `33331:<pubkey hex>:<d>`, as the address and an optional relay hint; null otherwise. */
export function parseObjectAddress(input: string): { address: string; relay?: string } | null {
  const t = input.trim()
  if (/^33331:[0-9a-f]{64}:.+$/.test(t)) return { address: t }
  try {
    const d = nip19.decode(t.replace(/^nostr:/, ''))
    if (d.type !== 'naddr' || d.data.kind !== OBJECT_KIND) return null
    return { address: `${OBJECT_KIND}:${d.data.pubkey}:${d.data.identifier}`, relay: d.data.relays?.[0] }
  } catch { return null }
}

/** The newest version of each of an author's objects, without hidden ones or anything unreadable. */
export function objectsOf(events: NostrEvent[]): Found[] {
  const newest = new Map<string, NostrEvent>()
  for (const ev of events) {
    if (ev.kind !== OBJECT_KIND || ev.tags.some((t) => t[0] === 'encrypted')) continue
    const d = ev.tags.find((t) => t[0] === 'd')?.[1]
    if (!d || d === 'avatar') continue
    const key = `${ev.pubkey}:${d}`
    const have = newest.get(key)
    if (!have || ev.created_at > have.created_at) newest.set(key, ev)
  }
  const out: Found[] = []
  for (const [key, ev] of newest) {
    let raw: unknown
    try { raw = JSON.parse(ev.content) } catch { continue }
    const read = fromPayload(raw, key)
    const shard = read && keepOwnTable(read, ev.pubkey)
    if (shard) out.push({ address: `${OBJECT_KIND}:${key}`, shard, at: ev.created_at })
  }
  return out.sort((a, b) => b.at - a.at)
}

/**
 * A published object's folder ref is its `d`: an object published from the
 * workshop has its model's id there, so it shows in the folder its model is
 * in (hud/ShardFolders).
 */
export const foundRef = (o: Found): string => o.address.split(':').slice(2).join(':')
