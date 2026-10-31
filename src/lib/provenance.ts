/**
 * provenance.ts: where a held item was obtained (arkinox, 2026-10-30: "on
 * the item details in the inventory it would be nice to have a record of
 * where the item was obtained and to View the chest where it was found or
 * the coordinate").
 *
 * The record is the inventory row itself, written when the item was taken
 * (lib/inventory.ts heldFromEntry, heldFromFind): the chest it came out of
 * (`from`), where that chest stands (`place`: its bag, point, plane and
 * height) and when (`at`). The row is kept per identity, in IndexedDB under
 * `${identity}/${item id}` (store/useInventory.ts), so one identity never
 * sees another's record; nothing here is a second store to keep in step
 * with it, and nothing is published. The first taking is the one kept:
 * holding is idempotent, so the same item met again in another chest leaves
 * the record as it was.
 */

import type { Plane } from 'cyberspace-core'
import { positionHex } from './events'
import type { HeldItem } from './inventory'
import type { Position } from './space'

/** Where an item was obtained, as its details show it. */
export interface Provenance {
  /** The chest it came out of, when it came out of one. */
  chest: { id: string; name: string } | null
  /** Where it was found: the chest's place, or the bag's for a find. */
  at: Position
  plane: Plane
  height: number
  /** That place as the 64 hex characters of a coordinate (a `C` tag's value). */
  coordinate: string
  /** Unix seconds when this identity came to hold it. */
  when: number
}

/** The record of where `item` was obtained, or null for one with no place (pasted from another device). */
export function provenanceOf(item: Pick<HeldItem, 'place' | 'from' | 'at'>): Provenance | null {
  const p = item.place
  if (!p) return null
  let at: Position
  try { at = { x: BigInt(p.at.x), y: BigInt(p.at.y), z: BigInt(p.at.z) } } catch { return null }
  let coordinate = ''
  try { coordinate = positionHex(at, p.plane) } catch { /* a point off the lattice: no coordinate to show */ }
  return {
    chest: item.from ? { id: item.from.chestId, name: item.from.chestName } : null,
    at,
    plane: p.plane,
    height: p.height,
    coordinate,
    when: item.at,
  }
}
