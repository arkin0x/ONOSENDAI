/**
 * anchors.ts: the kind 321 anchor sync engine behind useHyperspace.
 *
 * The line is ~950k stops and grows by one every ten minutes, so the problem
 * is shaped like a one-time bulk download plus a trickle. Everything fetched
 * is cached in IndexedDB alongside a 'covered' list of height ranges, so a
 * reload replays the cache and only fetches the complement. A height the
 * relay has no anchor for still counts as covered; without that, a single
 * genuinely missing block would be re-queried on every load forever.
 *
 * The stop index and the by-height map are module-level mutable singletons,
 * the cameraPose convention: bulk data React must never re-render on.
 * Components watch useHyperspace.indexVersion instead, and the engine bumps
 * it at most once per 500 ms while the bulk load churns.
 *
 * Bulk insertion is a sorted-array merge (bulkInsert) rather than per-stop
 * insertStop, because a splice into a ~950k-element array per stop is
 * quadratic across a full load. The live tail is one block per ten minutes,
 * which is what insertStop is for.
 *
 * Coordinates are persisted as 64-char hex, never through Number: a coord256
 * has 256 bits and a float64 mantissa has 53, so a numeric round trip would
 * silently move every cached stop.
 *
 * The pure range and dedupe helpers are exported for anchors.test.ts; the
 * driver below them is the impure part.
 */

import { query, subscribe } from '../relay'
import { stopFromAnchor, type Stop, type StopKind } from './stops'
import { insertStop, type StopIndex } from './station'
import { getAllPaged, getMeta, openDb, putMany, putMeta, STOPS_STORE } from './idb'

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Insert a range into a sorted, merged list of inclusive [start, end] ranges,
 * fusing overlaps and adjacency ([0,4] + [5,9] is one covered stretch).
 * Returns a new array; the inputs are never mutated, because the caller may
 * hand the previous value to an in-flight IndexedDB write.
 */
export function mergeCovered(
  covered: Array<[number, number]>,
  range: [number, number],
): Array<[number, number]> {
  const all = [...covered, range].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out: Array<[number, number]> = []
  for (const [start, end] of all) {
    const last = out[out.length - 1]
    if (last && start <= last[1] + 1) {
      if (end > last[1]) last[1] = end
    } else {
      out.push([start, end])
    }
  }
  return out
}

/**
 * The complement of the covered ranges within [0, tip]. Assumes covered is
 * sorted and merged, which mergeCovered maintains.
 */
export function missingRanges(
  covered: Array<[number, number]>,
  tip: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let cursor = 0
  for (const [start, end] of covered) {
    if (cursor > tip) break
    if (start > cursor) out.push([cursor, Math.min(start - 1, tip)])
    if (end + 1 > cursor) cursor = end + 1
  }
  if (cursor <= tip) out.push([cursor, tip])
  return out
}

/**
 * Flatten ranges into ascending height batches of at most `size`. A batch may
 * span disjoint ranges: the relay filter takes an explicit height list, so
 * there is no reason to waste a round trip on a short tail range.
 */
export function batchesOf(ranges: Array<[number, number]>, size: number): number[][] {
  const out: number[][] = []
  let current: number[] = []
  for (const [start, end] of ranges) {
    for (let h = start; h <= end; h++) {
      current.push(h)
      if (current.length === size) {
        out.push(current)
        current = []
      }
    }
  }
  if (current.length > 0) out.push(current)
  return out
}

/** Contiguous runs within an ascending height list, as inclusive ranges. */
export function runsOf(heights: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const h of heights) {
    const last = out[out.length - 1]
    if (last && h === last[1] + 1) last[1] = h
    else out.push([h, h])
  }
  return out
}

/**
 * Dedupe preference between two anchors for the same height. hasM is whether
 * the anchor event carried an M tag: a v3 anchor supplies the stop coordinate
 * exactly, a legacy one forces the landfall to be re-derived, so v3 wins.
 * On a tie the first seen wins, so ingestion order is stable.
 */
export interface StopRecordLike {
  hasM: boolean
}

export function pickBetter<T extends StopRecordLike>(first: T, incoming: T): T {
  return incoming.hasM && !first.hasM ? incoming : first
}

// ---------------------------------------------------------------------------
// Cache rows
// ---------------------------------------------------------------------------

/** A stop as it sits in the IndexedDB 'stops' store: plain JSON, hex coords. */
export interface StopRecord {
  height: number
  kind: StopKind
  merkleRoot: string
  blockHash: string | null
  coordApproxHex: string
}

const HEX64 = /^[0-9a-f]{64}$/

export function recordFromStop(stop: Stop): StopRecord {
  return {
    height: stop.height,
    kind: stop.kind,
    merkleRoot: stop.merkleRoot,
    blockHash: stop.blockHash,
    coordApproxHex: stop.coordApprox.toString(16).padStart(64, '0'),
  }
}

/**
 * Rebuild a Stop from a cached row, or null for anything corrupt: the cache
 * is a convenience, so a bad row is dropped and re-fetched, never trusted.
 * coordExact is not cached. A port's equals its coordApprox; a landfall's is
 * re-derived from the block hash on demand by stopCoordExact.
 */
export function stopFromRecord(row: StopRecord): Stop | null {
  if (!Number.isSafeInteger(row.height) || row.height < 0) return null
  if (row.kind !== 'port' && row.kind !== 'landfall') return null
  if (!HEX64.test(row.merkleRoot) || !HEX64.test(row.coordApproxHex)) return null
  if (row.blockHash !== null && !HEX64.test(row.blockHash)) return null
  const coordApprox = BigInt('0x' + row.coordApproxHex)
  return {
    height: row.height,
    kind: row.kind,
    merkleRoot: row.merkleRoot,
    blockHash: row.blockHash,
    coordExact: row.kind === 'port' ? coordApprox : null,
    coordApprox,
  }
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

/** The live, mutable stop index. Same object identity for the page's life;
 * bulkInsert swaps its internal arrays in place. */
export const anchorIndex: StopIndex = { keys: [], stops: [] }

/** Every known stop by height; its size is sync.loaded. */
export const anchorsByHeight = new Map<number, Stop>()

// ---------------------------------------------------------------------------
// Sync driver
// ---------------------------------------------------------------------------

export interface SyncCallbacks {
  onStatus: (status: 'loading-cache' | 'syncing' | 'ready' | 'error', error?: string) => void
  onLoaded: (loaded: number) => void
  onTip: (tip: number) => void
  onIndexChanged: () => void
}

const BATCH_SIZE = 500
const CONCURRENCY = 3
const RETRY_MS = 30_000
const BUMP_MS = 500
const CACHE_CHUNK = 5000
const COVERED_KEY = 'covered'

let running = false
let db: IDBDatabase | null = null
let covered: Array<[number, number]> = []
let knownTip: number | null = null
let metaChain: Promise<void> = Promise.resolve()
let lastBump = 0
let bumpTimer: ReturnType<typeof setTimeout> | null = null

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Bump indexVersion now, or trail into one bump at most every BUMP_MS. */
function scheduleBump(cb: SyncCallbacks): void {
  const since = Date.now() - lastBump
  if (since >= BUMP_MS) {
    lastBump = Date.now()
    cb.onIndexChanged()
    return
  }
  if (bumpTimer !== null) return
  bumpTimer = setTimeout(() => {
    bumpTimer = null
    lastBump = Date.now()
    cb.onIndexChanged()
  }, BUMP_MS - since)
}

/** Merge a batch of stops into the index in one O(n + m) pass. */
function bulkInsert(stops: Stop[]): void {
  if (stops.length === 0) return
  const add = stops.map((s) => ({ key: s.coordApprox >> 1n, stop: s }))
  add.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const oldKeys = anchorIndex.keys
  const oldStops = anchorIndex.stops
  const keys: bigint[] = []
  const merged: Stop[] = []
  let i = 0
  let j = 0
  while (i < oldKeys.length || j < add.length) {
    if (j >= add.length || (i < oldKeys.length && oldKeys[i] <= add[j].key)) {
      keys.push(oldKeys[i])
      merged.push(oldStops[i])
      i++
    } else {
      keys.push(add[j].key)
      merged.push(add[j].stop)
      j++
    }
  }
  anchorIndex.keys = keys
  anchorIndex.stops = merged
}

function validCovered(v: unknown): v is Array<[number, number]> {
  return Array.isArray(v) && v.every((r) =>
    Array.isArray(r) && r.length === 2 &&
    Number.isSafeInteger(r[0]) && Number.isSafeInteger(r[1]) &&
    r[0] >= 0 && r[1] >= r[0])
}

/**
 * Persist the covered ranges through a promise chain so concurrent batches
 * cannot commit an older snapshot after a newer one: each link reads the
 * current `covered` when it runs, not when it was queued.
 */
function persistCovered(): void {
  if (!db) return
  const database = db
  metaChain = metaChain
    .then(() => putMeta(database, COVERED_KEY, covered))
    .catch(() => { /* cache write is best effort */ })
}

async function loadCache(cb: SyncCallbacks): Promise<void> {
  if (!db) return
  const stored = await getMeta(db, COVERED_KEY)
  if (validCovered(stored)) covered = stored
  await getAllPaged<StopRecord>(db, STOPS_STORE, CACHE_CHUNK, (row) => row.height, async (rows) => {
    const fresh: Stop[] = []
    for (const row of rows) {
      const stop = stopFromRecord(row)
      if (stop && !anchorsByHeight.has(stop.height)) {
        anchorsByHeight.set(stop.height, stop)
        fresh.push(stop)
      }
    }
    bulkInsert(fresh)
    cb.onLoaded(anchorsByHeight.size)
    scheduleBump(cb)
    // A cold ~950k-row load must not starve rendering: hand back the loop.
    await delay(0)
  })
}

/** The max B among the newest anchors; the NTH publisher tails the tip. */
async function discoverTip(): Promise<number | null> {
  const events = await query({ kinds: [321], limit: 20 })
  let tip: number | null = null
  for (const ev of events) {
    const stop = stopFromAnchor(ev)
    if (stop && (tip === null || stop.height > tip)) tip = stop.height
  }
  return tip
}

function maxKnownHeight(): number | null {
  let max: number | null = null
  for (const h of anchorsByHeight.keys()) if (max === null || h > max) max = h
  return max
}

async function processBatch(heights: number[], cb: SyncCallbacks): Promise<void> {
  const events = await query({ kinds: [321], '#B': heights.map(String), limit: 2000 })
  const best = new Map<number, { stop: Stop; hasM: boolean }>()
  for (const ev of events) {
    const stop = stopFromAnchor(ev)
    if (!stop || anchorsByHeight.has(stop.height)) continue
    const candidate = { stop, hasM: ev.tags.some((t) => t.length >= 2 && t[0] === 'M') }
    const seen = best.get(stop.height)
    best.set(stop.height, seen ? pickBetter(seen, candidate) : candidate)
  }
  const fresh = [...best.values()].map((b) => b.stop)
  for (const stop of fresh) anchorsByHeight.set(stop.height, stop)
  bulkInsert(fresh)
  // The whole batch is covered even where no event came back: the relay may
  // genuinely lack a few heights, and re-querying them forever would pin the
  // sync just short of done.
  for (const run of runsOf(heights)) covered = mergeCovered(covered, run)
  cb.onLoaded(anchorsByHeight.size)
  scheduleBump(cb)
  if (db && fresh.length > 0) {
    try {
      await putMany(db, STOPS_STORE, fresh.map(recordFromStop))
    } catch { /* cache write is best effort */ }
  }
  persistCovered()
}

async function syncMissing(tip: number, cb: SyncCallbacks): Promise<void> {
  const batches = batchesOf(missingRanges(covered, tip), BATCH_SIZE)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < batches.length) {
      const batch = batches[next]
      next += 1
      await processBatch(batch, cb)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
}

/** Hold a subscription so new blocks land as the publisher anchors them. */
function startTail(cb: SyncCallbacks): void {
  const since = Math.floor(Date.now() / 1000) - 3600
  subscribe({ kinds: [321], since }, (ev) => {
    const stop = stopFromAnchor(ev)
    // The publisher re-announces the tip continuously; a height already in
    // the map is the common case here, not an error.
    if (!stop || anchorsByHeight.has(stop.height)) return
    anchorsByHeight.set(stop.height, stop)
    insertStop(anchorIndex, stop)
    covered = mergeCovered(covered, [stop.height, stop.height])
    if (db) {
      putMany(db, STOPS_STORE, [recordFromStop(stop)]).catch(() => { /* best effort */ })
      persistCovered()
    }
    if (knownTip === null || stop.height > knownTip) {
      knownTip = stop.height
      cb.onTip(stop.height)
    }
    cb.onLoaded(anchorsByHeight.size)
    scheduleBump(cb)
  })
}

/**
 * The whole pipeline: cache replay, tip discovery, batched backfill with a
 * 30 s retry, then the live tail. Runs once per page; the store's startSync
 * is the idempotence gate, this flag is just belt and braces.
 */
export async function runAnchorSync(cb: SyncCallbacks): Promise<void> {
  if (running) return
  running = true

  cb.onStatus('loading-cache')
  try {
    db = await openDb()
  } catch {
    // Private mode or a broken IndexedDB: sync still works, it just cannot
    // resume across reloads.
    db = null
  }
  try {
    await loadCache(cb)
  } catch {
    // A corrupt cache is not fatal: whatever validated is in the index, and
    // the network stage re-fetches anything the cache failed to deliver.
  }

  for (;;) {
    try {
      const relayTip = await discoverTip()
      const cachedTip = maxKnownHeight()
      if (relayTip === null && cachedTip === null) {
        cb.onStatus('error', 'no anchors from the relay and no cache to fall back on')
        await delay(RETRY_MS)
        continue
      }
      // The cache can be ahead of a relay that lost data; trust the max so
      // loaded never exceeds total.
      const tip = Math.max(relayTip ?? 0, cachedTip ?? 0)
      knownTip = tip
      cb.onTip(tip)
      cb.onStatus('syncing')
      await syncMissing(tip, cb)
      cb.onStatus('ready')
      break
    } catch (e) {
      cb.onStatus('error', e instanceof Error ? e.message : String(e))
      await delay(RETRY_MS)
    }
  }

  startTail(cb)
}
