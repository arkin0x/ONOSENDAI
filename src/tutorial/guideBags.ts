/**
 * guideBags.ts: the tutorial guide's bags on this device, for discovery to
 * read as if a relay had sent them (first-arrival tutorial design,
 * 2026-11-10, D1 and the discovery adapter in §4).
 *
 * The guide key seals the blue box, the chests and the course with real
 * region keys and real signatures, and none of it is ever sent to a relay
 * (ruling D1). The stager (tutorial/stage.ts) puts the signed bags here; the
 * discovery scan (hooks/useDiscovery.ts) adds the ones under the lookup ids it
 * computed to what the relays answered, after the relays' own checks
 * (bagsToOpen asks relays about deletions by bag address, and the guide's
 * addresses are never asked about). From there a guide bag is opened like any
 * stranger's: with the region key the player computed by standing there, in
 * the stranger view, never as the player's own.
 *
 * Small on purpose and with no imports of weight: discovery imports it on
 * every page, and it holds nothing until the tutorial runs.
 */

import type { NostrEvent } from 'nostr-tools'

/** The guide's bags by lookup id (`d`); empty unless the tutorial is running. */
const byLookup = new Map<string, NostrEvent>()

/** Put the guide's bags in place of any before (null or empty takes them all away). */
export function setGuideBags(bags: readonly NostrEvent[] | null): void {
  byLookup.clear()
  for (const b of bags ?? []) {
    const d = b.tags.find((t) => t[0] === 'd')?.[1]
    if (d) byLookup.set(d, b)
  }
  for (const l of listeners) l()
}

/** The guide's bags under any of these lookup ids. */
export function guideBagsFor(lookupIds: Iterable<string>): NostrEvent[] {
  if (byLookup.size === 0) return []
  const out: NostrEvent[] = []
  for (const id of lookupIds) {
    const b = byLookup.get(id)
    if (b) out.push(b)
  }
  return out
}

/** Whether an event is one of the guide's bags on this device. */
export function isGuideBag(id: string): boolean {
  for (const b of byLookup.values()) if (b.id === id) return true
  return false
}

const listeners = new Set<() => void>()
/** Called whenever the guide's bags change, so a scan can run again where the player stands. */
export function onGuideBags(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
