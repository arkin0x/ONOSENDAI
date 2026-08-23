/**
 * useDiscovery.ts — scan for chalk near where you are looking.
 *
 * Spec §7.4: at a coordinate you scan heights, compute each region's lookup_id,
 * and ask the relay for encrypted content published under them. The keys come
 * from the region worker, off the frame; the relay query and the decryption
 * are here. What decrypts goes into the shard store and appears in the world.
 *
 * The scan re-runs when the anchor crosses into a new region, not on every
 * gibson: §7.5 says an aligned subtree of height h changes only when you cross
 * a boundary at that height, so a key stays valid until you do, and there is
 * nothing to recompute until then.
 */

import { useEffect, useRef } from 'react'
import { query } from '../lib/relay'
import { unbag, HIDDEN_KIND } from '../lib/hidden'
import { hexToBytes } from '../lib/events'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from '../store/useCyberspace'
import { SCAN_MAX_HEIGHT, useShards } from '../store/useShards'
import type { RegionRequest, RegionResponse } from '../workers/region.worker'

/** The aligned base of a value at a height: what decides "same region". */
function base(v: bigint, h: number): bigint {
  return (v >> BigInt(h)) << BigInt(h)
}

/** A signature of which regions the current anchor sits in, all heights. */
function regionSignature(x: bigint, y: bigint, z: bigint): string {
  let sig = ''
  for (let h = 0; h <= SCAN_MAX_HEIGHT; h++) sig += `${base(x, h)},${base(y, h)},${base(z, h)};`
  return sig
}

export function useDiscovery(): void {
  const anchor = useCyberspace((s) => s.anchor)
  const worker = useRef<Worker | null>(null)
  const lastSig = useRef<string | null>(null)
  const reqId = useRef(0)

  useEffect(() => {
    worker.current = new Worker(new URL('../workers/region.worker.ts', import.meta.url), { type: 'module' })
    return () => { worker.current?.terminate(); worker.current = null }
  }, [])

  useEffect(() => {
    const sig = regionSignature(anchor.x, anchor.y, anchor.z)
    if (sig === lastSig.current) return
    lastSig.current = sig

    const id = ++reqId.current
    const w = worker.current
    if (!w) return
    useShards.getState().setScanning(true)

    // Collect this scan's keys, then query the relay once for all of them.
    const keys = new Map<string, string>() // lookupId -> keyHex

    const onMessage = (e: MessageEvent<RegionResponse>): void => { void handle(e) }
    const handle = async (e: MessageEvent<RegionResponse>): Promise<void> => {
      const msg = e.data
      if (msg.id !== id) return
      if (msg.type === 'key') {
        keys.set(msg.key.lookupId, msg.key.keyHex)
        return
      }
      if (msg.type !== 'done') return
      w.removeEventListener('message', onMessage)
      if (keys.size === 0) return

      // A superseded scan must not write stale finds.
      const events = await query({ kinds: [HIDDEN_KIND], '#d': [...keys.keys()] })
      if (id !== reqId.current) return

      const found = []
      for (const ev of events) {
        const region = ev.tags.find((t) => t[0] === 'd')?.[1]
        const keyHex = region ? keys.get(region) : undefined
        if (!keyHex) continue
        // One envelope holds a bag; unbag flattens it to items.
        found.push(...await unbag(ev, hexToBytes(keyHex)))
      }
      if (id === reqId.current) {
        useShards.getState().addDiscovered(found)
        useShards.getState().setScanning(false)
      }
    }

    w.addEventListener('message', onMessage)
    const request: RegionRequest = {
      id,
      x: anchor.x.toString(),
      y: anchor.y.toString(),
      z: anchor.z.toString(),
      heights: Array.from({ length: SCAN_MAX_HEIGHT + 1 }, (_, h) => h),
      maxComputeHeight: MAX_COMPUTE_HEIGHT,
    }
    w.postMessage(request)

    return () => w.removeEventListener('message', onMessage)
  }, [anchor])
}
