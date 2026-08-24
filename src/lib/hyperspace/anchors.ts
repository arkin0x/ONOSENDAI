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
 * complement. The BUILT index is additionally persisted wholesale (meta key
 * 'indexSnapshot') once the pipeline is ready and occasionally from the tail:
 * replaying ~1M rows re-sorts the line for tens of seconds on every load,
 * while adopting the snapshot is one bulk read plus a byHeight rebuild, and
 * the row replay then only covers what arrived after the snapshot. A height the relay has no anchor for still counts as covered;
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
  adoptSnapshot,
  appendColumns,
  appendStops,
  createStopIndex,
  hasPending,
  insertRow,
  mergeAll,
  mergeStep,
  rowByHeight,
  serializeIndex,
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

/**
 * Where the IndexedDB row replay still has work to do: the complement of the
 * union of the snapshot's covered ranges and this session's verified blob
 * ranges, as [start, endOrNull] stretches with null for the open-ended tail.
 * Every IDB row inside coveredAtSnapshot is by construction already in the
 * adopted snapshot (rows are appended to the index when they arrive, and the
 * snapshot serialized the whole index), and blob heights were just appended
 * by the header phase, so replaying either would only burn IDB reads on rows
 * the height dedupe then drops. With no snapshot this reduces to the
 * blob-only complement, i.e. byte-for-byte the pre-snapshot behaviour; with
 * neither it is one unbounded stretch, the old full replay.
 */
export function replayStretches(
  coveredAtSnapshot: Array<[number, number]>,
  blobCovered: Array<[number, number]>,
): Array<[number, number | null]> {
  let union: Array<[number, number]> = []
  for (const range of coveredAtSnapshot) union = mergeCovered(union, range)
  for (const range of blobCovered) union = mergeCovered(union, range)
  const out: Array<[number, number | null]> = []
  let cursor = 0
  for (const [start, end] of union) {
    if (start > cursor) out.push([cursor, start - 1])
    if (end + 1 > cursor) cursor = end + 1
  }
  out.push([cursor, null])
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
/** Gap between relay batches while the panels are closed: the user is in the
 * scene, so frames outrank the backfill's finish line. */
const BACKGROUND_BATCH_GAP_MS = 600
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
const SNAPSHOT_KEY = 'indexSnapshot'
const TIP_KEY = 'tip'
/** Tail re-snapshot gates: both must pass, so the ~130 MB put stays rare. */
const SNAPSHOT_INTERVAL_MS = 10 * 60_000
const SNAPSHOT_MIN_GROWTH = 5000

let running = false
let db: IDBDatabase | null = null
let covered: Array<[number, number]> = []
/** Verified header-blob ranges, this session only (see the header comment). */
let blobCovered: Array<[number, number]> = []
/** Rows delivered by verified blobs, for the source label. */
let blobRows = 0
/** Index size and wall clock at the last snapshot write (or adoption), the
 * baselines for the tail's re-snapshot gates and the redundant-write skip. */
let snapshotSize = 0
let snapshotAt = 0
let snapshotWriting = false
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

/** Remember the tip across reloads, riding the same write chain as covered,
 * so the next boot can report the cache replay as a real percentage. */
function persistTip(tip: number): void {
  if (!db) return
  const database = db
  metaChain = metaChain
    .then(() => putMeta(database, TIP_KEY, tip))
    .catch(() => { /* cache write is best effort */ })
}

/** covered plus the session's verified blob ranges: what the relay backfill
 * does NOT need to fetch. */
function effectiveCovered(): Array<[number, number]> {
  let out = covered
  for (const range of blobCovered) out = mergeCovered(out, range)
  return out
}

/** The stored 'indexSnapshot' meta shape. The snapshot itself stays unknown
 * here on purpose: adoptSnapshot owns its deep validation. */
function validSnapshotMeta(v: unknown): v is { snapshot: unknown; coveredAtSnapshot: Array<[number, number]> } {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  return typeof m.snapshot === 'object' && m.snapshot !== null && validCovered(m.coveredAtSnapshot)
}

/**
 * Persist the built index wholesale so the next boot adopts it instead of
 * re-sorting a million replayed rows. coveredAtSnapshot rides along so that
 * boot's replay can skip every IDB row the snapshot already contains. One
 * structured-clone put of ~130 MB of ArrayBuffers, which IndexedDB handles;
 * best effort like every other cache write. mergeAll first: serializeIndex
 * refuses a half-merged index, and by the time this runs (ready, or the
 * quiescent tail) there is at most a sliver pending.
 */
async function persistSnapshot(): Promise<void> {
  if (!db || snapshotWriting) return
  const database = db
  snapshotWriting = true
  try {
    mergeAll(anchorIndex)
    const snapshot = serializeIndex(anchorIndex)
    if (snapshot) {
      await putMeta(database, SNAPSHOT_KEY, { snapshot, coveredAtSnapshot: effectiveCovered() })
      snapshotSize = snapshot.count
      snapshotAt = Date.now()
    }
  } catch { /* cache write is best effort */
  } finally {
    snapshotWriting = false
  }
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
  // Adopt the persisted built index wholesale when possible: the same rows
  // the replay below would re-sort, in one bulk read. adoptSnapshot refuses
  // a non-empty index, so a session the header blobs already fed falls back
  // to the plain replay unchanged; so does any invalid or missing snapshot.
  let coveredAtSnapshot: Array<[number, number]> = []
  let adopted = 0
  try {
    const snapMeta = await getMeta(db, SNAPSHOT_KEY)
    if (validSnapshotMeta(snapMeta) && adoptSnapshot(anchorIndex, snapMeta.snapshot)) {
      adopted = anchorIndex.size - before
      coveredAtSnapshot = snapMeta.coveredAtSnapshot
      snapshotSize = anchorIndex.size
      snapshotAt = Date.now()
      cb.onLoaded(anchorIndex.size)
      scheduleBump(cb)
    }
  } catch { /* snapshot read is best effort; the row replay below covers it */ }
  // Only replay heights neither the snapshot nor the blobs delivered. With
  // neither this is one unbounded stretch, i.e. exactly the old full replay.
  for (const [start, end] of replayStretches(coveredAtSnapshot, blobCovered)) {
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
    const ms = Math.round(performance.now() - t0)
    console.info(adopted > 0
      ? `[hyperspace] resumed ${adopted} stops (snapshot) + ${restored - adopted} rows in ${ms} ms`
      : `[hyperspace] resumed ${restored} stops from cache in ${ms} ms`)
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

// The pace lever, driven by the hamburger menu: open panels mean the user is
// watching the sync numbers, so it runs full tilt; closed panels mean they
// are playing, so the backfill breathes between batches. Off until the app
// says otherwise, which errs toward smooth frames on first paint.
let syncHighPriority = false

export function setSyncPriority(high: boolean): void {
  syncHighPriority = high
}

async function processBatch(heights: number[], cb: SyncCallbacks): Promise<void> {
  const events = await query({ kinds: [321], '#B': heights.map(String), limit: 2000 })
  const best = new Map<number, { stop: Stop; hasM: boolean }>()
  // Parsed in slices with the loop handed back between them: a batch is up
  // to 2000 events, and rendering must not wait for all of them.
  for (let i = 0; i < events.length; i++) {
    if (i > 0 && i % 250 === 0) await delay(0)
    const ev = events[i]
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
      if (!syncHighPriority) await delay(BACKGROUND_BATCH_GAP_MS)
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
      // Re-snapshot occasionally so a long-lived tab's accumulation is not
      // replayed row by row on the next boot; both gates must pass.
      if (Date.now() - snapshotAt >= SNAPSHOT_INTERVAL_MS && anchorIndex.size - snapshotSize >= SNAPSHOT_MIN_GROWTH) {
        void persistSnapshot()
      }
    }
    if (knownTip === null || stop.height > knownTip) {
      knownTip = stop.height
      cb.onTip(stop.height)
      persistTip(stop.height)
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

  // The previous session's tip, so the loading phase can show a real
  // percentage: without it the total is unknown until the manifest or the
  // relay answers, and the whole cache replay reads LOADING 0%. Stale is
  // fine, the tip only grows, and every later onTip overwrites it.
  if (db) {
    try {
      const t = await getMeta(db, TIP_KEY)
      if (typeof t === 'number' && Number.isSafeInteger(t) && t >= 0) {
        knownTip = t
        cb.onTip(t)
      }
    } catch { /* cache read is best effort */ }
  }

  // Header-blob phase. fetchManifest never throws; null means the relay owns
  // everything this session.
  const mf = await fetchManifest()
  if (mf) {
    cb.onSource('blobs')
    setStatus(cb, 'syncing')
    knownTip = mf.manifest.generatedAtHeight
    cb.onTip(knownTip)
    persistTip(knownTip)
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
      persistTip(tip)
      setStatus(cb, 'syncing')
      await syncMissing(tip, cb)
      // Do not declare ready with rows still outside the sorted view; the
      // panel's nearest-stop answers should be over the full line.
      pumpMerge(cb)
      await whenMerged()
      setStatus(cb, 'ready')
      cb.onIndexChanged()
      // Persist the built index for the next boot. Awaited on purpose: the
      // bulk sync just finished, so nothing is hot. Skipped when no row has
      // landed since the last write (a reload that adopted the snapshot and
      // backfilled nothing) because rewriting identical buffers buys nothing.
      if (anchorIndex.size !== snapshotSize) await persistSnapshot()
      break
    } catch (e) {
      setStatus(cb, 'error', e instanceof Error ? e.message : String(e))
      await delay(RETRY_MS)
    }
  }

  startTail(cb)
  void pruneBlobCovered()
}
