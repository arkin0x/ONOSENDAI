/**
 * headerBook.ts - Bitcoin header times and hashes for the seeds clock.
 *
 * A seed's planted height is clamped by header times (DECK-0008 §4.2): the
 * median time past at the clock decides when it is settled, and the times
 * around its `created_at` decide its floor and ceiling. The hyperspace index
 * holds block hashes but no times, so the times come from two places:
 *
 *   - the header blobs (lib/hyperspace/headerSync.ts), which end at 971,999.
 *     A blob's records rebuild every 80-byte header, and the chain of their
 *     hashes must end at the manifest's checkpoint for the blob's last block,
 *     itself checked against the embedded checkpoints (blobChainTimes);
 *   - kind 321 anchors from the trusted NTH publisher, which carry a `header`
 *     tag from 975,256 on (DECK-0001 §2.5). A header is used only after its
 *     double SHA-256, reversed, equals the anchor's `H`, and only from an
 *     anchor whose signature is NTH's (headerOfAnchor). The relay pool skips
 *     signature checks on 321 (lib/relay.ts getPool), so this checks it.
 *
 * Anchors are fetched by `authors` and `#B` for the heights a seed needs, never
 * through the stop index, which keeps the first anchor it saw for a height and
 * may hold one without a header. A height asked for and not found is marked
 * absent for a while, so a seed that needs it reads as waiting for blocks
 * instead of asking again on every frame.
 */

import { decodeCompactTarget, hashMeetsTarget, readRecord, reverse32, sha256d, wireHeader, HEADER_RECORD_SIZE } from '../hyperspace/headers'
import { bytesToHex, hexToBytes, type NostrEvent } from '../events'
import { verifyOnce } from '../verifiedSigs'

/** The NTH anchor publisher this client trusts for header times (DECK-0001 §2.5, "signed by a publisher the reader trusts"). */
export const NTH_PUBKEY = 'c6e74d44d41fce3b117c1129feacd182918e9fa3b3239579081de9172c4bf5e6'

/** A header checked against the `H` it hashes to. */
export interface VerifiedHeader {
  height: number
  /** Display-order block hash, 64 lowercase hex. */
  hash: string
  /** The header's `time` field, Unix seconds. */
  time: number
}

const HEX64 = /^[0-9a-f]{64}$/
const HEX160 = /^[0-9a-f]{160}$/
const DECIMAL = /^(0|[1-9][0-9]*)$/

/**
 * The least work a header's own `bits` may claim: a target with at least this
 * many leading zero bits (DECK-0001 §2.5, the proof-of-work SHOULD). Mainnet
 * has been past 72 since 2019; 64 is far below it and far above anything a
 * forger could mine for free.
 */
export const HEADER_MIN_ZERO_BITS = 64

function leadingZeroBits(bytes: Uint8Array): number {
  let n = 0
  for (const b of bytes) {
    if (b === 0) { n += 8; continue }
    return n + Math.clz32(b) - 24
  }
  return n
}

/** A wire header's `time`: bytes 68 to 71, little-endian. */
export function headerTimeOf(header: Uint8Array): number {
  return new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(68, true)
}

/** A wire header's `bits`: bytes 72 to 75, little-endian. */
function headerBitsOf(header: Uint8Array): number {
  return new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(72, true)
}

/**
 * The header an anchor carries, verified, or null (DECK-0001 §2.5): a kind
 * 321 signed by NTH, with a decimal `B`, a 64-hex `H`, and exactly one
 * `header` tag of 160 lowercase hex whose double SHA-256, reversed, is `H`,
 * and whose hash meets the target its own `bits` encode, a target no easier
 * than HEADER_MIN_ZERO_BITS.
 */
export function headerOfAnchor(ev: Pick<NostrEvent, 'kind' | 'pubkey' | 'tags'> & Partial<NostrEvent>, verify: (ev: NostrEvent) => boolean = verifyOnce): VerifiedHeader | null {
  if (!ev || ev.kind !== 321 || ev.pubkey !== NTH_PUBKEY || !Array.isArray(ev.tags)) return null
  const first = (name: string): string | undefined => ev.tags.find((t) => Array.isArray(t) && t[0] === name && typeof t[1] === 'string')?.[1]
  const b = first('B')
  const h = first('H')
  if (b === undefined || !DECIMAL.test(b) || h === undefined || !HEX64.test(h)) return null
  const height = Number(b)
  if (!Number.isSafeInteger(height)) return null
  const headers = ev.tags.filter((t) => Array.isArray(t) && t[0] === 'header')
  if (headers.length !== 1 || typeof headers[0][1] !== 'string' || !HEX160.test(headers[0][1])) return null
  const bytes = hexToBytes(headers[0][1])
  const display = reverse32(sha256d(bytes))
  if (bytesToHex(display) !== h) return null
  const target = decodeCompactTarget(headerBitsOf(bytes))
  if (!target || leadingZeroBits(target) < HEADER_MIN_ZERO_BITS || !hashMeetsTarget(display, target)) return null
  // Last, as it is the dearest check: a Schnorr verification.
  let signed = false
  try { signed = verify(ev as NostrEvent) } catch { signed = false }
  if (!signed) return null
  return { height, hash: h, time: headerTimeOf(bytes) }
}

/** One header blob's times and block hashes (display order, 32 bytes a block), from `start`. */
export interface BlobHeaders {
  start: number
  times: Uint32Array
  hashes: Uint8Array
}

/**
 * Every header time and block hash of one header blob, or null when its chain
 * does not hold: each record is rebuilt into its wire header with the
 * previous block's hash, and the last block's hash must be
 * `finalHashDisplay`, the manifest's checkpoint (already checked against the
 * embedded list by the caller). The chain of hashes commits every header to
 * that checkpoint, so every time and hash in it is the real block's. Pure;
 * runs in the seeds worker.
 */
export function blobChainTimes(bytes: Uint8Array, count: number, prevHashDisplay: string, finalHashDisplay: string): { times: Uint32Array; hashes: Uint8Array } | null {
  if (bytes.byteLength !== count * HEADER_RECORD_SIZE || !HEX64.test(prevHashDisplay) || !HEX64.test(finalHashDisplay)) return null
  const times = new Uint32Array(count)
  const hashes = new Uint8Array(count * 32)
  let prev = reverse32(hexToBytes(prevHashDisplay))
  for (let i = 0; i < count; i++) {
    const rec = readRecord(bytes, i)
    times[i] = rec.time
    prev = sha256d(wireHeader(rec, prev))
    hashes.set(reverse32(prev), i * 32)
  }
  return bytesToHex(reverse32(prev)) === finalHashDisplay ? { times, hashes } : null
}

/** How long a height asked for and not found stays absent before it is asked for again. */
export const ABSENT_MS = 5 * 60_000

/** Header times and hashes by height, as far as this page has them. */
export class HeaderBook {
  private times = new Map<number, number>()
  private hashes = new Map<number, string>()
  /** Whole blobs, kept as their arrays: 50,000 heights each, never 50,000 map entries. */
  private blobs: BlobHeaders[] = []
  private absent = new Map<number, number>()
  private listeners = new Set<() => void>()
  /** Rises whenever a header is added. */
  version = 0

  constructor(private now: () => number = () => Date.now()) {}

  private blobOf(height: number): BlobHeaders | undefined {
    return this.blobs.find((b) => height >= b.start && height < b.start + b.times.length)
  }

  time(height: number): number | undefined {
    const t = this.times.get(height)
    if (t !== undefined) return t
    const b = this.blobOf(height)
    return b ? b.times[height - b.start] : undefined
  }

  hash(height: number): string | undefined {
    const h = this.hashes.get(height)
    if (h !== undefined) return h
    const b = this.blobOf(height)
    return b ? bytesToHex(b.hashes.subarray((height - b.start) * 32, (height - b.start + 1) * 32)) : undefined
  }

  has(height: number): boolean { return this.times.has(height) || this.blobOf(height) !== undefined }

  /** The highest height with a header, or null: the trusted tip, when the book is fed NTH's newest anchors. */
  top(): number | null {
    let top: number | null = null
    for (const h of this.times.keys()) if (top === null || h > top) top = h
    return top
  }

  /** True while a height was asked for and not found, less than ABSENT_MS ago. */
  isAbsent(height: number): boolean {
    const until = this.absent.get(height)
    return until !== undefined && until > this.now()
  }

  markAbsent(heights: Iterable<number>): void {
    const until = this.now() + ABSENT_MS
    for (const h of heights) if (!this.has(h)) this.absent.set(h, until)
  }

  add(header: VerifiedHeader): void {
    if (this.times.get(header.height) === header.time && this.hashes.get(header.height) === header.hash) return
    this.times.set(header.height, header.time)
    this.hashes.set(header.height, header.hash)
    this.absent.delete(header.height)
    this.bump()
  }

  /** Times from injected headers (tests), `times[i]` at `startHeight + i`. */
  addTimes(startHeight: number, times: ArrayLike<number>): void {
    for (let i = 0; i < times.length; i++) {
      this.times.set(startHeight + i, times[i])
      this.absent.delete(startHeight + i)
    }
    if (times.length > 0) this.bump()
  }

  /** A verified blob, whole (blobChainTimes). */
  addBlob(blob: BlobHeaders): void {
    if (blob.hashes.length !== blob.times.length * 32 || this.blobs.some((b) => b.start === blob.start)) return
    this.blobs.push(blob)
    for (const h of [...this.absent.keys()]) if (h >= blob.start && h < blob.start + blob.times.length) this.absent.delete(h)
    this.bump()
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private bump(): void {
    this.version++
    for (const l of this.listeners) l()
  }
}

/** How many `#B` values one anchor query carries. */
export const B_PER_QUERY = 100

/** A read of anchors, the relays' (lib/relay.ts query) or a test's. */
export type AnchorQuery = (filter: { kinds: number[]; authors: string[]; '#B': string[]; limit: number }) => Promise<NostrEvent[]>

/**
 * Fetch the headers of `heights` from NTH's anchors into `book`: by authors
 * and `#B`, a hundred heights a query, keeping only headers that verify. A
 * height that came back without one is marked absent. Heights the book
 * holds, or knows to be absent, are not asked for.
 */
export async function fetchAnchorHeaders(book: HeaderBook, heights: Iterable<number>, query: AnchorQuery, verify?: (ev: NostrEvent) => boolean): Promise<void> {
  const want = [...new Set(heights)].filter((h) => h >= 0 && !book.has(h) && !book.isAbsent(h)).sort((a, b) => a - b)
  const ask = async (chunk: number[]): Promise<void> => {
    let events: NostrEvent[] = []
    try {
      events = await query({ kinds: [321], authors: [NTH_PUBKEY], '#B': chunk.map(String), limit: chunk.length * 3 })
    } catch { events = [] }
    for (const ev of events) {
      const header = headerOfAnchor(ev, verify)
      if (header && chunk.includes(header.height)) book.add(header)
    }
  }
  for (let i = 0; i < want.length; i += B_PER_QUERY) {
    const chunk = want.slice(i, i + B_PER_QUERY)
    await ask(chunk)
    // Asked once more, on their own, before they count as absent: several
    // anchors to a height (§2.5) can fill a query's limit before every height is in.
    const missing = chunk.filter((h) => !book.has(h))
    if (missing.length > 0 && missing.length < chunk.length) await ask(missing)
    book.markAbsent(chunk)
  }
}

/** NTH's newest anchors, verified, into the book: its top is then the tip this client trusts. */
export async function fetchNthTip(book: HeaderBook, query: (filter: { kinds: number[]; authors: string[]; limit: number }) => Promise<NostrEvent[]>, verify?: (ev: NostrEvent) => boolean): Promise<number | null> {
  let events: NostrEvent[] = []
  try { events = await query({ kinds: [321], authors: [NTH_PUBKEY], limit: 12 }) } catch { events = [] }
  for (const ev of events) {
    const header = headerOfAnchor(ev, verify)
    if (header) book.add(header)
  }
  return book.top()
}
