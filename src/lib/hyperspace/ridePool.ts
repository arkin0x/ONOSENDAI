/**
 * ridePool.ts: the ride computation layer over ride.ts (DECK-0001 §5.7).
 *
 * A ride is 300k+ independent leaves at ~100 ms average each, hours of work
 * that the spec says SHOULD run "in a background worker with progress and
 * resumption". Three decisions follow from that:
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
 *    workers speak one message shape and hold no state worth recovering.
 *
 * The pool is created per computeRideProof call and terminated when the call
 * settles, so an idle app holds no worker threads hostage.
 */

import { bytesToHex, hexToBytes, sha256 } from 'cyberspace-core'
import {
  buildRideProof,
  computeRideLeaf,
  exactRidePairs,
  expectedRidePairs,
  lineTerrainK,
} from './ride'
import type { RideChunkRequest, RideChunkResponse } from '../../workers/ride.worker'

export interface RideJob {
  /** 64 hex; the enter event id. Every leaf is seeded by it (§5.3). */
  previousEventIdHex: string
  /** Ascending height. Possibly 300k+ entries, possibly empty. */
  blocks: Array<{ height: number; blockHash: string }>
}

export interface RideProgress {
  done: number
  total: number
  etaMs: number | null
}

/**
 * Blocks per worker message. Small enough that a pulled chunk represents a
 * few seconds of average work (so the pull queue can rebalance around a heavy
 * block), large enough that message overhead is noise.
 */
export const RIDE_CHUNK_SIZE = 64

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

/**
 * The blocks still to compute, given the keys already persisted. Keys carry
 * the previousEventIdHex, so a cache from another chain position skips
 * nothing: its leaves are worthless here (§5.3 seeds differ).
 */
export function pendingBlocks(job: RideJob, cachedKeys: Set<string>): RideJob['blocks'] {
  return job.blocks.filter((b) => !cachedKeys.has(leafKey(job.previousEventIdHex, b.height)))
}

/**
 * Order completed leaves for buildRideProof. Leaves arrive in completion
 * order (a pool property, not a protocol one); §5.4 requires ascending
 * height, so assembly follows job.blocks, not arrival.
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

// ---------------------------------------------------------------------------
// IndexedDB persistence (inline promise wrapper; absent IDB degrades to
// running without resumption, which is how tests run under node)
// ---------------------------------------------------------------------------

const DB_NAME = 'onosendai:hyperspace-rides'
const STORE = 'leaves'

interface LeafRow {
  key: string
  leafHex: string
}

function openRideDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    // Persistence is an optimization; a broken IDB must not block the ride.
    req.onerror = () => resolve(null)
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

function writeLeafRows(db: IDBDatabase | null, rows: LeafRow[]): Promise<void> {
  if (!db || rows.length === 0) return Promise.resolve()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const row of rows) store.put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

function deleteRideRows(db: IDBDatabase | null, previousEventIdHex: string): Promise<void> {
  if (!db) return Promise.resolve()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(rideRange(previousEventIdHex))
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
      inFlight = inFlight.then(() => writeLeafRows(db, rows))
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

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

const PROGRESS_INTERVAL_MS = 100
/** Below this many fresh leaves the rate estimate is noise; report no ETA. */
const ETA_MIN_FRESH = 20

function makeProgressReporter(
  onProgress: (p: RideProgress) => void,
  total: number,
  resumed: number,
) {
  const started = performance.now()
  let done = resumed
  let fresh = 0
  let lastPost = -Infinity
  const post = (force: boolean) => {
    const now = performance.now()
    if (!force && now - lastPost < PROGRESS_INTERVAL_MS) return
    lastPost = now
    // Mean wall-clock per fresh leaf since start. Resumed leaves cost nothing
    // and would fake a rate; parallelism is absorbed because the mean is over
    // wall-clock, not worker time.
    const etaMs = fresh >= ETA_MIN_FRESH ? ((total - done) * (now - started)) / fresh : null
    onProgress({ done, total, etaMs })
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
    final(): void {
      post(true)
    },
  }
}

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
 * rejects with 'aborted' if the signal fires (partial leaves stay persisted
 * for resume) or with the first worker error. Only one ride runs at a time:
 * the pool sizes itself to the machine, so a second concurrent ride would
 * only slow both, and the leaf store is per-ride anyway.
 */
export async function computeRideProof(
  job: RideJob,
  onProgress: (p: RideProgress) => void,
  signal?: AbortSignal,
): Promise<{ rootHex: string; mp: string }> {
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
): Promise<{ rootHex: string; mp: string }> {
  if (signal?.aborted) throw abortError()
  const { previousEventIdHex, blocks } = job
  if (blocks.length === 0) {
    // §5.6 zero-length ride: nothing to compute, nothing to persist.
    onProgress({ done: 0, total: 0, etaMs: null })
    return buildRideProof([])
  }

  const db = await openRideDb()
  const cached = await readCachedLeaves(db, previousEventIdHex)
  const cachedKeys = new Set<string>()
  for (const height of cached.keys()) cachedKeys.add(leafKey(previousEventIdHex, height))
  const pending = pendingBlocks(job, cachedKeys)
  const leafHexByHeight = new Map(cached)

  const progress = makeProgressReporter(onProgress, blocks.length, blocks.length - pending.length)
  progress.start()

  const persister = makePersister(db)
  try {
    if (pending.length > 0) {
      if (typeof Worker === 'undefined') {
        await computeSequentially(previousEventIdHex, pending, leafHexByHeight, persister, progress, signal)
      } else {
        await computeInPool(previousEventIdHex, pending, leafHexByHeight, persister, progress, signal)
      }
    }
  } finally {
    // Flush on every settle path, abort included, so a retry resumes from
    // here instead of repaying the work.
    await persister.stop()
  }

  progress.final()
  const proof = buildRideProof(assembleLeaves(blocks, leafHexByHeight))
  // Best effort: leaves for a proven ride will never be asked for again.
  await deleteRideRows(db, previousEventIdHex)
  return proof
}

/**
 * No-Worker fallback (tests under node, and any headless embedder). Same
 * semantics, sequential, with a microtask yield per leaf so an abort flagged
 * between leaves is honored promptly.
 */
async function computeSequentially(
  previousEventIdHex: string,
  pending: RideJob['blocks'],
  out: Map<number, string>,
  persister: ReturnType<typeof makePersister>,
  progress: ReturnType<typeof makeProgressReporter>,
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

function computeInPool(
  previousEventIdHex: string,
  pending: RideJob['blocks'],
  out: Map<number, string>,
  persister: ReturnType<typeof makePersister>,
  progress: ReturnType<typeof makeProgressReporter>,
  signal?: AbortSignal,
): Promise<void> {
  const chunks = planChunks(pending)
  const poolSize = Math.min(chunks.length, Math.max(1, (navigator.hardwareConcurrency || 4) - 1))

  return new Promise<void>((resolve, reject) => {
    const workers: Worker[] = []
    let settled = false
    let nextChunk = 0
    let leavesLeft = pending.length
    let msgId = 0
    /** Leaves still expected per in-flight chunk id. */
    const remaining = new Map<number, number>()

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
      if (settled || nextChunk >= chunks.length) return
      const chunk = chunks[nextChunk++]
      const id = ++msgId
      remaining.set(id, chunk.length)
      const request: RideChunkRequest = { id, previousEventIdHex, chunk }
      worker.postMessage(request)
    }

    signal?.addEventListener('abort', onAbort)
    if (signal?.aborted) {
      onAbort()
      return
    }

    for (let i = 0; i < poolSize; i++) {
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
        out.set(msg.height, msg.leafHex)
        persister.add(leafKey(previousEventIdHex, msg.height), msg.leafHex)
        progress.leafDone()
        leavesLeft--
        const left = (remaining.get(msg.id) ?? 1) - 1
        if (left > 0) {
          remaining.set(msg.id, left)
        } else {
          // The chunk is done; this worker pulls the next one. Pull, not
          // pre-partition: a 2^22 block stalls only its own worker.
          remaining.delete(msg.id)
          assign(worker)
        }
        if (leavesLeft === 0) finish(null)
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

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

let benchmarkMs: number | null = null
let calibrating: Promise<number> | null = null

/**
 * The K values the calibration sample spans. Low through average, never the
 * heavy tail: a K=16 block alone is 2^22 pairings and would make calibration
 * itself seconds long. The measurement is normalized per pairing and scaled
 * to the binomial mean block, so excluding the tail does not bias the result,
 * it only bounds the cost.
 */
const CALIBRATION_KS = [4, 5, 6, 7, 8, 9, 10, 11]

function calibrationHashes(): string[] {
  const enc = new TextEncoder()
  const found = new Map<number, string>()
  for (let counter = 0; found.size < CALIBRATION_KS.length && counter < 100_000; counter++) {
    const hex = bytesToHex(sha256(enc.encode(`ride-calibration-${counter}`)))
    const k = lineTerrainK(hex)
    if (CALIBRATION_KS.includes(k) && !found.has(k)) found.set(k, hex)
  }
  return CALIBRATION_KS.filter((k) => found.has(k)).map((k) => found.get(k) as string)
}

/**
 * Measure ms per average block on this machine, once. Times 8 synthetic
 * leaves on the main thread, derives ms per Cantor pairing, and scales to the
 * §5.7 expected pairings of the mean block. Idempotent; concurrent and later
 * calls share the first measurement.
 */
export function calibrate(): Promise<number> {
  if (calibrating) return calibrating
  calibrating = (async () => {
    const previousEventIdHex = 'ca'.repeat(32)
    const hashes = calibrationHashes()
    const started = performance.now()
    for (let i = 0; i < hashes.length; i++) {
      computeRideLeaf(previousEventIdHex, 1_000 + i, hashes[i])
    }
    const elapsed = performance.now() - started
    benchmarkMs = (elapsed / exactRidePairs(hashes)) * expectedRidePairs(1)
    return benchmarkMs
  })()
  return calibrating
}

/** The cached calibration, null until calibrate() first resolves. */
export function leafBenchmarkMs(): number | null {
  return benchmarkMs
}
