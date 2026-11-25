/**
 * builderStatus.ts - whether some of an author's builder keys are valid
 * (DECK-0009 §4.4), asked of one relay through `ask`. Kept apart from the
 * relay so tests hand it a relay that behaves like the real one.
 */

import { builderKeyValid } from './blockLayer'
import type { KeyStatus } from './layerReader'
import type { Filter } from 'nostr-tools/filter'
import type { NostrEvent } from '../events'

const ACTION = 3333
/** Pages of an author's movement actions read to find where a key is named. */
export const NAMING_PAGES = 20
export const NAMING_PAGE = 500

/** One relay's answer: its events, or the trouble that kept it from answering. */
export type AskRelay = (filter: Filter) => Promise<{ events: NostrEvent[]; trouble: unknown }>

/**
 * Retirements first, then the author's movement actions, newest first, until
 * each key's newest naming is found or there are none left. A key never
 * named is void; a read that fails, or a history longer than the pages read,
 * leaves it unknown (asked again later).
 *
 * The retirements are asked with two `#R` filters, one for the keys and one
 * for `all`, never one filter holding both (§4.3 writes them as one): the
 * canonical relay keeps a 64-hex tag value as 32 bytes and a short word as
 * text, and one filter mixing the two is refused ("could not query events")
 * when a key comes first (and may not match the keys when `all` does).
 * Refused, every key stayed unknown, so no one else's layer was ever drawn
 * (2026-11-25).
 */
export async function keyStatusOn(ask: AskRelay, author: string, keys: string[], verify: (e: NostrEvent) => boolean): Promise<Map<string, KeyStatus>> {
  const out = new Map<string, KeyStatus>()
  const own = (es: NostrEvent[]): NostrEvent[] => es.filter((e) => e.pubkey === author && e.kind === ACTION && verify(e))
  const hex = keys.filter((k) => /^[0-9a-f]{64}$/.test(k))
  const retirements: NostrEvent[] = []
  for (const values of [hex, ['all']]) {
    if (values.length === 0) continue
    const r = await ask({ kinds: [ACTION], authors: [author], '#R': values })
    if (r.trouble) return out
    retirements.push(...own(r.events))
  }
  const seen: NostrEvent[] = [...retirements]
  let left = keys.filter((k) => {
    if (retirements.some((e) => e.tags.some((t) => t[0] === 'builder-retire' && t[1] === k))) { out.set(k, 'void'); return false }
    return true
  })
  let until: number | undefined
  const ids = new Set(seen.map((e) => e.id))
  for (let page = 0; page < NAMING_PAGES && left.length; page++) {
    const got = await ask({ kinds: [ACTION], authors: [author], limit: NAMING_PAGE, ...(until !== undefined ? { until } : {}) })
    if (got.trouble) return out
    // A page may end inside a second: the next asks from that second again, and what was seen is skipped.
    const fresh = got.events.filter((e) => !ids.has(e.id))
    for (const e of fresh) ids.add(e.id)
    seen.push(...own(fresh))
    // Newest first: the first naming found is a key's newest.
    left = left.filter((k) => {
      if (!seen.some((e) => e.tags.some((t) => t[0] === 'builder' && t[1] === k))) return true
      out.set(k, builderKeyValid(k, seen) ? 'valid' : 'void')
      return false
    })
    // Nothing new: there are no more actions, so a key not named by now never was.
    if (fresh.length === 0) { for (const k of left) out.set(k, 'void'); return out }
    until = Math.min(...got.events.map((e) => e.created_at))
  }
  return out
}
