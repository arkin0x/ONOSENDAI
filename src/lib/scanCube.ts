/**
 * scanCube.ts - SCAN mode's arithmetic: which cube a scan at the cursor
 * covers, which heights this device computes for free and which HOSAKA sells,
 * and the one region key a local scan computes, off the main thread, in a
 * worker of its own so CANCEL can stop it.
 *
 * A scan at height H is the aligned cube of side 2^H holding the cursor: one
 * region root, the same three axis trees a hide at H is sealed with (spec
 * §7.2), so its key opens exactly what was hidden in that cube at that
 * height, and nothing else. One key per scan, not the ladder 12..H: the
 * heights below H are not nearly free (they add up to as much work again as
 * H itself), and a bought key is only ever the one cube, so a local and a
 * HOSAKA scan of the same height cover the same thing. The purple box is that
 * cube; stepping the height down and scanning again looks at a smaller one.
 *
 * Its own worker per scan, not the shared one the hop's destination cubes use
 * (lib/destinationKeys.ts): stopping a scan terminates its worker, and must
 * never stop a hop's.
 */

import type { Plane } from 'cyberspace-core'
import { regionKeyAt } from './shardCrypto'
import { bytesToHex } from './events'
import type { Position } from './space'
import type { HeldKey } from '../store/useSecrets'
import type { RegionKeyOut, RegionRequest, RegionResponse } from '../workers/region.worker'

/** The lowest scan height: the passive scan's ceiling (useShards SCAN_MAX_HEIGHT). The stepper starts here. */
export const SCAN_MIN_HEIGHT = 12

/** What the stepper knows about who computes what. */
export interface ScanRange {
  /** The highest height this device computes itself: its benchmark (localKeyCeiling), never under the minimum. */
  localMax: number
  /** The highest height on offer: HOSAKA's hop cap when HOSAKA is on and its limits are known, else localMax. */
  top: number
  /** HOSAKA can take the heights above localMax. */
  cloud: boolean
}

/** The stepper's range from the device's ceiling and HOSAKA's state. */
export function scanRange(localCeiling: number, cloudOn: boolean, cloudCap: number | null): ScanRange {
  const localMax = Math.max(SCAN_MIN_HEIGHT, localCeiling)
  const cloud = cloudOn && cloudCap !== null && cloudCap > localMax
  return { localMax, top: cloud ? cloudCap : localMax, cloud }
}

/** A height kept inside the range. */
export function clampScanHeight(height: number, range: ScanRange): number {
  return Math.max(SCAN_MIN_HEIGHT, Math.min(range.top, Math.round(height)))
}

/** The aligned corner of the cube of side 2^height holding `at`. */
export function scanBase(at: Position, height: number): Position {
  const h = BigInt(height)
  return { x: (at.x >> h) << h, y: (at.y >> h) << h, z: (at.z >> h) << h }
}

/**
 * A key already held for exactly this cube: same height, same corner, a cube
 * and not a hop's box. In either plane: a region key is the root of x, y and
 * z alone (spec §7.2), so the same cube in the other plane has the same key
 * and lookup id. Scanning it again is a relay question, never another
 * computation or another purchase.
 */
export function heldCube(keys: Record<string, HeldKey>, at: Position, _plane: Plane, height: number): HeldKey | null {
  const base = scanBase(at, height)
  for (const k of Object.values(keys)) {
    if (k.height !== height) continue
    if (k.heights && !(k.heights.x === height && k.heights.y === height && k.heights.z === height)) continue
    if (k.base.x === String(base.x) && k.base.y === String(base.y) && k.base.z === String(base.z)) return k
  }
  return null
}

/** A local scan under way: its answer, and the way to stop it. */
export interface CubeRun {
  /** The key, or null when it was cancelled or the worker failed. */
  done: Promise<RegionKeyOut | null>
  cancel: () => void
}

/** How a scan gets its worker; tests hand in their own. */
export type WorkerFactory = () => Worker

const defaultWorker: WorkerFactory = () => new Worker(new URL('../workers/region.worker.ts', import.meta.url), { type: 'module' })

/**
 * Compute the key of the cube of side 2^height holding `at`, in a worker of
 * its own. Where there are no workers (tests, a very old browser) it is
 * computed here instead, which only happens at heights cheap enough to.
 */
export function computeCube(at: Position, height: number, maxComputeHeight: number, makeWorker: WorkerFactory | null = typeof Worker === 'undefined' ? null : defaultWorker): CubeRun {
  if (!makeWorker) {
    let cancelled = false
    const done = Promise.resolve().then(() => {
      if (cancelled) return null
      const rk = regionKeyAt(at, height, maxComputeHeight)
      return cancelled ? null : { height, lookupId: rk.lookupId, keyHex: bytesToHex(rk.key) }
    })
    return { done, cancel: () => { cancelled = true } }
  }
  const worker = makeWorker()
  let settle: (v: RegionKeyOut | null) => void = () => {}
  let settled = false
  const done = new Promise<RegionKeyOut | null>((resolve) => { settle = resolve })
  const finish = (v: RegionKeyOut | null): void => {
    if (settled) return
    settled = true
    worker.terminate()
    settle(v)
  }
  let key: RegionKeyOut | null = null
  worker.onmessage = (e: MessageEvent<RegionResponse>) => {
    const msg = e.data
    if (msg.type === 'key' && msg.key.height === height) key = msg.key
    if (msg.type === 'done') finish(key)
    if (msg.type === 'error') finish(null)
  }
  worker.onerror = () => finish(null)
  const request: RegionRequest = { id: 1, x: at.x.toString(), y: at.y.toString(), z: at.z.toString(), heights: [height], maxComputeHeight }
  worker.postMessage(request)
  return { done, cancel: () => finish(null) }
}
