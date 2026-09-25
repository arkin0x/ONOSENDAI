/**
 * references.ts - fetching the events a bag's reference entries name (spec §7.6).
 *
 * A reference is `["a", "<kind>:<pubkey>:<d>", relay, coord]`, which follows
 * its author's edits, or `["e", id, relay, coord]`, which pins one version.
 * The relay hint is tried first, then the user's relays. Discovery rescans
 * often, so each answer is kept for a minute; a miss is kept too, so a
 * missing object costs one query a minute rather than one per scan.
 */

import { queryAny, relaySet } from './relay'
import { entryKey, type Reference } from './hidden'
import type { NostrEvent } from './events'

const TTL_MS = 60_000
const cache = new Map<string, { at: number; event: Promise<NostrEvent | null> }>()

function relaysFor(ref: Reference): string[] {
  const hint = ref[2]
  const all = relaySet()
  return hint && /^wss?:\/\//.test(hint) && !all.includes(hint) ? [hint, ...all] : all
}

async function fetchReference(ref: Reference): Promise<NostrEvent | null> {
  if (ref[0] === 'e') {
    const found = await queryAny(relaysFor(ref), { ids: [ref[1]] })
    return found.find((e) => e.id === ref[1]) ?? null
  }
  const [kind, pubkey, ...rest] = ref[1].split(':')
  const k = Number(kind)
  if (!Number.isInteger(k) || !/^[0-9a-f]{64}$/.test(pubkey)) return null
  const found = await queryAny(relaysFor(ref), { kinds: [k], authors: [pubkey], '#d': [rest.join(':')] })
  // An address resolves to its newest event, as a relay keeps it.
  return found.sort((a, b) => b.created_at - a.created_at)[0] ?? null
}

/** The event a reference names, or null. Pass to unbag as its resolver. */
export function resolveReference(ref: Reference): Promise<NostrEvent | null> {
  const key = entryKey(ref)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.event
  const event = fetchReference(ref).catch(() => null)
  cache.set(key, { at: Date.now(), event })
  return event
}

/** Forget a cached answer, for example after publishing the object it names. */
export function forgetReference(ref: Reference): void {
  cache.delete(entryKey(ref))
}
