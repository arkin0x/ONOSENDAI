/**
 * ridePool.ts: the ride computation layer over ride.ts (DECK-0001 §5.7).
 *
 * A ride is 300k+ independent leaves at ~100 ms average each, hours of work
 * that the spec says SHOULD run "in a background worker with progress and
 * resumption". Four decisions follow from that:
 *
 * 1. Pull queue, not pre-partitioning. Blocks go to workers in chunks of
 *    RIDE_CHUNK_SIZE, and a worker asks for the next chunk only when it
 *    finishes one. Leaf cost spans 2^10 to 2^22 pairings, so a pre-partitioned
 *    pool would leave every worker idle behind the one that drew the heavy
 *    stretch (same lesson as the terrain pool in lib/workers.ts).
 *
 * 2. Every finished leaf is persisted to IndexedDB, batched. A reload or an
 *    abort mid-ride loses at most the unflushed tail, and the next attempt
 *    for the same previousEventIdHex resumes where this one stopped. Leaves
 *    are seeded by previousEventIdHex (§5.3 step 3), so rows are keyed by it
 *    and never shared across chain positions.
 *
 * 3. The Merkle aggregation stays on the main thread. It is ~1M sha256 of 64
 *    bytes for a full ride, a few seconds once, and keeping it here means the
 *    workers hold no state worth recovering.
 *
 * 4. The re-roll price (§5.5) runs on the same pull queue once the root is
 *    known: workers take ranges of GRIND_CHUNK nonces, one height-16 Cantor
 *    tree each, and the first nonce anywhere that meets the price wins, since
 *    any valid nonce verifies. A long ride needs thousands of attempts, so the
 *    search keeps a checkpoint per (previousEventIdHex, root): every nonce
 *    below it is known to miss, and a resumed search starts there.
 *
 * The pool is created per phase and terminated when the phase settles, so an
 * idle app holds no worker threads hostage.
 */

import { bytesToHex, hexToBytes } from 'cyberspace-core'
import {
  ZERO_LENGTH_PROOF,
  attemptsRequired,
  computeRideLeaf,
  expectedRidePairs,
  grindAttempt,
  meetsPrice,
  rideProofFor,
  rideTree,
  timeCalibrationSample,
  type RideProof,
} from './ride'
import type { CalibrateRequest, RideChunkResponse, RideWorkerRequest } from '../../workers/ride.worker'

export interface RideJob {
  /** 64 hex; the chain head the ride departs from. Every leaf is seeded by it (§5.3). */
  previousEventIdHex: string
  /** Ascending height. Possibly 300k+ entries, possibly empty. */
  blocks: Array<{ height: number; blockHash: string }>
}

export interface RideProgress {
  /** Leaves computed, of the ride's total. */
  done: number
  total: number
  etaMs: number | null
  /**
   * The re-roll price (§5.5), once every leaf is done: attempts tried so far
   * and A, the expected count. Null while leaves are still being computed.
   * Each attempt succeeds with probability 1/A, so a run can pass A.
   */
  price: { attempts: number; expected: number } | null
}

/**
 * How far along a ride is, 0 to 1, over both phases: the leaves weigh one
 * block each and the price A blocks, since an attempt costs about one block
 * (§5.5). The price's share is the chance a search that long has found a
 * nonce, 1 - e^(-attempts / A), which keeps moving on an unlucky run instead
 * of pinning at full while the search goes on.
 */
export function rideFraction(p: RideProgress): number {
  if (p.total <= 0) return 1
  const price = p.price === null ? 0 : -Math.expm1(-p.price.attempts / p.price.expected)
  const attempts = attemptsRequired(p.total)
  return (Math.min(p.done, p.total) + price * attempts) / (p.total + attempts)
}

/**
 * Blocks per worker message. Small enough that a pulled chunk represents a
 * few seconds of average work (so the pull queue can rebalance around a heavy
 * block), large enough that message overhead is noise.
 */
export const RIDE_CHUNK_SIZE = 64

/** Nonces per worker message in the price search: an attempt costs about one
 * average block, so this is a second or two of work per pull. */
export const GRIND_CHUNK = 8

/** Split pending blocks into chunks; workers pull them in index order. */
export function planChunks(
  blocks: RideJob['blocks'],
  size: number = RIDE_CHUNK_SIZE,
): Array<RideJob['blocks']> {
  const chunks: Array<RideJob['blocks']> = []
  for (let i = 0; i < blocks.length; i += size) chunks.push(blocks.slice(i, i + size))
  return chunks
}

/** The persistence key for one leaf. Prefix-scannable by ride. */
export function leafKey(previousEventIdHex: string, height: number): string {
  return `${previousEventIdHex}:${height}`
}

/** The persistence key for one ride's price search: a different root is a different search. */
export function grindKey(previousEventIdHex: string, rootHex: string): string {
  return `${previousEventIdHex}:${rootHex}`
}

/**
 * The blocks still to compute, given the keys already persisted. Keys carry
 * the previousEventIdHex, so a cache from another chain position skips
 * nothing: its leaves are worthless here (§5.3 seeds differ).
 */
export function pendingBlocks(job: RideJob, cachedKeys: Set<string>): RideJob['blocks'] {
  return job.blocks.filter((b) => !cachedKeys.has(leafKey(job.previousEventIdHex, b.height)))
}

/**
 * Order completed leaves for the tree. Leaves arrive in completion order (a
 * pool property, not a protocol one); §5.4 requires ascending height, so
 * assembly follows job.blocks, not arrival.
 */
export function assembleLeaves(
  blocks: RideJob['blocks'],
  leafHexByHeight: Map<number, string>,
): Uint8Array[] {
  return blocks.map((b) => {
    const hex = leafHexByHeight.get(b.height)
    if (hex === undefined) throw new Error(`missing ride leaf for block ${b.height}`)
    return hexToBytes(hex)
  })
}

/**
 * Where a resumed price search starts: the lowest nonce not known to miss.
 * Ranges finish out of order, so it is the start of the lowest range still
 * in flight, or the next range to hand out when none is.
 */
export function grindCheckpoint(inFlightStarts: Iterable<number>, nextStart: number): number {
  let low = nextStart
  for (const start of inFlightStarts) if (start < low) low = start
  return low
}

// ---------------------------------------------------------------------------
// IndexedDB persistence (inline promise wrapper; absent IDB degrades to
// running without resumption, which is how tests run under node)
// ---------------------------------------------------------------------------

const DB_NAME = 'onosendai:hyperspace-rides'
/**
 * Version 2 adds the price search's store. The leaves store carries over
 * untouched: openings version 2 (§5.8) changed only where the samples come
 * from, never a leaf, so a ride interrupted under the old client resumes
 * with its leaves intact.
 */
const DB_VERSION = 2
const STORE = 'leaves'
const GRIND_STORE = 'grind'

interface LeafRow {
  key: string
  leafHex: string
}

interface GrindRow {
  key: string
  /** Where the search resumes: every nonce below it is known to miss, or it
   * is itself the nonce that met the price. */
  next: number
}

function openRideDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(GRIND_STORE)) db.createObjectStore(GRIND_STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => {
      const db = req.result
      // Let a newer tab upgrade instead of waiting on this one forever.
      db.onversionchange = () => db.close()
      resolve(db)
    }
    // Persistence is an optimization; a broken IDB must not block the ride,
    // and neither may an older tab holding the previous version open.
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
}

/** All keys of one ride share the `${prev}:` prefix, and ':' < ';'. */
function rideRange(previousEventIdHex: string): IDBKeyRange {
  return IDBKeyRange.bound(`${previousEventIdHex}:`, `${previousEventIdHex};`)
}

function readCachedLeaves(
  db: IDBDatabase | null,
  previousEventIdHex: string,
): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (!db) return Promise.resolve(out)
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(rideRange(previousEventIdHex))
    req.onsuccess = () => {
      for (const row of req.result as LeafRow[]) {
        out.set(Number(row.key.slice(previousEventIdHex.length + 1)), row.leafHex)
      }
      resolve(out)
    }
    req.onerror = () => resolve(out)
  })
}

function readGrindRow(db: IDBDatabase | null, key: string): Promise<number> {
  if (!db) return Promise.resolve(0)
  return new Promise((resolve) => {
    const req = db.transaction(GRIND_STORE, 'readonly').objectStore(GRIND_STORE).get(key)
    req.onsuccess = () => {
      const row = req.result as GrindRow | undefined
      resolve(row && Number.isSafeInteger(row.next) && row.next >= 0 ? row.next : 0)
    }
    req.onerror = () => resolve(0)
  })
}

function writeRows(db: IDBDatabase | null, store: string, rows: Array<LeafRow | GrindRow>): Promise<void> {
  if (!db || rows.length === 0) return Promise.resolve()
  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readwrite')
    const os = tx.objectStore(store)
    for (const row of rows) os.put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

/** Drop a proven ride's leaves and price search. */
function deleteRideRows(db: IDBDatabase | null, previousEventIdHex: string): Promise<void> {
  if (!db) return Promise.resolve()
  return new Promise((resolve) => {
    const tx = db.transaction([STORE, GRIND_STORE], 'readwrite')
    tx.objectStore(STORE).delete(rideRange(previousEventIdHex))
    tx.objectStore(GRIND_STORE).delete(rideRange(previousEventIdHex))
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

const FLUSH_INTERVAL_MS = 250
const FLUSH_BATCH = 500

/**
 * Batches leaf rows into periodic IDB transactions. One put per leaf would be
 * 300k+ transactions; batching by time and count keeps it to a handful per
 * second while capping what an interruption can lose.
 */
function makePersister(db: IDBDatabase | null) {
  let buffer: LeafRow[] = []
  let inFlight: Promise<void> = Promise.resolve()
  const flush = (): Promise<void> => {
    if (buffer.length > 0) {
      const rows = buffer
      buffer = []
      inFlight = inFlight.then(() => writeRows(db, STORE, rows))
    }
    return inFlight
  }
  const timer: ReturnType<typeof setInterval> | null =
    db ? setInterval(() => void flush(), FLUSH_INTERVAL_MS) : null
  return {
    add(key: string, leafHex: string): void {
      if (!db) return
      buffer.push({ key, leafHex })
      if (buffer.length >= FLUSH_BATCH) void flush()
    },
    /** Flush the tail and stop the timer. Runs on every settle path. */
    async stop(): Promise<void> {
      if (timer !== null) clearInterval(timer)
      await flush()
    },
  }
}

/** The price search's checkpoint, written on the same timer as the leaves. */
function makeGrindPersister(db: IDBDatabase | null, key: string) {
  let latest: number | null = null
  let inFlight: Promise<void> = Promise.resolve()
  const flush = (): Promise<void> => {
    if (latest !== null) {
      const row: GrindRow = { key, next: latest }
      latest = null
      inFlight = inFlight.then(() => writeRows(db, GRIND_STORE, [row]))
    }
    return inFlight
  }
  const timer: ReturnType<typeof setInterval> | null =
    db ? setInterval(() => void flush(), FLUSH_INTERVAL_MS) : null
  return {
    set(next: number): void {
      if (db) latest = next
    },
    async stop(): Promise<void> {
      if (timer !== null) clearInterval(timer)
      await flush()
    },
  }
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

const PROGRESS_INTERVAL_MS = 100
/** Below this many fresh leaves (or attempts) the rate estimate is noise; report no ETA. */
const ETA_MIN_FRESH = 20

function makeProgressReporter(
  onProgress: (p: RideProgress) => void,
  total: number,
  resumed: number,
  expectedAttempts: number,
) {
  let started = performance.now()
  let done = resumed
  let fresh = 0
  let price: { attempts: number; expected: number } | null = null
  let lastPost = -Infinity
  const post = (force: boolean) => {
    const now = performance.now()
    if (!force && now - lastPost < PROGRESS_INTERVAL_MS) return
    lastPost = now
    // Mean wall-clock per fresh leaf (or attempt) since the phase started.
    // Resumed work costs nothing and would fake a rate; parallelism is
    // absorbed because the mean is over wall-clock, not worker time. An
    // attempt costs about one average block (§5.5), so the leaf phase's ETA
    // counts the price as that many more blocks.
    let etaMs: number | null = null
    if (fresh >= ETA_MIN_FRESH) {
      const each = (now - started) / fresh
      if (price === null) etaMs = (total - done + expectedAttempts) * each
      else if (price.attempts < price.expected) etaMs = (price.expected - price.attempts) * each
    }
    onProgress({ done, total, etaMs, price: price && { ...price } })
  }
  return {
    start(): void {
      post(true)
    },
    leafDone(): void {
      done++
      fresh++
      post(false)
    },
    /** Every leaf is in; the price search begins, `attempts` of it already tried. */
    priceStart(attempts: number): void {
      price = { attempts, expected: expectedAttempts }
      started = performance.now()
      fresh = 0
      post(true)
    },
    attemptDone(): void {
      if (price === null) return
      price.attempts++
      fresh++
      post(false)
    },
    final(): void {
      post(true)
    },
  }
}

type Progress = ReturnType<typeof makeProgressReporter>

// ---------------------------------------------------------------------------
// The pool
// ---------------------------------------------------------------------------

let rideRunning = false

function abortError(): Error {
  const err = new Error('aborted')
  err.name = 'AbortError'
  return err
}

/**
 * Compute the full ride proof for a job. Resolves with the §5.4/§5.5 proof;
 * rejects with 'aborted' if the signal fires (partial leaves and the price
 * search's checkpoint stay persisted for resume) or with the first worker
 * error. Only one ride runs at a time: the pool sizes itself to the machine,
 * so a second concurrent ride would only slow both, and the stores are
 * per-ride anyway.
 */
export async function computeRideProof(
  job: RideJob,
  onProgress: (p: RideProgress) => void,
  signal?: AbortSignal,
): Promise<RideProof> {
  if (rideRunning) throw new Error('ride already computing')
  rideRunning = true
  try {
    return await runRide(job, onProgress, signal)
  } finally {
    rideRunning = false
  }
}

async function runRide(
  job: RideJob,
  onProgress: (p: RideProgress) => void,
  signal?: AbortSignal,
): Promise<RideProof> {
  if (signal?.aborted) throw abortError()
  const { previousEventIdHex, blocks } = job
  if (blocks.length === 0) {
    // §5.6 zero-length ride: nothing to compute, no price, nothing to persist.
    onProgress({ done: 0, total: 0, etaMs: null, price: null })
    return { ...ZERO_LENGTH_PROOF }
  }

  const db = await openRideDb()
  const cached = await readCachedLeaves(db, previousEventIdHex)
  const cachedKeys = new Set<string>()
  for (const height of cached.keys()) cachedKeys.add(leafKey(previousEventIdHex, height))
  const pending = pendingBlocks(job, cachedKeys)
  const leafHexByHeight = new Map(cached)

  const attempts = attemptsRequired(blocks.length)
  const progress = makeProgressReporter(onProgress, blocks.length, blocks.length - pending.length, attempts)
  progress.start()

  const persister = makePersister(db)
  try {
    if (pending.length > 0) {
      if (typeof Worker === 'undefined') {
        await leavesSequentially(previousEventIdHex, pending, leafHexByHeight, persister, progress, signal)
      } else {
        await leavesInPool(previousEventIdHex, pending, leafHexByHeight, persister, progress, signal)
      }
    }
  } finally {
    // Flush on every settle path, abort included, so a retry resumes from
    // here instead of repaying the work.
    await persister.stop()
  }

  const tree = rideTree(assembleLeaves(blocks, leafHexByHeight))
  const rootHex = bytesToHex(tree.root)
  const key = grindKey(previousEventIdHex, rootHex)
  const from = await readGrindRow(db, key)
  progress.priceStart(from)
  const checkpoint = makeGrindPersister(db, key)
  let found: { nonce: number; G: Uint8Array }
  try {
    const search = { previousEventIdHex, rootHex, attempts, from, checkpoint, progress, signal }
    found = typeof Worker === 'undefined' ? await grindSequentially(search) : await grindInPool(search)
  } finally {
    await checkpoint.stop()
  }

  progress.final()
  const proof = rideProofFor(tree, BigInt(found.nonce), found.G)
  // Best effort: a proven ride's leaves and search will never be asked for again.
  await deleteRideRows(db, previousEventIdHex)
  return proof
}

/**
 * The pull queue both phases run on: `size` workers, each handed the next
 * request when it finishes one. `onMessage` answers 'next' when a worker's
 * request is finished, 'finish' to settle the whole pool early; the pool also
 * settles once `next` has nothing left and nothing is in flight. A worker
 * error, a crashed worker or the signal rejects it.
 */
function runPool(
  size: number,
  next: (id: number) => RideWorkerRequest | null,
  onMessage: (msg: RideChunkResponse) => 'next' | 'finish' | void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const workers: Worker[] = []
    let settled = false
    let inFlight = 0
    let msgId = 0

    const finish = (err: Error | null) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      for (const w of workers) w.terminate()
      if (err) reject(err)
      else resolve()
    }
    const onAbort = () => finish(abortError())

    const assign = (worker: Worker) => {
      if (settled) return
      const request = next(++msgId)
      if (request === null) {
        if (inFlight === 0) finish(null)
        return
      }
      inFlight++
      worker.postMessage(request)
    }

    signal?.addEventListener('abort', onAbort)
    if (signal?.aborted) {
      onAbort()
      return
    }

    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('../../workers/ride.worker.ts', import.meta.url), {
        type: 'module',
      })
      workers.push(worker)
      worker.addEventListener('message', (event: MessageEvent<RideChunkResponse>) => {
        if (settled) return
        const msg = event.data
        if (msg.type === 'error') {
          finish(new Error(msg.message))
          return
        }
        const verdict = onMessage(msg)
        if (verdict === 'finish') {
          finish(null)
        } else if (verdict === 'next') {
          // Pull, not pre-partition: a 2^22 block stalls only its own worker.
          inFlight--
          assign(worker)
        }
      })
      // A crashed worker never posts again; without this the ride would hang
      // silently one chunk short of done.
      worker.addEventListener('error', (event) => {
        finish(new Error(event.message || 'ride worker failed'))
      })
      assign(worker)
    }
  })
}

/** Workers the machine can spare, leaving one core for the page. */
function poolWidth(): number {
  return Math.max(1, (navigator.hardwareConcurrency || 4) - 1)
}

/**
 * No-Worker fallback (tests under node, and any headless embedder). Same
 * semantics, sequential, with a microtask yield per leaf so an abort flagged
 * between leaves is honored promptly.
 */
async function leavesSequentially(
  previousEventIdHex: string,
  pending: RideJob['blocks'],
  out: Map<number, string>,
  persister: ReturnType<typeof makePersister>,
  progress: Progress,
  signal?: AbortSignal,
): Promise<void> {
  for (const { height, blockHash } of pending) {
    if (signal?.aborted) throw abortError()
    const leafHex = bytesToHex(computeRideLeaf(previousEventIdHex, height, blockHash))
    out.set(height, leafHex)
    persister.add(leafKey(previousEventIdHex, height), leafHex)
    progress.leafDone()
    await Promise.resolve()
  }
}

function leavesInPool(
  previousEventIdHex: string,
  pending: RideJob['blocks'],
  out: Map<number, string>,
  persister: ReturnType<typeof makePersister>,
  progress: Progress,
  signal?: AbortSignal,
): Promise<void> {
  const chunks = planChunks(pending)
  let nextChunk = 0
  /** Leaves still expected per in-flight chunk id. */
  const remaining = new Map<number, number>()
  return runPool(
    Math.min(chunks.length, poolWidth()),
    (id) => {
      if (nextChunk >= chunks.length) return null
      const chunk = chunks[nextChunk++]
      remaining.set(id, chunk.length)
      return { type: 'chunk', id, previousEventIdHex, chunk }
    },
    (msg) => {
      if (msg.type !== 'leaf') return
      out.set(msg.height, msg.leafHex)
      persister.add(leafKey(previousEventIdHex, msg.height), msg.leafHex)
      progress.leafDone()
      const left = (remaining.get(msg.id) ?? 1) - 1
      if (left > 0) {
        remaining.set(msg.id, left)
        return
      }
      remaining.delete(msg.id)
      return 'next'
    },
    signal,
  )
}

interface GrindSearch {
  previousEventIdHex: string
  rootHex: string
  /** A, the price in attempts. */
  attempts: number
  /** The first nonce to try: the persisted checkpoint, or 0. */
  from: number
  checkpoint: ReturnType<typeof makeGrindPersister>
  progress: Progress
  signal?: AbortSignal
}

/** The price search on this thread, upward from the checkpoint. */
async function grindSequentially(s: GrindSearch): Promise<{ nonce: number; G: Uint8Array }> {
  const root = hexToBytes(s.rootHex)
  for (let nonce = s.from; ; nonce++) {
    if (s.signal?.aborted) throw abortError()
    const G = grindAttempt(s.previousEventIdHex, root, BigInt(nonce))
    s.progress.attemptDone()
    if (meetsPrice(G, s.attempts)) {
      s.checkpoint.set(nonce)
      return { nonce, G }
    }
    s.checkpoint.set(nonce + 1)
    await Promise.resolve()
  }
}

/**
 * The price search across the pool: disjoint nonce ranges pulled in order,
 * the first nonce meeting the price wins. The checkpoint trails the lowest
 * range still in flight, so a resumed search repeats at most one range per
 * worker; once a nonce is found the checkpoint is that nonce, so a resume
 * finds it again on its first attempt.
 */
async function grindInPool(s: GrindSearch): Promise<{ nonce: number; G: Uint8Array }> {
  let nextStart = s.from
  /** Range start and attempts left, per in-flight request id. */
  const ranges = new Map<number, { start: number; left: number }>()
  let found: { nonce: number; G: Uint8Array } | null = null
  await runPool(
    Math.min(s.attempts, poolWidth()),
    (id) => {
      const start = nextStart
      nextStart += GRIND_CHUNK
      ranges.set(id, { start, left: GRIND_CHUNK })
      return { type: 'grind', id, previousEventIdHex: s.previousEventIdHex, rootHex: s.rootHex, attempts: s.attempts, start, count: GRIND_CHUNK }
    },
    (msg) => {
      if (msg.type !== 'attempt') return
      s.progress.attemptDone()
      if (msg.gHex !== null) {
        found = { nonce: msg.nonce, G: hexToBytes(msg.gHex) }
        s.checkpoint.set(msg.nonce)
        return 'finish'
      }
      const range = ranges.get(msg.id)
      if (range && --range.left > 0) return
      ranges.delete(msg.id)
      s.checkpoint.set(grindCheckpoint([...ranges.values()].map((r) => r.start), nextStart))
      return 'next'
    },
    s.signal,
  )
  if (found === null) throw new Error('the price search ended without a nonce')
  return found
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

/**
 * Where the last measurement is kept between sessions. A phone's number is
 * as good next week as today, and reading it back means the estimate shows a
 * figure the moment the panel opens rather than CALIBRATING; the fresh
 * measurement then replaces it.
 */
const BENCH_KEY = 'onosendai:ride-bench-ms'

function loadBenchmark(): number | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(BENCH_KEY)
    const ms = raw === null ? NaN : Number(raw)
    return Number.isFinite(ms) && ms > 0 ? ms : null
  } catch {
    return null
  }
}

function storeBenchmark(ms: number): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(BENCH_KEY, String(ms))
  } catch {
    // Storage denied or full: the number still holds for this session.
  }
}

let benchmarkMs: number | null = loadBenchmark()
let calibrating: Promise<number> | null = null

/** ms per mean block from a timed sample (§5.7 expected pairings of one block). */
function msPerBlock(sample: { elapsedMs: number; pairs: number }): number {
  return (sample.elapsedMs / sample.pairs) * expectedRidePairs(1)
}

/** The sample timed in a ride worker; the main thread only waits. */
function timeSampleInWorker(): Promise<{ elapsedMs: number; pairs: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/ride.worker.ts', import.meta.url), { type: 'module' })
    const done = (fn: () => void) => { worker.terminate(); fn() }
    worker.addEventListener('message', (event: MessageEvent<RideChunkResponse>) => {
      const msg = event.data
      if (msg.type === 'calibrated') done(() => resolve({ elapsedMs: msg.elapsedMs, pairs: msg.pairs }))
      else if (msg.type === 'error') done(() => reject(new Error(msg.message)))
    })
    worker.addEventListener('error', (event) => done(() => reject(new Error(event.message || 'ride worker failed'))))
    const request: CalibrateRequest = { type: 'calibrate', id: 1 }
    worker.postMessage(request)
  })
}

/**
 * Measure ms per average block on this machine, once per session. Times 8
 * synthetic leaves in a ride worker (on the main thread only where workers
 * do not exist, or if the worker fails), derives ms per Cantor pairing, and
 * scales to the §5.7 expected pairings of the mean block. Idempotent;
 * concurrent and later calls share the first measurement. Until it resolves,
 * leafBenchmarkMs() is the previous session's number, if there was one.
 */
export function calibrate(): Promise<number> {
  if (calibrating) return calibrating
  calibrating = (async () => {
    let sample: { elapsedMs: number; pairs: number }
    if (typeof Worker === 'undefined') {
      sample = timeCalibrationSample()
    } else {
      try {
        sample = await timeSampleInWorker()
      } catch {
        sample = timeCalibrationSample()
      }
    }
    benchmarkMs = msPerBlock(sample)
    storeBenchmark(benchmarkMs)
    return benchmarkMs
  })()
  return calibrating
}

/** The calibration: this session's once calibrate() resolves, else the
 * stored one from an earlier session, else null. */
export function leafBenchmarkMs(): number | null {
  return benchmarkMs
}
