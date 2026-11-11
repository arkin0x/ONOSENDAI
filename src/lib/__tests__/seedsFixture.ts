/**
 * seedsFixture.ts: what the seeds tests share. The DECK-0008 vectors, as
 * sno-core vendors them (the copy pinned with sno-core in the lockfile), and
 * a signed DNA and seeds mined at the base price for real bags.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { finalizeEvent, getEventHash, getPublicKey } from 'nostr-tools/pure'
import { leadingZeroBits } from 'sno-core/seeds'
import { hexToBytes, positionHex, type NostrEvent } from '../events'
import type { Plane } from 'cyberspace-core'
import type { Position } from '../space'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const vectors: any = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/sno-core/src/seeds/fixtures/seeds-vectors.json'), 'utf8'))

export const planterSk = hexToBytes('11'.repeat(32))
export const planter = getPublicKey(planterSk)
export const authorSk = hexToBytes('22'.repeat(32))
export const author = getPublicKey(authorSk)

/** A written DNA, signed: the crystal at the free caps (the base price, 16 bits), as the vectors publish it. */
export function crystalDna(sk = authorSk, extraTags: string[][] = []): NostrEvent {
  return finalizeEvent({ kind: 3350, created_at: 1791386674, tags: extraTags, content: vectors.seeds.free_dna.content }, sk) as NostrEvent
}

/** A DNA of any text and caps tag, signed. */
export function dnaOf(content: string, tags: string[][] = [], sk = authorSk): NostrEvent {
  return finalizeEvent({ kind: 3350, created_at: 1791386674, tags, content }, sk) as NostrEvent
}

/** A seed mined to `bits` (NIP-13, committed target `bits`), signed. */
export function mineSeedEvent(o: { dnaId: string; planted: number; at: Position; plane: Plane; createdAt: number; bits?: number; scale?: number; sk?: Uint8Array; target?: number }): NostrEvent {
  const sk = o.sk ?? planterSk
  const bits = o.bits ?? 16
  const pubkey = getPublicKey(sk)
  const base: string[][] = [['dna', o.dnaId, ''], ['planted', String(o.planted)], ...(o.scale ? [['scale', String(o.scale)]] : []), ['C', positionHex(o.at, o.plane)], ['-']]
  for (let n = 0; ; n++) {
    const tags = [...base, ['nonce', String(n), String(o.target ?? bits)]]
    const t = { kind: 3351, created_at: o.createdAt, tags, content: '', pubkey }
    if (leadingZeroBits(getEventHash(t)) >= bits) return finalizeEvent({ kind: 3351, created_at: o.createdAt, tags, content: '' }, sk) as NostrEvent
  }
}

/** The header times of the vectors' clamp section, by height. */
export function clampTimes(): Map<number, number> {
  return new Map(Object.entries(vectors.clamp.header_times as Record<string, number>).map(([h, t]) => [Number(h), t]))
}

/** The vectors' block hashes, by height. */
export function vectorBlocks(): Map<number, string> {
  return new Map(Object.entries(vectors.blocks as Record<string, string>).map(([h, x]) => [Number(h), x]))
}
