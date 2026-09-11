/**
 * regionKeyOffThread.ts — the region key at a height, computed off the main thread.
 *
 * The deploy used to derive its key inline, which at height 20 froze the page
 * for fifteen seconds on a desktop and minutes on a phone. The region worker
 * already computes exactly these keys for the passive scan; this asks it for
 * one. Where there is no Worker, as under the test runner, it computes inline.
 */

import { regionKeyAt } from './shardCrypto'
import { hexToBytes } from './events'
import type { Position } from './space'
import type { RegionRequest, RegionResponse } from '../workers/region.worker'

export interface KeyAtHeight {
  key: Uint8Array
  lookupId: string
}

let worker: Worker | null = null
let nextId = 1

export function regionKeyOffThread(at: Position, height: number, maxComputeHeight: number): Promise<KeyAtHeight> {
  if (typeof Worker === 'undefined') {
    const rk = regionKeyAt(at, height, maxComputeHeight)
    return Promise.resolve({ key: rk.key, lookupId: rk.lookupId })
  }
  if (!worker) worker = new Worker(new URL('../workers/region.worker.ts', import.meta.url), { type: 'module' })
  const w = worker
  const id = nextId++
  return new Promise((resolve, reject) => {
    let found: KeyAtHeight | null = null
    const onMessage = (e: MessageEvent<RegionResponse>): void => {
      const msg = e.data
      if (msg.id !== id) return
      if (msg.type === 'key' && msg.key.height === height) found = { key: hexToBytes(msg.key.keyHex), lookupId: msg.key.lookupId }
      if (msg.type === 'error') { w.removeEventListener('message', onMessage); reject(new Error(msg.message)) }
      if (msg.type === 'done') {
        w.removeEventListener('message', onMessage)
        if (found) resolve(found)
        else reject(new Error(`The region worker gave no key at height ${height}.`))
      }
    }
    w.addEventListener('message', onMessage)
    const request: RegionRequest = { id, x: at.x.toString(), y: at.y.toString(), z: at.z.toString(), heights: [height], maxComputeHeight }
    w.postMessage(request)
  })
}
