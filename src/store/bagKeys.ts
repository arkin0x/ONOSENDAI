/**
 * bagKeys.ts: the key that opens a bag, by its lookup id, from what this
 * device already holds (lib/commentSubjects.ts).
 *
 * A bag's lookup id is sha256 of its key, a region key or a room key alike
 * (spec §7.2, DECK-0004 §3.7.2), so a key is taken only when it fits
 * (regionKeyCheck keyFitsLookup): a key item held in ITEMS, whose row keeps
 * where it was found and never the key, opens its comments with the right
 * key, or with none. Read from the finds and hides here, the region keys
 * held and stood in, and the room keys known. Nothing is asked of a relay,
 * nothing is derived, and nothing is stored.
 */

import { keyFitsLookup } from '../lib/regionKeyCheck'
import { roomKeysNow } from './useKeyring'
import { useSecrets } from './useSecrets'
import { useShards } from './useShards'

/** The key, as hex, that opens the bag `lookupId`, when this device holds one that fits. */
export function bagKeyFor(lookupId: string): string | undefined {
  const id = lookupId.toLowerCase()
  const fits = (hex: string | undefined): hex is string => !!hex && keyFitsLookup(hex, id)
  const s = useShards.getState()
  for (const h of Object.values(s.discovered)) if (h.lookupId === id && fits(h.keyHex)) return h.keyHex
  for (const d of s.mine) if (d.lookupId === id && fits(d.keyHex)) return d.keyHex
  const secrets = useSecrets.getState()
  const held = secrets.keys[id]?.keyHex
  if (fits(held)) return held
  const here = secrets.current[id]?.keyHex
  if (fits(here)) return here
  for (const k of roomKeysNow()) if (k.lookupId === id && fits(k.keyHex)) return k.keyHex
  return undefined
}
