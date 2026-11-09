/**
 * regionKeyCheck.ts: a region key HOSAKA sold, checked before it is used.
 *
 * buyRegionKey used to check only that HOSAKA returned a key, never that it
 * was the right one, and a wrong key seals a bag nobody can find (a stranger
 * derives the right key from the coordinate and looks under its lookup id,
 * where nothing was filed). So a bought key is now checked as far as this
 * device can, and refused when any check fails: it is never kept, and never
 * seals or opens anything.
 *
 * What can be checked, cheapest first:
 *
 * 1. Its own shape: `lookup_id = sha256(secret_key)` (spec §7.2), a 32-byte
 *    key, and the cube asked for (its height, its aligned base). Always.
 * 2. The lookup id the caller expects, when it has one: finding a bag, the
 *    bag's `d` tag is the lookup id, so the key must hash to it.
 * 3. The key this device derives from the coordinate, when it can: at most
 *    MAX_COMPUTE_HEIGHT and within this device's calibrated ceiling. A key is
 *    bought because the device is too slow, so this is usually skipped.
 *
 * The gap: hiding (a deploy) has no lookup id to compare against yet, and
 * above this device's ceiling nothing HOSAKA returns lets the client tell the
 * right cube's key from a well-formed key of another cube without redoing the
 * Cantor work. hosaka-api's region_key job result (routes/region_key.py,
 * hop_core.run_region_key_core) carries `secret_key`, `lookup_id`, `height`,
 * `base`, and `region_n`, a file envelope ({file_id, download_url,
 * secret_key, public_proof, size_bytes}) for region_n's bytes. Downloading
 * region_n proves only that sha256(region_n) is the key, not that region_n is
 * the coordinate's: that takes the three axis trees again. So check 1 is all
 * a deploy above the ceiling gets, plus the row self-check after the deploy
 * (useShards: the stored lookup id must be sha256 of the stored key).
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from './events'
import { localKeyCeiling } from './deployPlan'
import { regionKeyOffThread } from './regionKeyOffThread'
import type { HosakaRegionKeyResult } from './hosaka'
import type { Position } from './space'

/** What the UI says when HOSAKA's key fails a check. */
export const WRONG_KEY = 'HOSAKA RETURNED A WRONG KEY'

/** The highest height this device may derive a region key at, as the store's MAX_COMPUTE_HEIGHT (imported from there would be a cycle). */
const MAX_DERIVE_HEIGHT = 20

const HEX64 = /^[0-9a-fA-F]{64}$/

/** The lookup id a key is filed under (spec §7.2): sha256 of the key, as hex. Rooms too (DECK-0004 §3.7.2). */
export function lookupIdOf(key: Uint8Array): string {
  return bytesToHex(sha256(key))
}

/** Whether a stored key and lookup id belong together: the lookup id is sha256 of the key. */
export function keyFitsLookup(keyHex: string, lookupId: string): boolean {
  if (!HEX64.test(keyHex) || !HEX64.test(lookupId)) return false
  return lookupIdOf(hexToBytes(keyHex.toLowerCase())) === lookupId.toLowerCase()
}

/** What the buyer asked for, and the lookup id it expects when it has one (finding a bag). */
export interface BoughtKeyAsk {
  at: Position
  height: number
  lookupId?: string
}

/**
 * Why a key HOSAKA returned is not the one asked for, from what it returned
 * alone (checks 1 and 2 above), or null when nothing is wrong with it.
 */
export function boughtKeyProblem(r: Pick<HosakaRegionKeyResult, 'secret_key' | 'lookup_id' | 'height' | 'base'>, ask: BoughtKeyAsk): string | null {
  if (typeof r.secret_key !== 'string' || !HEX64.test(r.secret_key)) return 'its key is not 32 bytes of hex'
  if (typeof r.lookup_id !== 'string' || !keyFitsLookup(r.secret_key, r.lookup_id)) return 'its lookup id is not the sha256 of its key'
  if (r.height !== undefined && r.height !== null && Number(r.height) !== ask.height) return `it is for height ${r.height}, not ${ask.height}`
  if (r.base) {
    const h = BigInt(ask.height)
    const want = { x: (ask.at.x >> h) << h, y: (ask.at.y >> h) << h, z: (ask.at.z >> h) << h }
    for (const axis of ['x', 'y', 'z'] as const) {
      let got: bigint
      try { got = BigInt(r.base[axis]) } catch { return 'it names a cube that cannot be read' }
      if (got !== want[axis]) return 'it is for another cube'
    }
  }
  if (ask.lookupId !== undefined && r.lookup_id.toLowerCase() !== ask.lookupId.toLowerCase()) return 'it is not the key to the bag it was bought for'
  return null
}

/**
 * Every check this device can make (1 to 3 above): null when the key may be
 * used, else why not. The derivation (3) runs off the main thread, only where
 * this device can afford it, and a derivation that fails proves nothing
 * either way, so it does not refuse the key.
 */
export async function checkBoughtKey(r: HosakaRegionKeyResult, ask: BoughtKeyAsk): Promise<string | null> {
  const plain = boughtKeyProblem(r, ask)
  if (plain) return plain
  if (ask.height > MAX_DERIVE_HEIGHT || ask.height > localKeyCeiling()) return null
  let mine: { key: Uint8Array; lookupId: string }
  try {
    mine = await regionKeyOffThread(ask.at, ask.height, MAX_DERIVE_HEIGHT)
  } catch {
    return null
  }
  if (bytesToHex(mine.key) !== r.secret_key.toLowerCase() || mine.lookupId !== r.lookup_id.toLowerCase()) return 'it is not the key this device derives from the coordinate'
  return null
}

/** The line the UI shows for a refused key: what happened, and that it was not used. */
export function wrongKeyMessage(why: string): string {
  return `${WRONG_KEY}: ${why}. It was not kept or used, and nothing was hidden or opened with it.`
}
