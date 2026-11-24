/**
 * witness.ts - asking the witness when it first saw a layer and its settles
 * (DECK-0009 §7.4, "Asking the witness").
 *
 *   GET https://relay.onosendai.tech/witness/v1?ids=<id>,<id>,...
 *
 * answers `{"body": "<JSON text>", "sig": "<hex>"}`: a BIP-340 signature by
 * the witness key over sha256 of the decoded value of `body` (pure ASCII),
 * checked before the body is parsed. The witness key is taken from the
 * `self` field of the relay's NIP-11 document and pinned from then on. An
 * answer is refused on a bad signature, a body that is not ASCII, a key that
 * is not the pinned one, results that are not exactly the ids asked in
 * order, or a recorded layer whose settles are not its settle tags in order.
 * Parsed, each result is the event's receipt height (null when the witness
 * has recorded none) and, for a recorded layer, each settle with its W.
 *
 * A recorded height or W never changes, so every non-null answer is kept for
 * good; a null is asked again after a while. 400 means the request was wrong
 * (not retried soon); 429, a 5xx or no answer means the witness is
 * unreachable for now. Unreachable, or unverified, it teaches nothing: every
 * settle stays unwitnessed, the DECK's fallback, and rule 4 of §4.4 cannot
 * run. That is what runs until the relay serves this endpoint. Two signed
 * answers that disagree are proof the witness lied: both are kept, and it is
 * asked nothing more.
 */

import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'

export const WITNESS_URL = 'https://relay.onosendai.tech/witness/v1'
/** The canonical relay's NIP-11 document, which names the witness key. */
export const WITNESS_INFO_URL = 'https://relay.onosendai.tech'
/** At most this many ids in one request (§7.4). */
export const WITNESS_IDS_MAX = 100
/** How soon an id the witness had not recorded is asked about again (ms). */
export const WITNESS_RETRY_MS = 60_000

const HEX64 = /^[0-9a-f]{64}$/
const HEX128 = /^[0-9a-f]{128}$/

/** What the witness recorded for one event: when, and for a layer each settle's W. */
export interface WitnessRecord {
  height: number
  settles: Map<string, number>
}

const isHeight = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 2 ** 32

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16)
  return out
}

/**
 * Check and read one answer: the signature over the body as received, by
 * `key`; the body naming `key`; one result per asked id, in order. Returns
 * each recorded id's record (ids not recorded are left out), or null when
 * anything is wrong.
 */
export function readWitnessAnswer(text: string, key: string, ids: readonly string[], settleTags: ReadonlyMap<string, readonly string[]> = new Map()): Map<string, WitnessRecord> | null {
  if (!HEX64.test(key)) return null
  let outer: unknown
  try { outer = JSON.parse(text) } catch { return null }
  const o = outer as { body?: unknown; sig?: unknown } | null
  if (!o || typeof o.body !== 'string' || typeof o.sig !== 'string' || !HEX128.test(o.sig)) return null
  // The decoded body must be pure ASCII, so every reader hashes the same bytes.
  if (/[^\x00-\x7f]/.test(o.body)) return null
  let ok = false
  try { ok = schnorr.verify(hexBytes(o.sig), sha256(new TextEncoder().encode(o.body)), hexBytes(key)) } catch { ok = false }
  if (!ok) return null
  let body: unknown
  try { body = JSON.parse(o.body) } catch { return null }
  const b = body as { v?: unknown; witness?: unknown; tip?: unknown; results?: unknown } | null
  if (!b || b.v !== 1 || b.witness !== key || !isHeight(b.tip) || !Array.isArray(b.results) || b.results.length !== ids.length) return null
  const out = new Map<string, WitnessRecord>()
  for (let i = 0; i < ids.length; i++) {
    const r = b.results[i] as { id?: unknown; height?: unknown; settles?: unknown } | null
    if (!r || r.id !== ids[i] || !Array.isArray(r.settles)) return null
    if (r.height === null) continue
    if (!isHeight(r.height)) return null
    const settles = new Map<string, number>()
    const listed: string[] = []
    for (const s of r.settles) {
      if (!Array.isArray(s) || s.length !== 2 || typeof s[0] !== 'string' || !HEX64.test(s[0]) || !isHeight(s[1])) return null
      settles.set(s[0], s[1])
      listed.push(s[0])
    }
    // A recorded layer lists exactly its settle tags, in tag order; anything else (a movement action) lists none.
    const want = settleTags.get(ids[i]) ?? []
    if (listed.length !== want.length || listed.some((id, j) => id !== want[j])) return null
    out.set(ids[i], { height: r.height, settles })
  }
  return out
}

/** Fetch a URL: its status and text, or null for no answer at all (a timeout, a network failure). */
export type FetchText = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ status: number; text: string } | null>

/** Where the pinned witness key is kept between visits. */
export interface KeyPin {
  get: () => Promise<string | null>
  set: (key: string) => void
}

/** What the witness has said, kept; asked in batches; silent and harmless while it cannot be reached. */
export class WitnessBook {
  private key: string | null = null
  private pinRead = false
  private keyAsked = 0
  private known = new Map<string, WitnessRecord>()
  private unrecorded = new Map<string, number>()
  private seenW = new Map<string, number>()
  /** Two signed answers disagreed: the witness lied, and is asked nothing more. */
  lied = false

  constructor(private fetchText: FetchText, private now: () => number = () => Date.now(), private pin: KeyPin | null = null) {}

  /** The pinned witness key, else the NIP-11 `self` key, pinned from then on (asked at most once a minute while unknown). */
  private async witnessKey(): Promise<string | null> {
    if (this.key) return this.key
    if (!this.pinRead && this.pin) {
      this.pinRead = true
      const pinned = await this.pin.get().catch(() => null)
      if (pinned && HEX64.test(pinned)) { this.key = pinned; return pinned }
    }
    if (this.keyAsked !== 0 && this.now() - this.keyAsked < WITNESS_RETRY_MS) return null
    this.keyAsked = this.now()
    const got = await this.fetchText(WITNESS_INFO_URL, { headers: { Accept: 'application/nostr+json' } }).catch(() => null)
    if (!got || got.status !== 200) return null
    try {
      const pk = (JSON.parse(got.text) as { self?: unknown }).self
      if (typeof pk === 'string' && HEX64.test(pk)) { this.key = pk; this.pin?.set(pk) }
    } catch { /* no key */ }
    return this.key
  }

  /**
   * Ask about events not known yet (and not asked within WITNESS_RETRY_MS):
   * each with its settle tags in order when it is a layer, none when it is a
   * movement action. Never throws.
   */
  async learn(asks: ReadonlyArray<{ id: string; settles?: readonly string[] }>): Promise<void> {
    if (this.lied) return
    const t = this.now()
    const tags = new Map<string, readonly string[]>()
    for (const a of asks) if (a.settles) tags.set(a.id, a.settles)
    const want = [...new Set(asks.map((a) => a.id))].filter((id) => HEX64.test(id) && !this.known.has(id) && t - (this.unrecorded.get(id) ?? -Infinity) >= WITNESS_RETRY_MS)
    if (want.length === 0) return
    const key = await this.witnessKey()
    if (!key) return
    for (let i = 0; i < want.length; i += WITNESS_IDS_MAX) {
      const batch = want.slice(i, i + WITNESS_IDS_MAX)
      const got = await this.fetchText(`${WITNESS_URL}?ids=${batch.join(',')}`).catch(() => null)
      // 400: the request was wrong, so it is not asked again soon. 429, a 5xx or nothing: unreachable for now.
      if (got?.status === 400) { for (const id of batch) this.unrecorded.set(id, t); continue }
      if (!got || got.status !== 200) return
      const read = readWitnessAnswer(got.text, key, batch, tags)
      if (!read) return
      for (const id of batch) {
        const r = read.get(id)
        if (!r) { this.unrecorded.set(id, t); continue }
        for (const [sid, w] of r.settles) {
          const was = this.seenW.get(sid)
          if (was !== undefined && was !== w) { this.lied = true; return }
          this.seenW.set(sid, w)
        }
        this.known.set(id, r)
        this.unrecorded.delete(id)
      }
    }
  }

  /** What the witness said of an event: recorded (with its receipt height), not recorded, or nothing known (unasked or unreachable). */
  status(eventId: string): { recorded: true; height: number } | { recorded: false } | null {
    if (this.lied) return null
    const r = this.known.get(eventId)
    if (r) return { recorded: true, height: r.height }
    return this.unrecorded.has(eventId) ? { recorded: false } : null
  }

  /** The receipt height the witness recorded for an event, or null. */
  height(eventId: string): number | null {
    return this.lied ? null : this.known.get(eventId)?.height ?? null
  }

  /** A settle's W for this exact version of a layer, or null (unwitnessed). */
  settle(eventId: string, settleId: string): number | null {
    return this.lied ? null : this.known.get(eventId)?.settles.get(settleId) ?? null
  }
}
