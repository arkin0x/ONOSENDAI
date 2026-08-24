/**
 * headerSync.ts: fetch the header-blob manifest and drive the verify worker.
 *
 * The manifest is a small JSON published next to the blobs; it is the only
 * thing fetched on the main thread. Everything heavy (blob download, digest,
 * chain verification, stop derivation) happens in headers.worker.ts, and the
 * results come back as transferable columns. A missing or malformed manifest
 * is NOT an error: the caller logs once and the relay path covers everything,
 * exactly as before blobs existed.
 *
 * The manifest URL lives here so there is one config spot. For development
 * against locally packaged blobs, set
 * localStorage['onosendai:headersManifest'] to any URL; blob files resolve
 * relative to wherever the manifest came from.
 */

import type { BlobColumns } from './headers'
import type { HeadersRequest, HeadersResponse } from '../../workers/headers.worker'

// raw.githubusercontent, not a release asset: release downloads send no
// access-control-allow-origin header and are unfetchable from a browser,
// raw sends *. The headers-v1 branch holds only the blobs, the manifest,
// and a README.
export const HEADERS_MANIFEST_URL =
  'https://raw.githubusercontent.com/arkin0x/nth/headers-v1/manifest.json'

const MANIFEST_OVERRIDE_KEY = 'onosendai:headersManifest'

export interface ManifestBlob {
  ordinal: number
  startHeight: number
  count: number
  /** sha256 of the blob file's bytes, 64 lowercase hex. */
  sha256: string
  file: string
}

export interface ManifestCheckpoint {
  height: number
  /** Display-order block hash of the LAST block of a blob. */
  blockHash: string
}

export interface HeadersManifest {
  formatVersion: 1
  network: 'mainnet'
  blobSize: number
  generatedAtHeight: number
  blobs: ManifestBlob[]
  checkpoints: ManifestCheckpoint[]
}

export function manifestUrl(): string {
  // localStorage can throw in odd embeddings; the default must survive that.
  try {
    if (typeof localStorage !== 'undefined') {
      const override = localStorage.getItem(MANIFEST_OVERRIDE_KEY)
      if (override) return override
    }
  } catch { /* fall through to the default */ }
  return HEADERS_MANIFEST_URL
}

/** Blob file URLs resolve relative to the manifest they were named in. */
export function blobUrl(manifest: string, file: string): string {
  return new URL(file, manifest).toString()
}

const HEX64 = /^[0-9a-f]{64}$/

/**
 * Validate an untrusted manifest into a HeadersManifest, or null. Strict on
 * the invariants verification leans on: ordinals contiguous from zero, each
 * blob starting exactly at ordinal * blobSize, only the last blob partial.
 */
export function parseManifest(raw: unknown): HeadersManifest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  if (m.formatVersion !== 1 || m.network !== 'mainnet') return null
  const blobSize = m.blobSize
  const generatedAtHeight = m.generatedAtHeight
  if (!Number.isSafeInteger(blobSize) || (blobSize as number) <= 0) return null
  if (!Number.isSafeInteger(generatedAtHeight) || (generatedAtHeight as number) < 0) return null
  if (!Array.isArray(m.blobs) || !Array.isArray(m.checkpoints)) return null
  const blobs: ManifestBlob[] = []
  for (const entry of m.blobs as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return null
    const b = entry as Record<string, unknown>
    const { ordinal, startHeight, count, sha256, file } = b
    if (!Number.isSafeInteger(ordinal) || (ordinal as number) !== blobs.length) return null
    if (startHeight !== (ordinal as number) * (blobSize as number)) return null
    if (!Number.isSafeInteger(count) || (count as number) <= 0 || (count as number) > (blobSize as number)) return null
    if ((count as number) < (blobSize as number) && (ordinal as number) !== (m.blobs as unknown[]).length - 1) return null
    if (typeof sha256 !== 'string' || !HEX64.test(sha256)) return null
    if (typeof file !== 'string' || file.length === 0) return null
    blobs.push({
      ordinal: ordinal as number,
      startHeight: startHeight as number,
      count: count as number,
      sha256,
      file,
    })
  }
  const checkpoints: ManifestCheckpoint[] = []
  for (const entry of m.checkpoints as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return null
    const c = entry as Record<string, unknown>
    if (!Number.isSafeInteger(c.height) || (c.height as number) < 0) return null
    if (typeof c.blockHash !== 'string' || !HEX64.test(c.blockHash)) return null
    checkpoints.push({ height: c.height as number, blockHash: c.blockHash })
  }
  return {
    formatVersion: 1,
    network: 'mainnet',
    blobSize: blobSize as number,
    generatedAtHeight: generatedAtHeight as number,
    blobs,
    checkpoints,
  }
}

/**
 * Fetch and validate the manifest, or null on any failure. Null is the
 * degrade-to-relay signal, so this logs its one warning here and never
 * throws.
 */
export async function fetchManifest(): Promise<{ manifest: HeadersManifest; url: string } | null> {
  if (typeof fetch === 'undefined') return null
  const url = manifestUrl()
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const manifest = parseManifest(await res.json())
    if (!manifest) throw new Error('malformed manifest')
    return { manifest, url }
  } catch (e) {
    console.warn('[hyperspace] header manifest unavailable, syncing everything from the relay:', e)
    return null
  }
}

export interface HeaderSyncHandlers {
  /** Records verified so far within the blob currently being walked. */
  onProgress: (startHeight: number, verified: number) => void
  /** A verified blob's derived columns, in ascending blob order. */
  onColumns: (cols: BlobColumns) => void
  /** A discarded blob; its range must fall back to relay sync. */
  onBlobFailed: (startHeight: number, count: number, reason: string) => void
}

export interface HeaderSyncResult {
  /** Verified inclusive height ranges, ascending, one per delivered blob. */
  covered: Array<[number, number]>
}

/**
 * Run the worker over every blob in the manifest. Resolves (never rejects)
 * when the worker reports done or dies; whatever verified before a crash is
 * kept and the rest is the relay's job.
 */
export function runHeaderSync(
  manifest: HeadersManifest,
  url: string,
  handlers: HeaderSyncHandlers,
): Promise<HeaderSyncResult> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('../../workers/headers.worker.ts', import.meta.url), {
      type: 'module',
    })
    const covered: Array<[number, number]> = []
    const finish = (): void => {
      worker.terminate()
      resolve({ covered })
    }
    worker.onmessage = (event: MessageEvent<HeadersResponse>) => {
      const msg = event.data
      if (msg.type === 'progress') {
        handlers.onProgress(msg.startHeight, msg.verified)
      } else if (msg.type === 'blob') {
        covered.push([msg.columns.startHeight, msg.columns.startHeight + msg.columns.count - 1])
        handlers.onColumns(msg.columns)
      } else if (msg.type === 'blob-failed') {
        handlers.onBlobFailed(msg.startHeight, msg.count, msg.reason)
      } else {
        finish()
      }
    }
    // A worker that throws never posts done; without this the sync pipeline
    // would hang forever instead of falling back to the relay.
    worker.onerror = (event) => {
      console.warn('[hyperspace] headers worker failed:', event.message)
      finish()
    }
    const request: HeadersRequest = { type: 'sync', manifest, manifestUrl: url }
    worker.postMessage(request)
  })
}
