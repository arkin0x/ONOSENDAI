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
import { useCeremony } from '../store/useCeremony'
import { SCAN_MAX_HEIGHT, useShards } from '../store/useShards'
import { useSecrets, type CurrentKey } from '../store/useSecrets'
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
  const plane = useCyberspace((s) => s.anchorPlane)
  const worker = useRef<Worker | null>(null)
  const lastSig = useRef<string | null>(null)
  const reqId = useRef(0)

  useEffect(() => {
    worker.current = new Worker(new URL('../workers/region.worker.ts', import.meta.url), { type: 'module' })
    return () => {
      worker.current?.terminate()
      worker.current = null
      // The scan below skips a region it has already asked about. A terminated
      // worker never answered, so the memory of having asked has to go with it,
      // or the next worker is never asked anything. In development React mounts
      // effects twice, which is exactly this: the first worker was killed
      // mid-scan and the second sat idle, so nothing was ever found.
      lastSig.current = null
      useShards.getState().setScanning(false)
    }
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
    const heights = new Map<string, number>() // lookupId -> the cube's height

    const onMessage = (e: MessageEvent<RegionResponse>): void => { void handle(e) }
    const handle = async (e: MessageEvent<RegionResponse>): Promise<void> => {
      const msg = e.data
      if (msg.id !== id) return
      if (msg.type === 'key') {
        keys.set(msg.key.lookupId, msg.key.keyHex)
        heights.set(msg.key.lookupId, msg.key.height)
        return
      }
      if (msg.type === 'error') {
        // A scan that dies took SCANNING with it; leaving the tag lit forever
        // said the machine was still looking when it had stopped.
        w.removeEventListener('message', onMessage)
        useShards.getState().setScanning(false)
        console.warn('[discovery] region worker failed:', msg.message)
        return
      }
      if (msg.type !== 'done') return
      w.removeEventListener('message', onMessage)
      if (keys.size === 0) { useShards.getState().setScanning(false); return }

      // The chat needs these before the relay answers, and whether it answers:
      // an envelope said in one of these cubes opens with one of these keys.
      const current: Record<string, CurrentKey> = {}
      for (const [lookupId, keyHex] of keys) current[lookupId] = { keyHex, height: heights.get(lookupId) ?? 0 }
      useSecrets.getState().setCurrent(current)

      // A superseded scan must not write stale finds.
      const events = await query({ kinds: [HIDDEN_KIND], '#d': [...keys.keys()] })
      if (id !== reqId.current) return

      const found = []
      const opened: string[] = []
      for (const ev of events) {
        const region = ev.tags.find((t) => t[0] === 'd')?.[1]
        const keyHex = region ? keys.get(region) : undefined
        if (!keyHex || !region) continue
        // One envelope holds a bag; unbag flattens it to items.
        const items = await unbag(ev, hexToBytes(keyHex))
        if (items.length > 0) opened.push(region)
        found.push(...items)
      }

      /*
       * Which keys are worth keeping.
       *
       * Every position is inside thirteen cubes, and this machine computes all
       * thirteen every time you cross into a new one, so holding them all made
       * the Secrets list a record of where the camera had been. Worse, the scan
       * runs at the anchor, and the anchor follows exploring, spectating and
       * the free view: regions were being marked as yours because you had
       * looked at them.
       *
       * A key is kept when it opened something. That is the one that means
       * anything: it says there is something here and you can read it. The
       * rest cost milliseconds to compute again the moment you stand there.
       */
      if (opened.length > 0 && useCyberspace.getState().atHead()) {
        const now = Math.floor(Date.now() / 1000)
        useSecrets.getState().hold(opened.map((region) => ({
          lookupId: region,
          keyHex: keys.get(region)!,
          height: heights.get(region) ?? 0,
          base: {
            x: String(base(anchor.x, heights.get(region) ?? 0)),
            y: String(base(anchor.y, heights.get(region) ?? 0)),
            z: String(base(anchor.z, heights.get(region) ?? 0)),
          },
          plane,
          source: 'scan' as const,
          at: now,
        })))
      }
      if (id === reqId.current) {
        const known = useShards.getState().discovered
        const fresh = found.filter((h) => !known[h.eventId])
        useShards.getState().addDiscovered(found)
        useShards.getState().setScanning(false)
        // The ceremony: only for what this scan opened for the first time.
        useCeremony.getState().mark(fresh)
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
