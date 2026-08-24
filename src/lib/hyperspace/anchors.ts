/**
 * anchors.ts: the stop sync engine behind useHyperspace.
 *
 * The line is ~1M stops and grows by one every ten minutes. The primary
 * source is now the statically served header blobs (headerSync.ts): a worker
 * downloads, verifies and derives them off the main thread and hands back
 * flat columns, which covers everything up to the manifest's generation
 * height for ~50 MB instead of ~570 MB of relay events. The kind-321 relay
 * path remains for everything else: the tail beyond the blobs, any blob that
 * failed verification, and the whole line when the manifest is unreachable,
 * in which case this degrades to exactly the old behaviour.
 *
 * Relay-fetched stops are cached in IndexedDB alongside a 'covered' list of
 * height ranges, so a reload replays the cache and only fetches the
 * complement. A height the relay has no anchor for still counts as covered;
 * without that, a single genuinely missing block would be re-queried on every
 * load forever. Blob-verified heights are deliberately NOT persisted in
 * 'covered': the Cache API holds the raw blobs and re-verification is cheap,
 * and if the manifest ever vanishes those heights must become the relay's
 * job again. Rows the blobs supersede are pruned from IndexedDB after sync
 * (and subtracted from 'covered') so the stops store holds relay-sourced
 * heights only.
 *
 * The stop index is a module-level mutable singleton, the cameraPose
 * convention: bulk data React must never re-render on. Components watch
 * useHyperspace.indexVersion instead; while the bulk load churns the engine
 * bumps it at most once per 2.5 s, and once ready at most twice a second.
 * All bulk arrivals (blob columns, cache replay, relay batches) go through
 * the columnar index's pending queue and are folded into the sorted view by
 * an idle-scheduled incremental merge, never by a long main-thread stall;
 * only the one-block-per-ten-minutes tail takes the in-place insert path.
 *
 * The pure range and dedupe helpers are exported for anchors.test.ts; the
 * driver below them is the impure part.
 */

import { query, subscribe } from '../relay'
import { stopFromAnchor, type Stop, type StopKind } from './stops'
import {
  appendColumns,
  appendStops,
  createStopIndex,
  hasPending,
  insertRow,
  mergeStep,
  rowByHeight,
  type StopIndex,
} from './compactIndex'
import { fetchManifest, runHeaderSync } from './headerSync'
import {
  deleteRange,
  getMeta,
  getRangePaged,
  openDb,
  putMany,
  putMeta,
  STOPS_STORE,
} from './idb'

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

/** Remove a range from a sorted, merged covered list; the pruning inverse of
 * mergeCovered, with the same never-mutate contract. */
export function subtractCovered(
  covered: Array<[number, number]>,
  range: [number, number],
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const [start, end] of covered) {
    if (end < range[0] || start > range[1]) {
      out.push([start, end])
      continue
    }
    if (start < range[0]) out.push([start, range[0] - 1])
    if (end > range[1]) out.push([range[1] + 1, end])
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
 * rows append and the sorted view is swapped in place. */
export const anchorIndex: StopIndex = createStopIndex()

// ---------------------------------------------------------------------------
// Sync driver
// ---------------------------------------------------------------------------

export type SyncSource = 'blobs' | 'relay' | 'mixed'

export interface SyncCallbacks {
  onStatus: (status: 'loading-cache' | 'syncing' | 'ready' | 'error', error?: string) => void
  onSource: (source: SyncSource) => void
  onLoaded: (loaded: number) => void
  onTip: (tip: number) => void
  onIndexChanged: () => void
}

const BATCH_SIZE = 500
const CONCURRENCY = 3
const RETRY_MS = 30_000
/** indexVersion bump floor once the line is ready (the live tail). */
const BUMP_MS = 500
/** Bump floor while syncing: geometry rebuilds off ~1M points are the single
 * most expensive reaction to a bump, so during the bulk load they are rationed. */
const SYNC_BUMP_MS = 2500
/** Main-thread budget per merge slice; comfortably inside one frame. */
const MERGE_SLICE_MS = 12
const CACHE_CHUNK = 50_000
const COVERED_KEY = 'covered'

let running = false
let db: IDBDatabase | null = null
let covered: Array<[number, number]> = []
/** Verified header-blob ranges, this session only (see the header comment). */
let blobCovered: Array<[number, number]> = []
/** Rows delivered by verified blobs, for the source label. */
let blobRows = 0
let knownTip: number | null = null
let metaChain: Promise<void> = Promise.resolve()
let currentStatus: 'loading-cache' | 'syncing' | 'ready' | 'error' = 'loading-cache'
let lastBump = 0
let bumpTimer: ReturnType<typeof setTimeout> | null = null

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Idle-time scheduling where the platform offers it, macrotask elsewhere. */
function later(fn: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => fn(), { timeout: 200 })
  else setTimeout(fn, 0)
}

function setStatus(cb: SyncCallbacks, status: typeof currentStatus, error?: string): void {
  currentStatus = status
  cb.onStatus(status, error)
}

/** Bump indexVersion now, or trail into one bump per interval; the interval
 * widens while syncing (see SYNC_BUMP_MS). */
function scheduleBump(cb: SyncCallbacks): void {
  const interval = currentStatus === 'ready' ? BUMP_MS : SYNC_BUMP_MS
  const since = Date.now() - lastBump
  if (since >= interval) {
    lastBump = Date.now()
    cb.onIndexChanged()
    return
  }
  if (bumpTimer !== null) return
  bumpTimer = setTimeout(() => {
    bumpTimer = null
    lastBump = Date.now()
    cb.onIndexChanged()
  }, interval - since)
}

// ---------------------------------------------------------------------------
// Incremental merge pump
// ---------------------------------------------------------------------------

let mergePumping = false
let mergeWaiters: Array<() => void> = []

/** Fold pending rows into the sorted view in idle-time slices. Reentrant:
 * appends that land mid-merge just extend the run. */
function pumpMerge(cb: SyncCallbacks): void {
  if (mergePumping) return
  if (!hasPending(anchorIndex)) return
  mergePumping = true
  const run = (): void => {
    const done = mergeStep(anchorIndex, MERGE_SLICE_MS)
    if (!done) {
      later(run)
      return
    }
    mergePumping = false
    scheduleBump(cb)
    const waiters = mergeWaiters
    mergeWaiters = []
    for (const w of waiters) w()
  }
  later(run)
}

/** Resolves once nothing is pending and no merge is in flight. */
function whenMerged(): Promise<void> {
  if (!mergePumping && !hasPending(anchorIndex)) return Promise.resolve()
  return new Promise((resolve) => mergeWaiters.push(resolve))
}

// ---------------------------------------------------------------------------
// Covered bookkeeping
// ---------------------------------------------------------------------------

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

/** covered plus the session's verified blob ranges: what the relay backfill
 * does NOT need to fetch. */
function effectiveCovered(): Array<[number, number]> {
  let out = covered
  for (const range of blobCovered) out = mergeCovered(out, range)
  return out
}

/** The gaps between blob-covered ranges, [start, endOrNull] with null for the
 * open-ended tail: where cached relay rows could still be useful. */
function uncoveredStretches(ranges: Array<[number, number]>): Array<[number, number | null]> {
  const out: Array<[number, number | null]> = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start > cursor) out.push([cursor, start - 1])
    if (end + 1 > cursor) cursor = end + 1
  }
  out.push([cursor, null])
  return out
}

/** Where stops have come from so far, for the HUD. */
function announceSource(cb: SyncCallbacks): void {
  const source: SyncSource = blobRows === 0
    ? 'relay'
    : anchorIndex.size > blobRows ? 'mixed' : 'blobs'
  cb.onSource(source)
}

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

async function loadCache(cb: SyncCallbacks): Promise<void> {
  if (!db) return
  const t0 = performance.now()
  const before = anchorIndex.size
  const stored = await getMeta(db, COVERED_KEY)
  if (validCovered(stored)) covered = stored
  // Only replay heights the blobs did not deliver. When there are no blobs
  // this is one unbounded stretch, i.e. exactly the old full replay.
  for (const [start, end] of uncoveredStretches(blobCovered)) {
    await getRangePaged<StopRecord>(db, STOPS_STORE, start, end, CACHE_CHUNK, (row) => row.height, async (rows) => {
      const fresh: Stop[] = []
      for (const row of rows) {
        const stop = stopFromRecord(row)
        if (stop && rowByHeight(anchorIndex, stop.height) === -1) fresh.push(stop)
      }
      appendStops(anchorIndex, fresh)
      cb.onLoaded(anchorIndex.size)
      scheduleBump(cb)
      pumpMerge(cb)
      // A cold bulk load must not starve rendering: hand back the loop.
      await delay(0)
    })
  }
  announceSource(cb)
  const restored = anchorIndex.size - before
  if (restored > 0) {
    console.info(`[hyperspace] resumed ${restored} stops from cache in ${Math.round(performance.now() - t0)} ms`)
  }
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

async function processBatch(heights: number[], cb: SyncCallbacks): Promise<void> {
  const events = await query({ kinds: [321], '#B': heights.map(String), limit: 2000 })
  const best = new Map<number, { stop: Stop; hasM: boolean }>()
  for (const ev of events) {
    const stop = stopFromAnchor(ev)
    if (!stop || rowByHeight(anchorIndex, stop.height) !== -1) continue
    const candidate = { stop, hasM: ev.tags.some((t) => t.length >= 2 && t[0] === 'M') }
    const seen = best.get(stop.height)
    best.set(stop.height, seen ? pickBetter(seen, candidate) : candidate)
  }
  const fresh = [...best.values()].map((b) => b.stop)
  appendStops(anchorIndex, fresh)
  // The whole batch is covered even where no event came back: the relay may
  // genuinely lack a few heights, and re-querying them forever would pin the
  // sync just short of done.
  for (const run of runsOf(heights)) covered = mergeCovered(covered, run)
  cb.onLoaded(anchorIndex.size)
  scheduleBump(cb)
  pumpMerge(cb)
  announceSource(cb)
  if (db && fresh.length > 0) {
    try {
      await putMany(db, STOPS_STORE, fresh.map(recordFromStop))
    } catch { /* cache write is best effort */ }
  }
  persistCovered()
}

async function syncMissing(tip: number, cb: SyncCallbacks): Promise<void> {
  const batches = batchesOf(missingRanges(effectiveCovered(), tip), BATCH_SIZE)
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
    // the index is the common case here, not an error.
    if (!stop || rowByHeight(anchorIndex, stop.height) !== -1) return
    insertRow(anchorIndex, stop)
    // insertRow defers to the pending queue when a bulk merge is running.
    if (hasPending(anchorIndex)) pumpMerge(cb)
    covered = mergeCovered(covered, [stop.height, stop.height])
    if (db) {
      putMany(db, STOPS_STORE, [recordFromStop(stop)]).catch(() => { /* best effort */ })
      persistCovered()
    }
    if (knownTip === null || stop.height > knownTip) {
      knownTip = stop.height
      cb.onTip(stop.height)
    }
    cb.onLoaded(anchorIndex.size)
    scheduleBump(cb)
    announceSource(cb)
  })
}

/**
 * After a successful blob sync the IndexedDB rows inside blob ranges are
 * redundant weight (the Cache API already holds those heights in 48 bytes a
 * block); drop them and shrink 'covered' to match, so the stops store holds
 * relay-sourced heights only. Idempotent, best effort, after ready.
 */
async function pruneBlobCovered(): Promise<void> {
  if (!db || blobCovered.length === 0) return
  const database = db
  try {
    for (const range of blobCovered) {
      await deleteRange(database, STOPS_STORE, range[0], range[1])
      covered = subtractCovered(covered, range)
    }
    persistCovered()
  } catch { /* cache cleanup is best effort */ }
}

/**
 * The whole pipeline: verified header blobs first (when the manifest is
 * reachable), then the IndexedDB replay of relay-cached rows, then the
 * batched relay backfill of whatever is left with a 30 s retry, then the
 * live tail. Runs once per page; the store's startSync is the idempotence
 * gate, this flag is just belt and braces.
 */
export async function runAnchorSync(cb: SyncCallbacks): Promise<void> {
  if (running) return
  running = true

  setStatus(cb, 'loading-cache')
  try {
    db = await openDb()
  } catch {
    // Private mode or a broken IndexedDB: sync still works, it just cannot
    // resume across reloads.
    db = null
  }

  // Header-blob phase. fetchManifest never throws; null means the relay owns
  // everything this session.
  const mf = await fetchManifest()
  if (mf) {
    cb.onSource('blobs')
    setStatus(cb, 'syncing')
    knownTip = mf.manifest.generatedAtHeight
    cb.onTip(knownTip)
    const result = await runHeaderSync(mf.manifest, mf.url, {
      onProgress: (_startHeight, verified) => cb.onLoaded(anchorIndex.size + verified),
      onColumns: (cols) => {
        blobRows += appendColumns(anchorIndex, cols)
        cb.onLoaded(anchorIndex.size)
        scheduleBump(cb)
        pumpMerge(cb)
      },
      onBlobFailed: (startHeight, count, reason) => {
        console.warn(
          `[hyperspace] header blob ${startHeight}..${startHeight + count - 1} discarded: ${reason}; falling back to relay sync for that range`,
        )
      },
    })
    blobCovered = result.covered
    announceSource(cb)
  } else {
    cb.onSource('relay')
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
      const knownMax = anchorIndex.maxHeight >= 0 ? anchorIndex.maxHeight : null
      if (relayTip === null && knownMax === null) {
        setStatus(cb, 'error', 'no anchors from the relay and no cache to fall back on')
        await delay(RETRY_MS)
        continue
      }
      // Blobs or the cache can be ahead of a relay that lost data; trust the
      // max so loaded never exceeds total.
      const tip = Math.max(relayTip ?? 0, knownMax ?? 0)
      knownTip = tip
      cb.onTip(tip)
      setStatus(cb, 'syncing')
      await syncMissing(tip, cb)
      // Do not declare ready with rows still outside the sorted view; the
      // panel's nearest-stop answers should be over the full line.
      pumpMerge(cb)
      await whenMerged()
      setStatus(cb, 'ready')
      cb.onIndexChanged()
      break
    } catch (e) {
      setStatus(cb, 'error', e instanceof Error ? e.message : String(e))
      await delay(RETRY_MS)
    }
  }

  startTail(cb)
  void pruneBlobCovered()
}
