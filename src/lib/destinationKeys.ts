/**
 * destinationKeys.ts — the cubes around where a hop landed, held and scanned.
 *
 * A hop's own key opens a box: one LCA height per axis, the region the hop
 * crossed. Things are hidden in cubes, so that key almost never fits a lock.
 * What LOOT promises is arriving able to open what is hidden around the
 * landing point, and that means the cubes around the destination: for every
 * height from just above the passive scan's ceiling up to the hop's tallest
 * axis, the aligned cube of that side holding the destination. Each is a
 * region root like any other (three axis trees at that height, paired), so
 * the region worker computes them exactly as it computes the passive scan's
 * cubes, only higher, and only after a LOOT hop. Every key is held with the
 * hop as its source and scanned at once, so what it opens lands in the find
 * chip and the Nearby Loot list.
 *
 * On this machine the heights stop at its own ceiling. HOSAKA's hop result
 * can carry the same cubes computed there (`destination_keys`), for the
 * heights a phone cannot build, and those are held the same way.
 */

import { regionKeyAt } from './shardCrypto'
import { bytesToHex } from './events'
import type { Position } from './space'
import type { Plane } from 'cyberspace-core'
import { SCAN_MAX_HEIGHT } from '../store/useShards'
import { useSecrets, type HeldKey } from '../store/useSecrets'
import type { RegionRequest, RegionResponse } from '../workers/region.worker'

/** The heights of the cubes a hop with tallest axis `n` earns, on a machine that computes to `ceiling`. */
export function destinationHeights(n: number, ceiling: number, from: number = SCAN_MAX_HEIGHT + 1): number[] {
  const top = Math.min(n, ceiling)
  const out: number[] = []
  for (let h = from; h <= top; h++) out.push(h)
  return out
}

function alignedBase(at: Position, height: number): HeldKey['base'] {
  const h = BigInt(height)
  return { x: String((at.x >> h) << h), y: String((at.y >> h) << h), z: String((at.z >> h) << h) }
}

/** Scan the relay with a key just held: what it opens goes through the find chip. */
function scanKey(lookupId: string, keyHex: string): void {
  void import('../store/useShards').then((m) => m.useShards.getState().rescan(lookupId, keyHex)).catch(() => { /* a miss is a miss */ })
}

function holdAndScan(at: Position, plane: Plane, height: number, lookupId: string, keyHex: string, source: HeldKey['source'], eventId?: string): void {
  useSecrets.getState().hold([{ lookupId, keyHex, height, base: alignedBase(at, height), plane, source, eventId, at: Math.floor(Date.now() / 1000) }])
  scanKey(lookupId, keyHex)
}

let worker: Worker | null = null
let nextId = 1

/**
 * Compute the destination's cubes at these heights on this machine, hold each
 * as it arrives, and scan with it. Resolves when the worker is done; a worker
 * error resolves too, since the keys already held stay held.
 */
export function holdDestinationCubes(at: Position, plane: Plane, heights: number[], maxComputeHeight: number, source: HeldKey['source'] = 'hop', eventId?: string): Promise<number> {
  if (heights.length === 0) return Promise.resolve(0)
  if (typeof Worker === 'undefined') {
    let n = 0
    for (const h of heights) {
      const rk = regionKeyAt(at, h, maxComputeHeight)
      holdAndScan(at, plane, h, rk.lookupId, bytesToHex(rk.key), source, eventId)
      n++
    }
    return Promise.resolve(n)
  }
  if (!worker) worker = new Worker(new URL('../workers/region.worker.ts', import.meta.url), { type: 'module' })
  const w = worker
  const id = nextId++
  return new Promise((resolve) => {
    let n = 0
    const onMessage = (e: MessageEvent<RegionResponse>): void => {
      const msg = e.data
      if (msg.id !== id) return
      if (msg.type === 'key') { holdAndScan(at, plane, msg.key.height, msg.key.lookupId, msg.key.keyHex, source, eventId); n++ }
      if (msg.type === 'done' || msg.type === 'error') { w.removeEventListener('message', onMessage); resolve(n) }
    }
    w.addEventListener('message', onMessage)
    const request: RegionRequest = { id, x: at.x.toString(), y: at.y.toString(), z: at.z.toString(), heights, maxComputeHeight }
    w.postMessage(request)
  })
}

/** The cubes HOSAKA computed alongside a hop: held as bought, and scanned. */
export function holdCloudDestinationKeys(list: Array<{ height: number; secret_key: string; lookup_id: string }>, at: Position, plane: Plane): number {
  let n = 0
  for (const k of list) {
    if (!k || typeof k.height !== 'number' || !k.secret_key || !k.lookup_id) continue
    holdAndScan(at, plane, k.height, k.lookup_id, k.secret_key, 'cloud')
    n++
  }
  return n
}
