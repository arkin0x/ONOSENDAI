/**
 * avatarMine.ts - the work an avatar owes, done.
 *
 * Spec 8.10: a kind 33331 avatar is paid for in NIP-13 work on the event
 * itself, `required = ceil(16 + 6 log2(reach) + 3 log2(detail / 32))` bits,
 * the target committed in the nonce tag before mining. This is the loop
 * that finds the nonce: the NIP-01 serialization is built once around a
 * marker, the nonce's decimal digits are written into a reusable buffer,
 * and only the hash runs per try. cyberspace-core's `avatarWork` prices
 * the shape and `verifyAvatarWork` judges the result; the worker
 * (workers/avatar.worker.ts) runs this off the main thread in chunks so
 * progress and cancel stay live.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from './events'

export interface MineTemplate {
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

export interface MineFound { nonce: string; id: string }

const enc = new TextEncoder()
const MARKER = 'ONOSENDAI-NONCE-MARKER-7f3a9c'

/** NIP-01: the id is the SHA-256 of this JSON array. */
export function serializeEvent(t: MineTemplate): string {
  return JSON.stringify([0, t.pubkey, t.created_at, t.kind, t.tags, t.content])
}

export function eventId(t: MineTemplate): string {
  return bytesToHex(sha256(enc.encode(serializeEvent(t))))
}

/** The template with its nonce tag set (replacing any earlier one), NIP-13 shape. */
export function nonceTagged<T extends { tags: string[][] }>(t: T, nonce: string, target: number): T {
  return { ...t, tags: [...t.tags.filter((tag) => tag[0] !== 'nonce'), ['nonce', nonce, String(target)]] }
}

/** Leading zero bits of a hash. */
export function leadingZeros(hash: Uint8Array): number {
  let n = 0
  for (const b of hash) {
    if (b === 0) { n += 8; continue }
    n += Math.clz32(b) - 24
    break
  }
  return n
}

/**
 * Try `count` nonces from `from`, `stride` apart (one worker per residue
 * when several mine at once); the first whose id carries `target` leading
 * zero bits, or null. Deterministic, so a worker and a test find the same
 * nonce for the same template.
 */
export function mineChunk(t: MineTemplate, target: number, from: number, count: number, stride: number = 1): MineFound | null {
  const split = serializeEvent(nonceTagged(t, MARKER, target)).split(MARKER)
  const last = from + count * stride
  if (split.length !== 2) {
    for (let n = from; n < last; n += stride) {
      const nonce = String(n)
      const hash = sha256(enc.encode(serializeEvent(nonceTagged(t, nonce, target))))
      if (leadingZeros(hash) >= target) return { nonce, id: bytesToHex(hash) }
    }
    return null
  }
  const head = enc.encode(split[0])
  const tail = enc.encode(split[1])
  const buf = new Uint8Array(head.length + 20 + tail.length)
  buf.set(head, 0)
  let width = 0
  for (let n = from; n < last; n += stride) {
    const digits = String(n)
    if (digits.length !== width) {
      width = digits.length
      buf.set(tail, head.length + width)
    }
    for (let i = 0; i < width; i++) buf[head.length + i] = digits.charCodeAt(i)
    const hash = sha256(buf.subarray(0, head.length + width + tail.length))
    if (leadingZeros(hash) >= target) return { nonce: digits, id: bytesToHex(hash) }
  }
  return null
}

/** SHA-256 blocks a serialized event of this many bytes takes: padding included. */
export function blocksOf(bytes: number): number {
  return Math.ceil((bytes + 9) / 64)
}

/**
 * Tries per second this device can expect for an event of `bytes`, from the
 * calibration's leaf-hash rate: a sidestep leaf costs about three SHA-256
 * blocks (the leaf from its midstate and the fold above it), the per-try
 * overhead beyond hashing is about a fifth (measured), and workers past the
 * first add about seven tenths each, since half of them share a core.
 */
export function triesPerSec(sha256PerSec: number, bytes: number, workers: number = 1): number {
  const one = (sha256PerSec * 3 / blocksOf(bytes)) * 0.8
  return one * (1 + 0.7 * Math.max(0, workers - 1))
}

/** Expected tries for `bits` of work. */
export function expectedTries(bits: number): number {
  return 2 ** bits
}

/** "about 40 s", "about 3 min", "about 2 h", "about 5 days". */
export function describeDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'unknown'
  if (seconds < 1) return 'under a second'
  if (seconds < 90) return `about ${Math.round(seconds)} s`
  if (seconds < 90 * 60) return `about ${Math.round(seconds / 60)} min`
  if (seconds < 36 * 3600) return `about ${Math.round(seconds / 3600)} h`
  if (seconds < 400 * 86400) return `about ${Math.round(seconds / 86400)} days`
  return `about ${Math.round(seconds / (365.25 * 86400))} years`
}

/** How long a mine took, for a sentence: "under a second" or m:ss. */
export function minedIn(ms: number): string {
  return ms < 1000 ? 'under a second' : clock(ms)
}

/** m:ss for an elapsed span. */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}
