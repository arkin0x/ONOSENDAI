/**
 * region.worker.ts — the cost of looking, off the main thread.
 *
 * Deriving a region key at height h is O(2^h) Cantor pairings per axis (spec
 * §7.4), which is exactly the work the protocol says looking must cost. That
 * work must not be on the frame's critical path, so it runs here: given a
 * coordinate and a set of heights, it computes the lookup_id and key for each
 * and posts them back. The main thread then asks the relay for those lookup
 * ids and decrypts what comes back.
 */

import { regionKeyAt } from '../lib/shardCrypto'
import { bytesToHex } from '../lib/events'

export interface RegionRequest {
  id: number
  x: string
  y: string
  z: string
  heights: number[]
  maxComputeHeight: number
}

export interface RegionKeyOut {
  height: number
  lookupId: string
  keyHex: string
}

export type RegionResponse =
  | { type: 'key'; id: number; key: RegionKeyOut }
  | { type: 'done'; id: number }
  | { type: 'error'; id: number; message: string }

self.onmessage = (event: MessageEvent<RegionRequest>) => {
  const { id, x, y, z, heights, maxComputeHeight } = event.data
  const pos = { x: BigInt(x), y: BigInt(y), z: BigInt(z) }
  try {
    // Low heights first: the near, cheap radii resolve immediately while the
    // wider, dearer ones are still grinding.
    for (const h of [...heights].sort((a, b) => a - b)) {
      const rk = regionKeyAt(pos, h, maxComputeHeight)
      const msg: RegionResponse = { type: 'key', id, key: { height: h, lookupId: rk.lookupId, keyHex: bytesToHex(rk.key) } }
      self.postMessage(msg)
    }
    self.postMessage({ type: 'done', id } satisfies RegionResponse)
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) } satisfies RegionResponse)
  }
}
