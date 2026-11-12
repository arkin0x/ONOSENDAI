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
import { fitHeightAll, fitsAt } from '../deployFit'
import { deployPoint, type Position } from '../space'
import { expectedTries, triesPerSec } from '../avatarMine'
import { positionHex, type EventTemplate, type NostrEvent } from '../events'
import type { Plane } from 'cyberspace-core'
import { DNA_KIND, SEED_KIND, type SeedStand } from './seedItem'
import { standTags } from './orientation'

/** What the SEED composer hands the deploy. */
export interface SeedDraft {
  /** The DNA's SEEDO text, valid (tryParseDna). */
  text: string
  caps: Caps
  /** The seed's scale, 0 (one gibson a unit) by default. */
  scale: number
  /** The planter's name for this planting, or empty. */
  title: string
  /**
   * The owner's published event for this DNA SEED lists (seedDnas
   * SEED_DNA_IDS): every seed of it names that event, and none signs a
   * DNA of its own. Absent for a pasted DNA, or while it is unpublished.
   */
  dnaId?: string
  /**
   * Its hide height as SEED found it (seedHideFor), for the cursor and step it
   * was measured at. Anywhere else (the cursor moved, AGAIN) the deploy hides
   * it at SEED_HIDE_MAX, findable, and the bloom draws past its cube.
   */
  fit?: SeedFit
}

/** A hide height measured for one spot: the build cursor (as a coordinate) and step it holds for. */
export interface SeedFit {
  height: number
  /** The bloom's reach at the landing point of that height, in gibsons with the margin; absent when the worker could not grow it (the height is then SEED_HIDE_MAX). */
  reach?: number
  cursor: string
  step: number
}

/**
 * The fit SEED hands the deploy, from what seedHideFor found at this cursor,
 * plane and step: recorded even when the bloom could not be measured (at
 * SEED_HIDE_MAX), so lining the seed up keeps the STEP and cursor it was
 * composed at either way (useShards, the STEP subscription).
 */
export function seedFitFor(found: { height: number; reach: number | undefined }, cursor: Position, plane: Plane, step: number): SeedFit {
  return { height: found.height, ...(found.reach !== undefined ? { reach: found.reach } : {}), cursor: positionHex(cursor, plane), step }
}

/** The DNA's price in bits, or null when its caps are out of range. */
export function draftPrice(draft: Pick<SeedDraft, 'caps'>): number | null {
  return capsPrice(draft.caps)
}

/** A DNA text read: its name, or why it is refused. */
export type DnaTextRead = { ok: true; name: string } | { ok: false; error: string }

/** The last few texts read: the deploy bar and its ghost ask on every cursor move, the composer on every slider move. */
const readCache = new Map<string, DnaTextRead>()

/** Read a DNA's text once (sno-core tryParseDna), and answer again from memory. */
export function readDnaText(text: string): DnaTextRead {
  const hit = readCache.get(text)
  if (hit) return hit
  const read = tryParseDna(text)
  const out: DnaTextRead = read.ok ? { ok: true, name: read.dna.name } : { ok: false, error: read.error }
  readCache.set(text, out)
  while (readCache.size > 8) readCache.delete(readCache.keys().next().value as string)
  return out
}

/** Why a pasted DNA cannot be planted, in the engine's words, or null when it can. */
export function dnaTextRefusal(text: string): string | null {
  if (!text.trim()) return 'Paste or pick a DNA.'
  const read = readDnaText(text)
  return read.ok ? null : read.error
}

/** Whether two caps are the same three numbers. */
export function sameCaps(a: Caps, b: Caps): boolean {
  return a.vertices === b.vertices && a.symbols === b.symbols && a.generations === b.generations
}

/**
 * A written DNA (§8.1): its text in `content`, its caps (left out when they
 * are the free caps, which is what no tag means), and NIP-31's `alt`. No `-`:
 * a DNA published on its own is for anyone to plant.
 */
export function dnaTemplate(text: string, caps: Caps, createdAt: number): EventTemplate {
  const name = readDnaText(text)
  const tags: string[][] = []
  if (!sameCaps(caps, BASE_CAPS)) tags.push(['caps', String(caps.vertices), String(caps.symbols), String(caps.generations)])
  tags.push(['alt', `Seeds DNA${name.ok ? `: ${name.name}` : ''} (DECK-0008). Plant it in cyberspace with ONOSENDAI.`])
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
export function seedTemplate(o: { dnaId: string; relayHint: string; planted: number; scale: number; at: Position; plane: Plane; title: string; createdAt: number; stand?: SeedStand }): EventTemplate {
  const tags: string[][] = [['dna', o.dnaId, o.relayHint], ['planted', String(o.planted)]]
  if (o.scale !== 0) tags.push(['scale', String(o.scale)])
  tags.push(['C', positionHex(o.at, o.plane)])
  // At most 64 characters (§8.2), cut by code point so no pair is split.
  const title = Array.from(o.title.trim().replace(/\s+/g, ' ')).slice(0, 64).join('')
  if (title) tags.push(['title', title])
  // How its bloom stands (§5.7): nothing for +Y up on Cyberspace's axes.
  if (o.stand) tags.push(...standTags(o.stand, o.plane))
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

/**
 * The automatic hide height runs from 3 to 12 (owner ruling 2026-11-10):
 * at 12 or lower the automatic discovery finds a seed ("I don't like that
 * things planted above height 12 won't be findable unless people are digging
 * for them"). A planter who wants a seed hidden picks a higher height by hand,
 * as for any item.
 */
export const SEED_HIDE_MIN = 3
export const SEED_HIDE_MAX = 12
/** What a bloom's reach is grown by when its hide height is fitted: a quarter, and two gibsons. */
export const REACH_MARGIN = 1.25
export const REACH_PAD_GIBSONS = 2

/**
 * How far a drawn bloom reaches from its seed, in gibsons, with the margin:
 * its farthest vertex (positions in ticks, 120 a unit) at 2^scale gibsons a
 * unit. Measured on the bloom at day 31 (the preview's last day), it sizes the
 * cube to this DNA, never to the 64 units every bloom is held to.
 */
export function bloomReachGibsons(positions: ArrayLike<number>, scale: number): number {
  let r2 = 0
  for (let i = 0; i + 2 < positions.length; i += 3) r2 = Math.max(r2, positions[i] ** 2 + positions[i + 1] ** 2 + positions[i + 2] ** 2)
  return Math.ceil((Math.sqrt(r2) / 120) * 2 ** scale * REACH_MARGIN) + REACH_PAD_GIBSONS
}

/**
 * The automatic hide height of a seed: the smallest from SEED_HIDE_MIN to
 * SEED_HIDE_MAX whose aligned cube holds its bloom's reach around where it
 * lands (lib/deployFit fitHeightAll); SEED_HIDE_MAX when none does, and then
 * the bloom draws past its cube (owner ruling 2026-11-10). Never above this
 * machine's key ceiling. Without a reach (the preview not grown yet) it is
 * SEED_HIDE_MAX.
 */
/**
 * The automatic hide height of a seed at the build cursor, measuring the bloom
 * where it would really land at each height: a height below the build step
 * lands it in a smaller cell's centre (space.ts deployPoint), on other soil,
 * so each distinct landing point is grown once (`reachAt`). The smallest
 * height from SEED_HIDE_MIN whose cube holds the bloom grown at its own
 * point; SEED_HIDE_MAX when none does (owner ruling 2026-11-10).
 */
export async function seedHideFor(cursor: Position, plane: Plane, step: number, ceiling: number, reachAt: (point: Position) => Promise<number | undefined>): Promise<{ height: number; point: Position; reach: number | undefined }> {
  const max = Math.max(0, Math.min(SEED_HIDE_MAX, ceiling))
  const measured = new Map<string, number | undefined>()
  const at = async (p: Position): Promise<number | undefined> => {
    const k = positionHex(p, plane)
    if (!measured.has(k)) measured.set(k, await reachAt(p))
    return measured.get(k)
  }
  for (let h = Math.min(SEED_HIDE_MIN, max); h <= max; h++) {
    const point = deployPoint(cursor, step, h)
    const reach = await at(point)
    if (reach !== undefined && fitsAt(point, BigInt(Math.max(0, Math.ceil(reach))), h)) return { height: h, point, reach }
  }
  const point = deployPoint(cursor, step, max)
  return { height: max, point, reach: await at(point) }
}

/** The hide height a deploy uses: SEED found it for this very cursor and step, else SEED_HIDE_MAX. Never above the ceiling. */
export function seedDraftHeight(fit: SeedFit | undefined, cursor: Position, plane: Plane, step: number, ceiling: number): number {
  const max = Math.max(0, Math.min(SEED_HIDE_MAX, ceiling))
  if (!fit || fit.cursor !== positionHex(cursor, plane) || fit.step !== step) return max
  return Math.min(fit.height, max)
}

/** The same rule from one reach, measured once (tests, and the hide heights reported in #657). */
export function seedHideHeight(reach: number | undefined, cursor: Position, step: number, ceiling: number): number {
  const max = Math.max(0, Math.min(SEED_HIDE_MAX, ceiling))
  if (reach === undefined || !Number.isFinite(reach)) return max
  return fitHeightAll(BigInt(Math.max(0, Math.ceil(reach))), [], cursor, step, Math.min(SEED_HIDE_MIN, max), max) ?? max
}
