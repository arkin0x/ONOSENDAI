/**
 * sealedAt.ts: when a hidden thing was sealed, as a block (shared piece
 * "Time as a block": "Sealed at block 975,410 · 2 days ago").
 *
 * Cyberspace counts time in Bitcoin blocks. A bag carries no block of its
 * own, only its created_at, so the block is reckoned back from the newest
 * block this client knows (the hyperspace line's tip) at the network's ten
 * minutes a block: a message sealed two hours ago is twelve blocks under the
 * tip. That is the block it was sealed in to within a few, which is what a
 * reader wants from it. With no tip known yet, only the plain time is said.
 *
 * Pure: the tip and the clock are passed in.
 */

import { formatAgo } from './time'

/** Seconds per block, on average: Bitcoin's target. */
export const BLOCK_SECONDS = 600

/** The block a thing made at `createdAt` (unix seconds) was sealed in, reckoned from `tip` at `now`; null without a tip or a time. */
export function sealedBlock(createdAt: number | undefined, tip: number | null | undefined, now: number): number | null {
  if (!createdAt || !tip || tip <= 0) return null
  const back = Math.max(0, Math.floor((now - createdAt) / BLOCK_SECONDS))
  return Math.max(0, tip - back)
}

/** A block height as people read one: 975,410. */
export function blockWords(block: number): string {
  return block.toLocaleString('en-US')
}

/** "Sealed at block 975,410 · 2 h ago", or "Sealed 2 h ago" with no block known, or "" with no time at all. */
export function sealedWords(createdAt: number | undefined, tip: number | null | undefined, now: number): string {
  if (!createdAt) return ''
  const block = sealedBlock(createdAt, tip, now)
  const ago = formatAgo(createdAt, now)
  return block === null ? `Sealed ${ago}` : `Sealed at block ${blockWords(block)} · ${ago}`
}
