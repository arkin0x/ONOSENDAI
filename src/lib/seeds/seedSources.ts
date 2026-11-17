/**
 * seedSources.ts - the page's DNA resolver and header book, wired to the
 * relays, IndexedDB, the header blobs and the seeds worker.
 *
 * Header times and block hashes for heights the blobs cover (up to the
 * manifest's last block, 975,226 since nth#10) are read out of the blob in the
 * worker, its chain checked; every other height comes from NTH's anchors by
 * `authors` and `#B`, each header hashed to its `H` and signed by NTH
 * (headerBook.ts). The stop index is never asked: any key can publish a
 * kind 321, and the index keeps whichever it saw first. So the clock's tip is
 * NTH's newest verified anchor, and every hash that drives a bloom's weather
 * is one of these.
 *
 * Everything verified is kept in IndexedDB (seedsDb.ts): the headers, so the
 * trusted tip and every header a seed read last visit are there on a refresh,
 * and each seed's settled planted height. headersReady() reads them back
 * before the first seed is looked at; then only newer blocks are fetched.
 */

import { query } from '../relay'
import type { NostrEvent } from '../events'
import { fetchManifest, blobUrl, type HeadersManifest } from '../hyperspace/headerSync'
import { EMBEDDED_CHECKPOINTS } from '../hyperspace/checkpoints'
import { DnaResolver, idbDnaCache } from './dnaStore'
import { fetchAnchorHeaders, fetchNthTip, HeaderBook } from './headerBook'
import { blobTimesInWorker } from './growClient'
import { DNA_KIND, setBagDnaSink } from './seedItem'
import { SEED_DNA_EVENTS } from './seedDnas'
import { queryEach } from '../relay'
import { mergeAnswers } from '../relayOutcome'
import type { AnchorRead, VerifiedHeader } from './headerBook'
import { loadHeaders, loadPlanted, saveHeaders, savePlanted, type HeaderRow, type PlantedRow } from './seedsDb'

/** The DNAs this page knows: one resolver for every seed. */
export const dnaResolver = new DnaResolver({
  // A relay taken for hung is asked too: a few events by id, and a DNA may be on one relay only.
  fetch: (ids) => query({ ids, kinds: [DNA_KIND] }, { evenHung: true }),
  ...idbDnaCache,
})

setBagDnaSink((ev) => dnaResolver.note(ev as NostrEvent))
// The owner's published DNAs SEED lists ship with the app: planting one, or
// growing a seed of one, needs no relay for its DNA (checked when asked for).
dnaResolver.hold(SEED_DNA_EVENTS)

/** Header times and hashes this page has read. */
export const headerBook = new HeaderBook()

/** Headers added since the last write, by height, written together a moment later. */
const unsaved = new Map<number, HeaderRow>()
let saveQueued = false
/** How long new headers wait to be written together. */
export const SAVE_DELAY_MS = 500

function queueSave(rows: HeaderRow[]): void {
  for (const r of rows) unsaved.set(r.height, r)
  if (saveQueued) return
  saveQueued = true
  setTimeout(() => {
    saveQueued = false
    const batch = [...unsaved.values()]
    unsaved.clear()
    void saveHeaders(batch)
  }, SAVE_DELAY_MS)
}

// Every header NTH gave, kept for the next visit (a newer one for a height replaces it).
headerBook.onHeader((h: VerifiedHeader) => queueSave([{ height: h.height, hash: h.hash, time: h.time }]))

/** Settled planted heights by seed id: kept ones, then this visit's. */
const planted = new Map<string, PlantedRow>()

/** A seed's planted height as settled before (at this clock or an earlier one), or undefined. */
export function settledBefore(id: string): PlantedRow | undefined {
  return planted.get(id)
}

/** Keep a seed's settled planted height. The lowest clock it was settled at is kept: E and F stand from then on (§4.2). */
export function noteSettled(row: PlantedRow): void {
  const was = planted.get(row.id)
  if (was && was.clock <= row.clock && was.height === row.height && was.E === row.E && was.F === row.F) return
  planted.set(row.id, row)
  void savePlanted([row])
}

let ready: Promise<void> | null = null

/**
 * What was kept from the last visit, read into the book and the planted
 * heights once: the trusted tip is then the highest header kept, so seeds grow
 * at once to where they were, and the network only moves them on. Never
 * rejects; with nothing kept (a first visit) it changes nothing, and seeds
 * wait for blocks as before.
 */
export function headersReady(): Promise<void> {
  ready ??= (async () => {
    const [rows, settled] = await Promise.all([loadHeaders(), loadPlanted()])
    headerBook.addCached(rows)
    for (const r of settled) if (!planted.has(r.id)) planted.set(r.id, r)
    const top = headerBook.top()
    // Never lower: a tip this visit already has from NTH stands.
    if (top !== null && (trusted === null || top > trusted)) trusted = top
  })().catch(() => undefined)
  return ready
}

/**
 * A read of NTH's anchors from every relay, saying whether any answered (sent
 * EOSE): a read nobody answered is not taken as "these headers do not exist"
 * (headerBook fetchAnchorHeaders).
 */
async function anchorRead(filter: Parameters<typeof query>[0]): Promise<AnchorRead> {
  const answers = await queryEach(filter)
  return { events: mergeAnswers(answers), answered: answers.some((a) => a.outcome === 'answered') }
}

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
 * published from 2026-11-09). Between the blobs' end and this (975,227 to
 * 975,255 today), nobody has a header to give, so those heights are not asked
 * for. A seed settled below them is judged there (seedClock settlePlanted);
 * one that needs them waits for blocks.
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
    // The heights asked of the blobs, kept like NTH's: checked to the manifest's checkpoint, so the next visit reads no blob for them.
    const read: HeaderRow[] = []
    for (const h of inBlobs) {
      const time = headerBook.time(h)
      const hash = headerBook.hash(h)
      if (time !== undefined && hash !== undefined) read.push({ height: h, hash, time })
    }
    if (read.length > 0) queueSave(read)
  }
  // Without a manifest the blob heights are in the gap too, and wait until it can be fetched.
  headerBook.markAbsent(gap)
  if (rest.length > 0) await fetchAnchorHeaders(headerBook, rest, anchorRead)
}

/** How long the trusted tip is left before NTH is asked again, when nothing else says a block came. */
export const TIP_REFRESH_MS = 2 * 60_000
/** How soon NTH is asked again while no tip is known at all (a first visit whose first ask found nothing). */
export const TIP_RETRY_MS = 10_000

let tipJob: Promise<number | null> | null = null
let tipAt = 0
let trusted: number | null = null

/** The tip this client trusts for the seeds clock: NTH's newest verified anchor, or null before one is known. */
export function trustedTip(): number | null {
  return trusted
}

/**
 * Ask NTH for its newest anchors, unless asked within the last few seconds.
 * `force` asks even when the tip is recent (planting states the clock block now).
 * `hint` is the hyperspace line's own tip (any key's anchors): when it is
 * higher than the trusted one, a block came and NTH is asked now.
 */
export function refreshTrustedTip(hint: number | null = null, now = Date.now(), force = false): Promise<number | null> {
  const stale = force || now - tipAt > (trusted === null ? TIP_RETRY_MS : TIP_REFRESH_MS)
  const behind = hint !== null && (trusted === null || hint > trusted)
  if (tipJob || (!stale && !behind) || now - tipAt < 5_000) return tipJob ?? Promise.resolve(trusted)
  tipAt = now
  tipJob = fetchNthTip(headerBook, (filter) => query(filter) as Promise<NostrEvent[]>)
    .then((top) => { if (top !== null && (trusted === null || top > trusted)) trusted = top; return trusted })
    .finally(() => { tipJob = null })
  return tipJob
}
