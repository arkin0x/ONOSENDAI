/**
 * hidesAdopt.ts: a bag of yours opened from another device, with what the
 * record of your hides carries (lib/hidesRecord.ts, store/hidesSync.ts).
 */

import type { Filter } from 'nostr-tools/filter'
import { HIDDEN_KIND, dOf, unbag, type Hidden } from './hidden'
import { hexToBytes, type NostrEvent } from './events'
import { bagsToOpen } from './bagVersions'
import { resolveReference } from './references'
import type { HideEntry } from './hidesRecord'

/** How a bag is asked for: the relays' answer (lib/relay queryChecked), and any read (query, for deletions). */
export interface AdoptAsk {
  checked: (filter: Filter) => Promise<{ events: NostrEvent[] }>
  any: (filter: Filter) => Promise<NostrEvent[]>
}

/** Bags asked for in one read. */
const ADOPT_CHUNK = 50

/**
 * Open these bags of yours where they stand on the relays, with the keys the
 * record carries, and file what they hold as a scan files a find of your own:
 * only bags signed by you, and only items signed by you (claimOwn), join your
 * list. A bag its author deleted, or that no relay holds, opens nothing.
 */
export async function adoptEntries(entries: readonly HideEntry[], me: string, ask: AdoptAsk): Promise<Hidden[]> {
  const out: Hidden[] = []
  for (let i = 0; i < entries.length; i += ADOPT_CHUNK) {
    const chunk = entries.slice(i, i + ADOPT_CHUNK)
    const by = new Map(chunk.map((e) => [e.l, e]))
    const asked = await ask.checked({ kinds: [HIDDEN_KIND], authors: [me], '#d': chunk.map((e) => e.l) })
    const { bags } = await bagsToOpen(asked.events.filter((ev: NostrEvent) => ev.pubkey === me), ask.any)
    for (const ev of bags) {
      const e = by.get(dOf(ev))
      if (!e || ev.pubkey !== me) continue
      const h = BigInt(e.h)
      const base = { x: (BigInt(e.x) >> h) << h, y: (BigInt(e.y) >> h) << h, z: (BigInt(e.z) >> h) << h }
      try {
        const items = await unbag(ev, hexToBytes(e.k), resolveReference, { at: base, plane: e.p }, e.h, undefined, e.r ? { doorId: e.r } : undefined)
        out.push(...items.filter((it) => it.author === me))
      } catch { /* not this key's, or not readable: left for a scan */ }
    }
  }
  return out
}

