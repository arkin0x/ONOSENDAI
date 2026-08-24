/**
 * headers.worker.ts - downloads, verifies and derives the header blobs.
 *
 * Roughly two million sha256 evaluations for the full chain plus a landfall
 * derivation for every plane-0 block: seconds of work that must never touch
 * the main thread. The worker walks the manifest's blobs in order, carrying
 * the chain state (prev hash + bits window) across blob boundaries, and posts
 * each verified blob back as flat columns with transferred buffers, so the
 * handoff is a pointer move rather than a million-object structured clone.
 *
 * Raw blob bytes are kept in the Cache API keyed by URL: a reload skips the
 * network entirely but still re-verifies, which is cheap here and means the
 * cache is never trusted, only reused. Every browser-only API is feature
 * checked so importing this module under node (tests, SSR tooling) is safe.
 */

import { sha256Hex } from 'cyberspace-core'
import { EMBEDDED_CHECKPOINTS } from '../lib/hyperspace/checkpoints'
import {
  checkpointState,
  genesisState,
  verifyAndDerive,
  type BlobColumns,
  type ChainState,
} from '../lib/hyperspace/headers'
import type { HeadersManifest } from '../lib/hyperspace/headerSync'

export interface HeadersRequest {
  type: 'sync'
  manifest: HeadersManifest
  manifestUrl: string
}

export type HeadersResponse =
  | { type: 'progress'; startHeight: number; verified: number; count: number }
  | { type: 'blob'; columns: BlobColumns }
  | { type: 'blob-failed'; startHeight: number; count: number; reason: string }
  | { type: 'done' }

const CACHE_NAME = 'onosendai:headers-v1'

/** Throttle progress posts; per-record reporting would flood the channel. */
const PROGRESS_INTERVAL_MS = 120

/** Digest bytes with the platform's native hash when present (the blobs are
 * megabytes); the pure-JS fallback keeps node imports working. */
async function digestHex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const digest = await subtle.digest('SHA-256', bytes as BufferSource)
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return sha256Hex(bytes)
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null
  try {
    return await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

/**
 * The blob's bytes, from cache when the digest still matches, else the
 * network. Throws with a human reason; the caller turns that into a
 * blob-failed message.
 */
async function loadBlobBytes(url: string, expectedSha256: string): Promise<Uint8Array> {
  const cache = await openCache()
  if (cache) {
    try {
      const hit = await cache.match(url)
      if (hit) {
        const bytes = new Uint8Array(await hit.arrayBuffer())
        if ((await digestHex(bytes)) === expectedSha256) return bytes
        // Stale or corrupt cache entry (e.g. the release was re-cut): drop it
        // and fall through to the network.
        await cache.delete(url)
      }
    } catch { /* a broken cache read is just a cache miss */ }
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if ((await digestHex(bytes)) !== expectedSha256) {
    throw new Error('blob bytes do not match the manifest sha256')
  }
  if (cache) {
    try {
      await cache.put(url, new Response(bytes))
    } catch { /* cache write is best effort */ }
  }
  return bytes
}

function post(msg: HeadersResponse, transfer?: Transferable[]): void {
  if (transfer) self.postMessage(msg, { transfer })
  else self.postMessage(msg)
}

self.onmessage = async (event: MessageEvent<HeadersRequest>) => {
  const { manifest, manifestUrl } = event.data
  const embedded = new Map(EMBEDDED_CHECKPOINTS.map((c) => [c.height, c.blockHash]))
  const manifestCp = new Map(manifest.checkpoints.map((c) => [c.height, c.blockHash]))

  // Chain state carried blob to blob; null after a discarded blob, until the
  // next one can be re-seeded from a checkpoint.
  let state: ChainState | null = genesisState()

  for (const blob of manifest.blobs) {
    const fail = (reason: string): void => {
      post({ type: 'blob-failed', startHeight: blob.startHeight, count: blob.count, reason })
      state = null
    }
    const finalHeight = blob.startHeight + blob.count - 1
    const finalHashHex = manifestCp.get(finalHeight)
    if (finalHashHex === undefined) {
      fail('manifest has no checkpoint for this blob')
      continue
    }
    // The embedded list is the stronger opinion: a manifest checkpoint that
    // disagrees with it means the manifest host is wrong (or hostile).
    const pinned = embedded.get(finalHeight)
    if (pinned !== undefined && pinned !== finalHashHex) {
      fail('manifest checkpoint disagrees with the embedded checkpoint')
      continue
    }
    if (state === null) {
      // The previous blob was discarded, so its final hash cannot seed the
      // linkage. Re-seed from the previous blob's checkpoint, cross-checked
      // against the embedded copy when we have one.
      const prevCp = manifestCp.get(blob.startHeight - 1)
      const prevPinned = embedded.get(blob.startHeight - 1)
      if (prevCp === undefined || (prevPinned !== undefined && prevPinned !== prevCp)) {
        fail('no trustworthy linkage seed after a discarded blob')
        continue
      }
      state = checkpointState(prevCp)
    }

    let bytes: Uint8Array
    try {
      bytes = await loadBlobBytes(new URL(blob.file, manifestUrl).toString(), blob.sha256)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
      continue
    }

    let lastProgress = 0
    const verdict = verifyAndDerive(
      bytes,
      blob.startHeight,
      blob.count,
      state,
      { finalHashHex, embedded },
      (verified) => {
        const now = performance.now()
        if (now - lastProgress < PROGRESS_INTERVAL_MS) return
        lastProgress = now
        post({ type: 'progress', startHeight: blob.startHeight, verified, count: blob.count })
      },
    )
    if (!verdict.ok) {
      fail(verdict.reason)
      continue
    }
    state = verdict.state
    const c = verdict.columns
    post({ type: 'blob', columns: c }, [
      c.keys.buffer,
      c.kinds.buffer,
      c.merkles.buffer,
      c.hashes.buffer,
      c.coords.buffer,
      c.order.buffer,
    ])
  }

  post({ type: 'done' })
}
