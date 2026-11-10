/**
 * seedSources.ts - the page's DNA resolver and header book, wired to the
 * relays, IndexedDB, the header blobs and the seeds worker.
 *
 * Header times and block hashes for heights the blobs cover (up to the
 * manifest's last block, 971,999 today) are read out of the blob in the
 * worker, its chain checked; every other height comes from NTH's anchors by
 * `authors` and `#B`, each header hashed to its `H` and signed by NTH
 * (headerBook.ts). The stop index is never asked: any key can publish a
 * kind 321, and the index keeps whichever it saw first. So the clock's tip is
 * NTH's newest verified anchor, and every hash that drives a bloom's weather
 * is one of these.
 */

import { query } from '../relay'
import type { NostrEvent } from '../events'
import { fetchManifest, blobUrl, type HeadersManifest } from '../hyperspace/headerSync'
import { EMBEDDED_CHECKPOINTS } from '../hyperspace/checkpoints'
import { DnaResolver, idbDnaCache } from './dnaStore'
import { fetchAnchorHeaders, fetchNthTip, HeaderBook } from './headerBook'
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
    if (answer.type === 'blob-times' && answer.times && answer.hashes) headerBook.addBlob({ start, times: answer.times, hashes: answer.hashes })
    // A blob that failed may be read again on a later pass.
    else blobsRead.delete(start)
  })()
  blobsRead.set(start, job)
  return job
}

/**
 * The first height whose NTH anchor carries a `header` tag (DECK-0001 §2.5,
 * published from 2026-11-09). Between the blobs' end and this, nobody has a
 * header to give, so those heights are not asked for: a seed that needs one
 * waits for blocks.
 */
export const HEADER_TAG_FROM = 975_256

/** Heights being fetched now: a seed that needs one waits for that fetch rather than sending its own. */
const inFlight = new Map<number, Promise<void>>()

/** Fetch the headers at these heights into the book: blob heights from the blobs, the rest from anchors. */
export async function fetchSeedHeaders(heights: number[]): Promise<void> {
  const want = [...new Set(heights)].filter((h) => !headerBook.has(h) && !headerBook.isAbsent(h))
  const waiting = [...new Set(want.map((h) => inFlight.get(h)).filter((p): p is Promise<void> => p !== undefined))]
  const fresh = want.filter((h) => !inFlight.has(h))
  if (fresh.length > 0) {
    const job = fetchFresh(fresh).finally(() => { for (const h of fresh) if (inFlight.get(h) === job) inFlight.delete(h) })
    for (const h of fresh) inFlight.set(h, job)
    waiting.push(job)
  }
  await Promise.all(waiting)
}

async function fetchFresh(want: number[]): Promise<void> {
  manifest ??= fetchManifest()
  const m = await manifest
  // A manifest that could not be fetched is asked for again next time, not taken as no blobs for the session.
  if (!m) manifest = null
  const end = m ? m.manifest.blobs.reduce((top, b) => Math.max(top, b.startHeight + b.count - 1), -1) : -1
  const inBlobs = want.filter((h) => h <= end)
  const gap = want.filter((h) => h > end && h < HEADER_TAG_FROM)
  const rest = want.filter((h) => h > end && h >= HEADER_TAG_FROM)
  if (m && inBlobs.length > 0) {
    const starts = new Set(inBlobs.map((h) => Math.floor(h / m.manifest.blobSize) * m.manifest.blobSize))
    await Promise.all([...starts].map((s) => readBlob(m.manifest, m.url, s)))
    headerBook.markAbsent(inBlobs)
  }
  // Without a manifest the blob heights are in the gap too, and wait until it can be fetched.
  headerBook.markAbsent(gap)
  if (rest.length > 0) await fetchAnchorHeaders(headerBook, rest, (filter) => query(filter) as Promise<NostrEvent[]>)
}

/** How long the trusted tip is left before NTH is asked again, when nothing else says a block came. */
export const TIP_REFRESH_MS = 2 * 60_000

let tipJob: Promise<number | null> | null = null
let tipAt = 0
let trusted: number | null = null

/** The tip this client trusts for the seeds clock: NTH's newest verified anchor, or null before one is known. */
export function trustedTip(): number | null {
  return trusted
}

/**
 * Ask NTH for its newest anchors, unless asked within the last few seconds.
 * `hint` is the hyperspace line's own tip (any key's anchors): when it is
 * higher than the trusted one, a block came and NTH is asked now.
 */
export function refreshTrustedTip(hint: number | null = null, now = Date.now()): Promise<number | null> {
  const stale = now - tipAt > TIP_REFRESH_MS
  const behind = hint !== null && (trusted === null || hint > trusted)
  if (tipJob || (!stale && !behind) || now - tipAt < 5_000) return tipJob ?? Promise.resolve(trusted)
  tipAt = now
  tipJob = fetchNthTip(headerBook, (filter) => query(filter) as Promise<NostrEvent[]>)
    .then((top) => { if (top !== null && (trusted === null || top > trusted)) trusted = top; return trusted })
    .finally(() => { tipJob = null })
  return tipJob
}
