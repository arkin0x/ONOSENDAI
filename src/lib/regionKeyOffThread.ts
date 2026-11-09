/**
 * regionKeyOffThread.ts — the region key at a height, computed off the main thread.
 *
 * The deploy used to derive its key inline, which at height 20 froze the page
 * for fifteen seconds on a desktop and minutes on a phone. The region worker
 * already computes exactly these keys for the passive scan; this asks it for
 * one. Where there is no Worker, as under the test runner, it computes inline.
 */

import { regionKeyAt } from './shardCrypto'
import { bytesToHex, hexToBytes } from './events'
import { useCalibration } from './calibration'
import { localKeySeconds } from './deployPlan'
import type { Position } from './space'
import type { RegionKeyOut, RegionRequest, RegionResponse } from '../workers/region.worker'

export interface KeyAtHeight {
  key: Uint8Array
  lookupId: string
}

/**
 * A region worker of one's own, for a caller with a stream of positions to
 * scan (Cyberspace TV, lib/tv/scan.ts): `keys` answers every height asked at
 * one position, and `close` ends the worker, with whatever it still had to do.
 */
export interface RegionKeyWorker {
  keys: (at: Position, heights: number[], maxComputeHeight: number) => Promise<RegionKeyOut[]>
  close: () => void
}

export function regionKeyWorker(): RegionKeyWorker {
  if (typeof Worker === 'undefined') {
    return {
      keys: (at, heights, maxComputeHeight) => Promise.resolve([...heights].sort((a, b) => a - b).map((height) => {
        const rk = regionKeyAt(at, height, maxComputeHeight)
        return { height, lookupId: rk.lookupId, keyHex: bytesToHex(rk.key) }
      })),
      close: () => {},
    }
  }
  let w: Worker | null = null
  let nextId = 1
  const pending = new Set<(reason: string) => void>()
  const fail = (reason: string): void => {
    w?.terminate()
    w = null
    for (const gone of [...pending]) gone(reason)
  }
  return {
    keys: (at, heights, maxComputeHeight) => {
      if (!w) {
        const made = new Worker(new URL('../workers/region.worker.ts', import.meta.url), { type: 'module' })
        // A script that fails to load fires `error`, never `message`: end it, refuse what waits on it, and the next ask makes a fresh one.
        made.addEventListener('error', () => { if (w === made) fail('The region worker failed to start or crashed.') })
        made.addEventListener('messageerror', () => { if (w === made) fail('The region worker sent an answer that could not be read.') })
        w = made
      }
      const worker = w
      const id = nextId++
      return new Promise((resolve, reject) => {
        const found: RegionKeyOut[] = []
        const end = (): void => { worker.removeEventListener('message', onMessage); pending.delete(gone) }
        const gone = (reason: string): void => { end(); reject(new Error(reason)) }
        const onMessage = (e: MessageEvent<RegionResponse>): void => {
          const msg = e.data
          if (msg.id !== id) return
          if (msg.type === 'key') found.push(msg.key)
          if (msg.type === 'error') { end(); reject(new Error(msg.message)) }
          if (msg.type === 'done') { end(); resolve(found) }
        }
        pending.add(gone)
        worker.addEventListener('message', onMessage)
        const request: RegionRequest = { id, x: at.x.toString(), y: at.y.toString(), z: at.z.toString(), heights, maxComputeHeight }
        worker.postMessage(request)
      })
    },
    close: () => fail('The region worker was closed.'),
  }
}

/** The timeout at height 20, where a phone can grind for minutes: ten of them. */
export const H20_TIMEOUT_MS = 10 * 60_000
/** No derivation is presumed hung sooner than this, however low its height. */
export const MIN_TIMEOUT_MS = 60_000
/** How many times this device's own measured time a derivation may take. */
const MEASURED_SLACK = 10

/**
 * How long one derivation at this height may take before the worker is
 * presumed hung: ten minutes at height 20, halving with each height below it
 * but never under a minute, and never less than ten times what this device's
 * calibration says it takes (three axes, deployPlan localKeySeconds). A
 * generous ceiling, not an estimate: it only has to tell a hung worker from a
 * slow phone.
 */
export function regionKeyTimeoutMs(height: number, cantorMsByHeight?: Record<number, number>): number {
  const floor = Math.max(MIN_TIMEOUT_MS, H20_TIMEOUT_MS * 2 ** (height - 20))
  const seconds = localKeySeconds(height, cantorMsByHeight)
  // Not yet measured (the benchmark waits out startup, and a phone's first
  // derivation can come before it): nothing says this device is fast, so the
  // ten minutes height 20 gets, at any height (review of #625).
  if (seconds === null) return Math.max(floor, H20_TIMEOUT_MS)
  return Math.max(floor, seconds * 1000 * MEASURED_SLACK)
}

/** A clock that only moves forward: Date.now() jumps with the wall clock (review of #625). */
function monotonic(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

/**
 * When the page was last hidden (monotonic), or -Infinity. A hidden tab's
 * timers and workers are throttled or frozen, so a derivation that ran out of
 * time while the page was in the background is not hung: a deploy left
 * running while the phone was locked must not be killed for it.
 */
let lastHidden = -Infinity
let watchingVisibility = false

function watchVisibility(): void {
  if (watchingVisibility || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
  watchingVisibility = true
  if (document.visibilityState === 'hidden') lastHidden = monotonic()
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') lastHidden = monotonic() })
}

/** Whether the page was hidden at any point since `since` (monotonic), or is now. */
function hiddenSince(since: number): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true
  return lastHidden >= since
}

/**
 * The one worker every deploy, room and TEST DISCOVERY shares. A module
 * worker whose script fails to load fires `error`, never `message`, and one
 * that hangs fires nothing, so a call waiting on it would never settle, and
 * every later call would wait behind it on the same worker. Either way the
 * worker is ended, every call waiting on it is refused, and the next call
 * makes a fresh one.
 */
let worker: Worker | null = null
let nextId = 1
/** The calls waiting on `worker`, by request id: each one's refusal. */
const waiting = new Map<number, (err: Error) => void>()
/** When the last queued request's time runs out: the worker answers one request at a time, so each one's clock starts where the one before it ends. */
let queueEnds = 0

/** End the shared worker and refuse every call waiting on it; the next call makes a fresh one. */
export function endRegionKeyWorker(reason = 'The region worker was ended.'): void {
  worker?.terminate()
  worker = null
  queueEnds = 0
  const refusals = [...waiting.values()]
  waiting.clear()
  for (const refuse of refusals) refuse(new Error(reason))
}

function sharedWorker(): Worker {
  watchVisibility()
  if (worker) return worker
  const w = new Worker(new URL('../workers/region.worker.ts', import.meta.url), { type: 'module' })
  const failed = (reason: string) => (): void => { if (worker === w) endRegionKeyWorker(reason) }
  w.addEventListener('error', failed('The region worker failed to start or crashed.'))
  w.addEventListener('messageerror', failed('The region worker sent an answer that could not be read.'))
  worker = w
  return w
}

export function regionKeyOffThread(at: Position, height: number, maxComputeHeight: number): Promise<KeyAtHeight> {
  if (typeof Worker === 'undefined') {
    const rk = regionKeyAt(at, height, maxComputeHeight)
    return Promise.resolve({ key: rk.key, lookupId: rk.lookupId })
  }
  let w: Worker
  try {
    w = sharedWorker()
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)))
  }
  const id = nextId++
  const now = monotonic()
  queueEnds = Math.max(now, queueEnds) + regionKeyTimeoutMs(height, useCalibration.getState().cantorMsByHeight)
  const timeout = queueEnds - now
  return new Promise((resolve, reject) => {
    let found: KeyAtHeight | null = null
    const end = (): void => {
      clearTimeout(timer)
      w.removeEventListener('message', onMessage)
      waiting.delete(id)
      if (waiting.size === 0) queueEnds = 0
    }
    const onMessage = (e: MessageEvent<RegionResponse>): void => {
      const msg = e.data
      if (msg.id !== id) return
      if (msg.type === 'key' && msg.key.height === height) found = { key: hexToBytes(msg.key.keyHex), lookupId: msg.key.lookupId }
      if (msg.type === 'error') { end(); reject(new Error(msg.message)) }
      if (msg.type === 'done') {
        end()
        if (found) resolve(found)
        else reject(new Error(`The region worker gave no key at height ${height}.`))
      }
    }
    // The clock this call is judged by: from when it was asked, or from the
    // last time its time ran out while the page was hidden.
    let since = now
    const expire = (): void => {
      if (worker !== w) return
      // Hidden at any point since: throttled, not hung. Its full time again, from now.
      if (hiddenSince(since)) {
        since = monotonic()
        timer = setTimeout(expire, timeout)
        return
      }
      endRegionKeyWorker(`The region worker did not answer within ${Math.round(timeout / 60_000)} min at height ${height}. Try again.`)
    }
    let timer = setTimeout(expire, timeout)
    waiting.set(id, (err) => { end(); reject(err) })
    w.addEventListener('message', onMessage)
    const request: RegionRequest = { id, x: at.x.toString(), y: at.y.toString(), z: at.z.toString(), heights: [height], maxComputeHeight }
    w.postMessage(request)
  })
}
