/**
 * plant.ts - planting a seed (DECK-0008 §8.1, §8.2): the DNA event, the seed
 * event before its work, the price, and how long the work takes here.
 *
 * Publishing a DNA is free; each seed pays NIP-13 work on its own id at its
 * DNA's price (§7, arkinox's ruling of 2026-11-10). The work is mined in
 * workers (the avatar's miner, lib/avatarWorker.ts: the same NIP-13 loop,
 * every core but one, progress and cancel), with the committed target equal
 * to the price. The seed's `planted` is the clock height when it is planted
 * (§4.2), its `C` the build cursor's point, and it carries NIP-70's `-`, as
 * every item in a bag does.
 */

import { BASE_CAPS, BLOCKS_PER_GENERATION, capsPrice, clockHeight, sha256Hex, tryParseDna, workOk, type Caps } from 'sno-core/seeds'
import type { GrowRequest } from './growJob'
import { expectedTries, triesPerSec } from '../avatarMine'
import { positionHex, type EventTemplate, type NostrEvent } from '../events'
import type { Plane } from 'cyberspace-core'
import type { Position } from '../space'
import { DNA_KIND, SEED_KIND } from './seedItem'

/** What the SEED composer hands the deploy. */
export interface SeedDraft {
  /** The DNA's SEEDO text, valid (tryParseDna). */
  text: string
  caps: Caps
  /** The seed's scale, 0 (one gibson a unit) by default. */
  scale: number
  /** The planter's name for this planting, or empty. */
  title: string
  /** The DNA event, once it is signed (or found on relays): reused for every later planting of the same text. */
  dna?: NostrEvent
}

/** The DNA's price in bits, or null when its caps are out of range. */
export function draftPrice(draft: Pick<SeedDraft, 'caps'>): number | null {
  return capsPrice(draft.caps)
}

/** Why a pasted DNA cannot be planted, in the engine's words, or null when it can. */
export function dnaTextRefusal(text: string): string | null {
  if (!text.trim()) return 'Paste or pick a DNA.'
  const read = tryParseDna(text)
  return read.ok ? null : read.error
}

function sameCaps(a: Caps, b: Caps): boolean {
  return a.vertices === b.vertices && a.symbols === b.symbols && a.generations === b.generations
}

/**
 * A written DNA (§8.1): its text in `content`, its caps (left out when they
 * are the free caps, which is what no tag means), and NIP-31's `alt`. No `-`:
 * a DNA published on its own is for anyone to plant.
 */
export function dnaTemplate(text: string, caps: Caps, createdAt: number): EventTemplate {
  const name = tryParseDna(text)
  const tags: string[][] = []
  if (!sameCaps(caps, BASE_CAPS)) tags.push(['caps', String(caps.vertices), String(caps.symbols), String(caps.generations)])
  tags.push(['alt', `Seeds DNA${name.ok ? `: ${name.dna.name}` : ''} (DECK-0008). Plant it in cyberspace with ONOSENDAI.`])
  return { kind: DNA_KIND, created_at: createdAt, tags, content: text }
}

/** Whether a DNA event already carries this text and these caps: the one to plant, rather than a new one. */
export function dnaMatches(ev: Pick<NostrEvent, 'kind' | 'content' | 'tags'>, text: string, caps: Caps): boolean {
  if (ev.kind !== DNA_KIND || ev.content !== text) return false
  const tag = ev.tags.find((t) => t[0] === 'caps')
  const theirs: Caps = tag ? { vertices: Number(tag[1]), symbols: Number(tag[2]), generations: Number(tag[3]) } : BASE_CAPS
  return sameCaps(theirs, caps)
}

/**
 * The seed event before its work (§8.2): the DNA by id, the planted height,
 * the scale when it is not 0, the `C`, a title when there is one, and `-`.
 * The miner adds the nonce tag, last, with the committed target.
 */
export function seedTemplate(o: { dnaId: string; relayHint: string; planted: number; scale: number; at: Position; plane: Plane; title: string; createdAt: number }): EventTemplate {
  const tags: string[][] = [['dna', o.dnaId, o.relayHint], ['planted', String(o.planted)]]
  if (o.scale !== 0) tags.push(['scale', String(o.scale)])
  tags.push(['C', positionHex(o.at, o.plane)])
  const title = o.title.trim().replace(/\s+/g, ' ').slice(0, 64)
  if (title) tags.push(['title', title])
  tags.push(['-'])
  return { kind: SEED_KIND, created_at: o.createdAt, tags, content: '' }
}

/** The signed seed still carries its work: a signer that changed anything (its time, its tags) would have changed its id. */
export function seedWorkHolds(ev: Pick<NostrEvent, 'id' | 'tags'>, price: number): boolean {
  return workOk(ev, price)
}

/**
 * Seconds the work is expected to take on this device: 2^bits tries over the
 * rate the calibration measured (avatarMine triesPerSec), or null before the
 * device is calibrated.
 */
export function miningSeconds(bits: number, sha256PerSec: number | null, workers: number, bytes = 420): number | null {
  if (!sha256PerSec) return null
  return expectedTries(bits) / triesPerSec(sha256PerSec, bytes, workers)
}

/** The preview's slider runs over the last month of blocks: day 0 to day 30. */
export const PREVIEW_DAYS = 30

/** A made-up block hash for the preview, where this page holds no real one. Never used for a real bloom. */
export function previewHash(height: number): string {
  return sha256Hex(new TextEncoder().encode(`ONOSENDAI seed preview ${height}`))
}

/**
 * The worker request that grows the preview: the DNA planted at the build
 * cursor PREVIEW_DAYS days before the clock block, seen after `day` whole
 * days of blocks (to the last block of that day, so each day's new growth is
 * nearly grown). Its weather is the real blocks' where the page has them, and
 * made-up hashes where it does not: a preview shows the kind of thing a DNA
 * grows, and the real bloom starts from the block it is planted at.
 */
export function previewRequest(o: { text: string; caps: Caps; coord: string; scale: number; tip: number; day: number; hashOf: (h: number) => string | null | undefined }): Omit<GrowRequest, 'id' | 'type'> {
  const N = BLOCKS_PER_GENERATION
  const planted = clockHeight(o.tip) - PREVIEW_DAYS * N - (N - 1)
  const day = Math.max(0, Math.min(PREVIEW_DAYS, Math.floor(o.day)))
  const clock = planted + day * N + (N - 1)
  const hashes: Record<number, string> = {}
  for (let k = 1; k <= Math.min(day, o.caps.generations); k++) {
    const h = planted + k * N
    const real = o.hashOf(h)
    hashes[h] = typeof real === 'string' && /^[0-9a-f]{64}$/.test(real) ? real : previewHash(h)
  }
  return { key: 'preview', dna: o.text, seed: { coord: o.coord, planted, scale: o.scale, caps: o.caps }, clock, hashes, maxSteps: Number.MAX_SAFE_INTEGER }
}
