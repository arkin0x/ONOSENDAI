/**
 * starredChunk.ts - a saved chunk's words and numbers (owner, 2026-11-28:
 * "you can star a survey card and keep it in the mining panel ... then you
 * can view the chunk and it'll show you where it's at").
 *
 * - snapshotOf and cardOfSnapshot: a survey card kept with the star
 *   (lib/starredChunksRecord.ts ChunkSnapshot) and drawn again from it, so
 *   the saved card reads exactly as the live one did.
 * - promptFinds and promptLine: the rare finds that make the survey card ask
 *   you to star the chunk ("Glowcore here. Star this chunk to find it again.").
 * - autoLabel and chunkName: what a saved chunk is called, your note or its
 *   best finds ("Glowcore ×2, Cinderrock ×40").
 * - whereIs: how far, which way and how high a saved chunk is from where you
 *   stand. The way is told as if you face the sun: the black sun stands at +Z
 *   (CYBERSPACE_V2 §11.2, scene/BlackSun.tsx), and the axes are left-handed, so
 *   facing it +X is on your right. The arrow is a compass with the sun at the
 *   top: 0 degrees toward the sun, 90 to the right.
 *
 * Pure: nothing here reads a store or the clock.
 */

import { blockName } from './blocks'
import { COMMON, GROUND_LOOK, PRIZED, type CardRow, type SurveyCardData } from './assay'
import { N, chunkKey, chunkOf, parseChunkKey, type ChunkBase } from './coords'
import { MAX_ROWS, type ChunkSnapshot, type SnapRow, type StarEntry } from '../starredChunksRecord'
import type { Position } from '../space'

/** A saved chunk's gold: its star, its beacon, its outline and its HUD marker. */
export const STAR_GOLD = '#ffcf4a'

/** Cinderrock: not in the prized band, but the owner names it with Glowcore and Voidpearl as a find worth starring. */
export const CINDERROCK = 7
/** The kinds that make the card ask you to star the chunk: the rare band, Glowcore and Cinderrock. */
export const PROMPT_KINDS: ReadonlySet<number> = new Set([...PRIZED, CINDERROCK])

// -- the snapshot --------------------------------------------------------------

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
function fromHex(h: string): Uint8Array {
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16) || 0
  return out
}

/** A survey card as kept with the star: every kind's counts, the ground, the hardness and the core. `at` is the first survey's date (ms) or null. */
export function snapshotOf(card: SurveyCardData, at: number | null): ChunkSnapshot {
  // Rarest first, MAX_ROWS at most: a chunk's finds are always kept; only the commonest rock of a crowded chunk is left off.
  const rows: SnapRow[] = [...card.finds, ...card.common].slice(0, MAX_ROWS).map((r) => [r.id, r.count, r.mined, Math.min(r.visible, r.count)])
  return {
    g: card.ground?.family ?? null,
    k: card.hardness?.max ?? null,
    m: card.hardness ? Math.round(card.hardness.mean * 100) / 100 : null,
    r: rows,
    d: toHex(card.strata.length === 32 ? card.strata : new Uint8Array(32)),
    v: at && at > 0 ? Math.floor(at / 1000) : 0,
  }
}

/** Whether two snapshots say the same (the date it was taken aside). */
export function sameSnapshot(a: ChunkSnapshot | undefined, b: ChunkSnapshot | undefined): boolean {
  const text = (s: ChunkSnapshot | undefined): string => (s ? JSON.stringify([s.g, s.k, s.m, s.r, s.d, s.v]) : '')
  return text(a) === text(b)
}

/** The ground's name and signature rock, as the card shows it. */
export function groundOf(family: string | null): { family: string; name: string; rock: number } | null {
  if (!family) return null
  const look = GROUND_LOOK[family]
  return { family, name: look?.name ?? family.charAt(0).toUpperCase() + family.slice(1), rock: look?.rock ?? 1 }
}

/** A saved card, ready to draw with the survey card's own parts (terrain/SurveyCard.tsx). */
export function cardOfSnapshot(s: ChunkSnapshot): SurveyCardData {
  const rows: CardRow[] = s.r.map(([id, count, mined, seen]) => {
    const visible = Math.min(seen, count)
    return { id, name: blockName(id), count, mined, visible, buried: count - visible, prized: PRIZED.has(id) }
  })
  return {
    ground: groundOf(s.g),
    hardness: s.k === null ? null : { max: s.k, mean: s.m ?? s.k },
    finds: rows.filter((r) => !COMMON.has(r.id)),
    common: rows.filter((r) => COMMON.has(r.id)),
    notes: [],
    strata: fromHex(s.d),
    total: rows.reduce((n, r) => n + r.count, 0),
    minedTotal: rows.reduce((n, r) => n + r.mined, 0),
  }
}

// -- the prompt and the names ----------------------------------------------------

/**
 * The finds on a card that make it ask you to star the chunk, rarest first.
 * Every row the card lists counts, even one mined down to 0 while it is open,
 * so the prompt's line never comes and goes under your finger.
 */
export function promptFinds(card: Pick<SurveyCardData, 'finds'>): CardRow[] {
  return card.finds.filter((r) => PROMPT_KINDS.has(r.id))
}

/** "Glowcore here." or "Glowcore and Cinderrock here.": the two rarest finds, named. */
export function findsHere(rows: ReadonlyArray<Pick<CardRow, 'name'>>): string {
  const names = rows.slice(0, 2).map((r) => r.name)
  return `${names.join(' and ')} here.`
}

/** The survey card's prompt for a chunk not starred yet, or null when it holds nothing rare. */
export function promptLine(card: Pick<SurveyCardData, 'finds'>): string | null {
  const rows = promptFinds(card)
  return rows.length ? `${findsHere(rows)} Star this chunk to find it again.` : null
}

const count = (n: number): string => n.toLocaleString('en-US')

/** A saved chunk's best finds left, rarest first: [id, how many]. */
export function topFinds(s: ChunkSnapshot | undefined, n = 2): Array<[number, number]> {
  if (!s) return []
  return s.r.filter(([id, left]) => left > 0 && !COMMON.has(id)).slice(0, n).map(([id, left]) => [id, left])
}

/** "Glowcore ×2, Cinderrock ×40": its best finds; the ground's name when it holds nothing rare. */
export function autoLabel(s: ChunkSnapshot | undefined): string {
  const top = topFinds(s, 2)
  if (top.length) return top.map(([id, n]) => `${blockName(id)} ×${count(n)}`).join(', ')
  const g = groundOf(s?.g ?? null)
  return g ? `${g.name} ground` : 'Saved chunk'
}

/** What a saved chunk is called: your note, else its best finds. */
export function chunkName(e: Pick<StarEntry, 'n' | 's'>): string {
  return e.n && e.n.trim() ? e.n : autoLabel(e.s)
}

/** A saved date as the list shows it: "28 Nov 2026". */
export function savedDate(unixS: number): string {
  if (!(unixS > 0)) return ''
  return new Date(unixS * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// -- where it is ---------------------------------------------------------------

/** A chunk's centre gibson: its corner plus half a side. */
export function chunkCentre(c: ChunkBase): Position {
  const h = BigInt(N / 2)
  return { x: c.x + h, y: c.y + h, z: c.z + h }
}

/** The chunk key a gibson is in. */
export function chunkKeyAt(p: Position, plane: number): string {
  return chunkKey(chunkOf(p.x, p.y, p.z, plane))
}

const abs = (n: bigint): bigint => (n < 0n ? -n : n)
const big = (a: bigint, b: bigint): bigint => (a > b ? a : b)

/** How far, which way and how high a saved chunk is. */
export interface Where {
  /** The chunk is in the plane you stand in. */
  samePlane: boolean
  /** You stand in it. */
  inside: boolean
  /** How many chunks away: the largest of the three axes' chunk steps. */
  chunks: bigint
  /** How many gibsons from you to its centre: the largest axis gap, as every distance in cyberspace is read. */
  gibsons: bigint
  /** From you to its centre, gibsons, on each axis. */
  dx: bigint
  dy: bigint
  dz: bigint
  /** The arrow on a compass with the sun at the top: 0 toward the sun (+Z), 90 to its right (+X), clockwise. */
  deg: number
  /** The way, facing the sun: "Ahead and to the right". */
  way: string
  /** The height: "12 gibsons above you", "Level with you". */
  height: string
}

/** Nearer than this share of the level distance off an axis counts as straight along it. */
const SIDE = 0.38

/** The way on the level, facing the sun, from the offsets along +X (right) and +Z (toward the sun). */
export function wayWords(dx: bigint, dz: bigint): { deg: number; way: string } {
  const m = big(abs(dx), abs(dz))
  if (m === 0n) return { deg: 0, way: 'Straight up or down' }
  // Proportions survive the narrowing: each axis as a millionth of the larger.
  const x = Number((dx * 1_000_000n) / m) / 1_000_000
  const z = Number((dz * 1_000_000n) / m) / 1_000_000
  const deg = Math.round(((Math.atan2(x, z) * 180) / Math.PI + 360) % 360) % 360
  const len = Math.hypot(x, z)
  const side = x / len > SIDE ? 'to the right' : x / len < -SIDE ? 'to the left' : null
  const fore = z / len > SIDE ? 'Ahead' : z / len < -SIDE ? 'Behind' : null
  const way = fore && side ? `${fore} and ${side}` : fore ?? (side === 'to the right' ? 'To the right' : 'To the left')
  return { deg, way }
}

/** "1 gibson", "96 gibsons". */
export function gibsonWords(n: bigint): string {
  return `${n.toLocaleString('en-US')} ${n === 1n ? 'gibson' : 'gibsons'}`
}

/** "1 chunk", "3 chunks". */
export function chunkWords(n: bigint): string {
  return `${n.toLocaleString('en-US')} ${n === 1n ? 'chunk' : 'chunks'}`
}

/**
 * How far, which way and how high the chunk `key` is from `head` in
 * `headPlane`; null when the key is not a chunk.
 */
export function whereIs(head: Position, headPlane: number, key: string): Where | null {
  const c = parseChunkKey(key)
  if (!c) return null
  const centre = chunkCentre(c)
  const dx = centre.x - head.x, dy = centre.y - head.y, dz = centre.z - head.z
  const here = chunkOf(head.x, head.y, head.z, headPlane)
  const shift = 5n
  const chunks = big(big(abs((c.x - here.x) >> shift), abs((c.y - here.y) >> shift)), abs((c.z - here.z) >> shift))
  const samePlane = c.plane === headPlane
  const inside = samePlane && chunks === 0n
  const { deg, way } = wayWords(dx, dz)
  // Inside the chunk a gibson's height off its centre says nothing: you are there.
  const height = inside ? 'You are in it' : dy > 0n ? `${gibsonWords(dy)} above you` : dy < 0n ? `${gibsonWords(-dy)} below you` : 'Level with you'
  return { samePlane, inside, chunks, gibsons: big(big(abs(dx), abs(dy)), abs(dz)), dx, dy, dz, deg, way: inside ? 'You are in it' : way, height }
}

/**
 * The saved chunk on the locator, a small top-down map with the sun at the
 * top and you in the middle: its place as a share of the map's radius (x to
 * the right, y down the screen, so +Z is up), and whether it is past the
 * map's edge (drawn at the rim, pointing out). The map spans `span` chunks
 * from you to its rim: the chunk's own distance, rounded up to 2, 4, 8 ...
 * so a near chunk is drawn near and a far one at the rim.
 */
export function locatorPoint(w: Pick<Where, 'dx' | 'dz' | 'chunks'>, maxSpan = 16): { x: number; y: number; span: number; past: boolean } {
  let span = 2
  while (BigInt(span) < w.chunks && span < maxSpan) span *= 2
  const r = BigInt(span * N)
  const m = big(abs(w.dx), abs(w.dz))
  const past = m > r
  const scale = past ? m : r
  if (scale === 0n) return { x: 0, y: 0, span, past: false }
  const x = Number((w.dx * 1_000_000n) / scale) / 1_000_000
  const z = Number((w.dz * 1_000_000n) / scale) / 1_000_000
  return { x, y: -z, span, past }
}
