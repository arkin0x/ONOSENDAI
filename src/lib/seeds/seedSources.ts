/**
 * seedSources.ts - the page's DNA resolver and header book, wired to the
 * relays, IndexedDB, the header blobs and the seeds worker.
 *
 * Header times for heights the blobs cover (up to the manifest's last block,
 * 971,999 today) are read out of the blob in the worker; every other height
 * comes from NTH's anchors by `authors` and `#B` (headerBook.ts).
 */

import { query } from '../relay'
import type { NostrEvent } from '../events'
import { fetchManifest, blobUrl, type HeadersManifest } from '../hyperspace/headerSync'
import { EMBEDDED_CHECKPOINTS } from '../hyperspace/checkpoints'
import { DnaResolver, idbDnaCache } from './dnaStore'
import { fetchAnchorHeaders, HeaderBook } from './headerBook'
import { blobTimesInWorker } from './growClient'
import { DNA_KIND, setBagDnaSink } from './seedItem'

/** The DNAs this page knows: one resolver for every seed. */
export const dnaResolver = new DnaResolver({
  fetch: (ids) => query({ ids, kinds: [DNA_KIND] }),
  ...idbDnaCache,
})

setBagDnaSink((ev) => dnaResolver.note(ev as NostrEvent))

/** Header times and hashes this page has read. */
export const headerBook = new HeaderBook()

const ZERO_HASH = '0'.repeat(64)
let manifest: Promise<{ manifest: HeadersManifest; url: string } | null> | null = null
/** Blobs read or being read, by start height. */
const blobsRead = new Map<number, Promise<void>>()

/** The manifest's checkpoint for a height, when the embedded list does not disagree with it. */
function checkpoint(m: HeadersManifest, height: number): string | null {
  if (height < 0) return ZERO_HASH
  const cp = m.checkpoints.find((c) => c.height === height)?.blockHash
  const pinned = EMBEDDED_CHECKPOINTS.find((c) => c.height === height)?.blockHash
  if (!cp || (pinned !== undefined && pinned !== cp)) return null
  return cp
}

function readBlob(m: HeadersManifest, url: string, start: number): Promise<void> {
  const known = blobsRead.get(start)
  if (known) return known
  const blob = m.blobs.find((b) => b.startHeight === start)
  const job = (async () => {
    if (!blob) return
    const prevHash = checkpoint(m, start - 1)
    const finalHash = checkpoint(m, start + blob.count - 1)
    if (!prevHash || !finalHash) return
    const answer = await blobTimesInWorker({ url: blobUrl(url, blob.file), sha256: blob.sha256, startHeight: start, count: blob.count, prevHash, finalHash })
    if (answer.type === 'blob-times' && answer.times) headerBook.addTimes(start, answer.times)
    // A blob that failed may be read again on a later pass.
    else blobsRead.delete(start)
  })()
  blobsRead.set(start, job)
  return job
}

/** Fetch the headers at these heights into the book: blob heights from the blobs, the rest from anchors. */
export async function fetchSeedHeaders(heights: number[]): Promise<void> {
  const want = heights.filter((h) => !headerBook.has(h) && !headerBook.isAbsent(h))
  if (want.length === 0) return
  manifest ??= fetchManifest()
  const m = await manifest
  const end = m ? m.manifest.blobs.reduce((top, b) => Math.max(top, b.startHeight + b.count - 1), -1) : -1
  const inBlobs = want.filter((h) => h <= end)
  const rest = want.filter((h) => h > end)
  if (m && inBlobs.length > 0) {
    const starts = new Set(inBlobs.map((h) => Math.floor(h / m.manifest.blobSize) * m.manifest.blobSize))
    await Promise.all([...starts].map((s) => readBlob(m.manifest, m.url, s)))
    headerBook.markAbsent(inBlobs)
  }
  if (rest.length > 0) await fetchAnchorHeaders(headerBook, rest, (filter) => query(filter) as Promise<NostrEvent[]>)
}
