/**
 * nearMiss.ts - a game recipe built right but smashed wrong (owner's lost
 * Glowcore, 2026-11-28): the Compiler's T was correct, but its handle rested
 * on the floor, so the group was not isolated (arrangement.ts gather) and a
 * bare-handed smash deleted all five blocks with nothing compiled. The
 * preview said BREAKS 5 and nothing said why.
 *
 * Here, without the app: whether the blocks at the hit are one of the game's
 * own recipes (recipes.ts: the Compiler and the Quarry Charge) and why it
 * will not compile:
 *
 * - touching: another block touches one of the recipe's blocks on a face,
 *   edge or corner (the owner's isolation rule, as arrangement.ts gather). "The ground" only when that block is natural ground
 *   (TERRAIN's generated block, unchanged: TerrainWorld naturalCs); a placed
 *   block, even a platform under the build, is "a block" (review of #969).
 * - turned: the right blocks in the right shape, but rotated or mirrored
 *   into another arrangement (every turn and mirror of the box is tried; one
 *   that gives the same arrangement, as the Quarry Charge's mirror across Y
 *   or Z does, is the right way round). An isolated turned recipe
 *   still compiles, in either hand, as the arrangement it is, but it
 *   is not the recipe and makes nothing unless someone made a blueprint of
 *   that shape: it is a near miss all the same (review of #969).
 * - wrong: the recipe's shape, every cell filled, but a block or two of the
 *   wrong kind (owner's third smash, 2026-11-28: a Rustband where the
 *   Quarry Charge's top Umberslate goes). It compiles, in either hand, as the
 *   arrangement it is, and makes nothing. At most wrongMax(recipe) blocks
 *   may differ (one in the Compiler's five, two in the Quarry Charge's
 *   seven), so a build of the same shape in other blocks is not called a
 *   near miss.
 *
 * And for any build, not only the game's: too big for a bare hand, an
 * isolated construction longer than a bare hand's reach of 3 on some axis
 * (tooBigBare). A bare hand compiles anything that fits its reach (owner,
 * 2026-11-28: "You should be able to compile anything without the compiler
 * as long as it's small enough to fit within the range."), so that is the
 * only hand a build can be wrong for.
 *
 * - missing: the recipe's shape with a cell or two empty, the rest right,
 *   even when the gap splits it in pieces (splitMiss). Wrong and missing
 *   together are at most wrongMax(recipe).
 *
 * The verdict is the build's, the same from every one of its blocks (owner,
 * 2026-11-28): an isolated build is judged by its arrangement, a touching one
 * by the recipe's own cells. A natural formation alone never warns, and
 * striking natural ground warns only when that block is one of the recipe's.
 * It is worked out only when the aim rests on a new block (smashPreview.ts),
 * never per frame.
 *
 * The words (the preview's tail and the line after the smash) live here too,
 * so the preview and the smash never say different things. The owner's
 * wording rule: "not touching any other block", "isolated" or "with a gap all
 * round"; never the words for upright posture.
 */

import { arrangementFrom, fitsIsolated, gather, type Cell, type Gathered } from './arrangement'
import { cellAt, type Arrangement } from './format'
import { CINDERROCK, COMPILER_RECIPE, GLOWCORE, QUARRY_CHARGE_RECIPE, sameArrangement } from './recipes'
import { blockName } from '../terrain/blocks'
import { PRIZED } from '../terrain/assay'

type Read = (x: number, y: number, z: number) => number

/** Which game recipe. */
export type RecipeId = 'compiler' | 'quarry'

/** A game recipe built but not compiling, and why. */
export interface NearMiss {
  recipe: RecipeId
  /** What the recipe is called in a sentence: "the Compiler". */
  name: string
  /** Rotated or mirrored into another arrangement. */
  turned: boolean
  /** What touches it: natural ground, another block, or nothing. */
  touching: 'ground' | 'block' | null
  /** Blocks of the wrong kind in the recipe's shape: what is there, and what goes there. Empty when every block is right. */
  wrong: Array<{ is: number; should: number }>
  /** Cells of the recipe's shape left empty. */
  missing: number
}

/** One orientation of a recipe: its blocks as offsets from its box's low corner, its size, and whether it is turned. */
interface Pose {
  size: readonly [number, number, number]
  blocks: ReadonlyArray<readonly [number, number, number, number]>
  turned: boolean
}

const RECIPES: ReadonlyArray<{ id: RecipeId; name: string; recipe: Arrangement }> = [
  { id: 'compiler', name: 'the Compiler', recipe: COMPILER_RECIPE },
  { id: 'quarry', name: 'the Quarry Charge', recipe: QUARRY_CHARGE_RECIPE },
]

/** What a recipe makes, in a sentence: "Won't make Quarry Charges". */
const MAKES: Readonly<Record<RecipeId, string>> = { compiler: 'the Compiler', quarry: 'Quarry Charges' }
/** The label a near miss's line starts with after the smash: "No Compiler: touching the ground." */
const NO_PRIZE: Readonly<Record<RecipeId, string>> = { compiler: 'No Compiler', quarry: 'No Quarry Charges' }

function blocksOf(a: Arrangement): Array<readonly [number, number, number, number]> {
  const out: Array<readonly [number, number, number, number]> = []
  a.cells.forEach((id, i) => { if (id) { const [x, y, z] = cellAt(a.size, i); out.push([x, y, z, id]) } })
  return out
}

const PERMS: ReadonlyArray<readonly [number, number, number]> = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]

/** Every distinct orientation of a recipe (the 48 turns and mirrors of its box), the right way round first. */
export function posesOf(recipe: Arrangement): Pose[] {
  const seen: Arrangement[] = []
  const out: Pose[] = []
  const src = blocksOf(recipe)
  for (const p of PERMS) for (let flips = 0; flips < 8; flips++) {
    const s = [flips & 1 ? -1 : 1, flips & 2 ? -1 : 1, flips & 4 ? -1 : 1]
    const a = arrangementFrom(src.map(([x, y, z, id]) => {
      const v = [x, y, z]
      return { at: [s[0] * v[p[0]], s[1] * v[p[1]], s[2] * v[p[2]]] as Cell, id }
    }))!
    if (seen.some((b) => sameArrangement(a, b))) continue
    seen.push(a)
    out.push({ size: a.size, blocks: blocksOf(a), turned: !sameArrangement(a, recipe) })
  }
  return out
}

/** The most wrong blocks a build of a recipe's shape may have and still be called that recipe: one in five, two in seven. */
export function wrongMax(pose: Pick<Pose, 'blocks'>): number {
  return Math.floor((pose.blocks.length - 1) / 3)
}

let poses: Array<{ id: RecipeId; name: string; poses: Pose[] }> | null = null
function allPoses(): Array<{ id: RecipeId; name: string; poses: Pose[] }> {
  poses ??= RECIPES.map((r) => ({ id: r.id, name: r.name, poses: posesOf(r.recipe) }))
  return poses
}

/** The most blocks in a game recipe. */
const RECIPE_MAX = Math.max(...RECIPES.map((r) => r.recipe.cells.filter((id) => id).length))
/**
 * How many placed blocks past a recipe's own its build may hold and still be called a near miss (coordinator's ruling
 * on #973): a T on a small platform, or with a stray block at a corner, is a recipe built wrong; a build with 4 or
 * more blocks besides is a player's own build that happens to hold a recipe's shape.
 */
export const NEAR_MISS_EXTRA = 3

/** The reach a game recipe is judged in: every game recipe fits a bare hand's 3, so either hand gathers it the same. */
const RECIPE_REACH = 3

/** The game recipe an arrangement is, exactly (its own blocks, the right way round), or null. */
export function recipeOf(a: Arrangement | null): RecipeId | null {
  if (!a) return null
  for (const r of RECIPES) if (sameArrangement(a, r.recipe)) return r.id
  return null
}

/**
 * Whether a game recipe is built at `hit` but will not make what it makes; null when no recipe is there, or when it is
 * there and makes it. The same answer from every block of the build (owner, 2026-11-28: "it shouldn't matter which
 * block you're pointing at"):
 *
 * - An isolated build (the gather's arrangement, the same from each of its blocks) is judged as a whole against every
 *   turn and mirror of each recipe: the recipe itself is no near miss; the recipe turned, or with up to wrongMax
 *   blocks of the wrong kind or cells left empty, and nothing extra, is (arrangementMiss).
 * - A build that touches something is a near miss when a recipe's blocks are there exactly, in some orientation, the
 *   hit one of them, with at most NEAR_MISS_EXTRA placed blocks touching it besides (touchingMiss).
 *
 * Natural ground counts as a block of the build like any other: a natural Umberslate where the recipe wants one is
 * that Umberslate (the owner's Quarry Charge, 2026-11-28, kept a natural Umberslate as its base).
 */
export function nearMiss(read: Read, hit: Cell, natural?: (x: number, y: number, z: number) => boolean): NearMiss | null {
  if (!read(hit[0], hit[1], hit[2])) return null
  const g = gather(read, hit, RECIPE_REACH)
  if (recipeOf(g.arrangement)) return null
  // A natural formation alone is never a recipe built wrong: a near miss needs a block someone placed (review of #982).
  const placed = (cells: ReadonlyArray<readonly [number, number, number]>): boolean => cells.some(([x, y, z]) => !natural?.(x, y, z))
  if (g.arrangement) {
    if (!placed(g.cells)) return null
    return arrangementMiss(g.arrangement) ?? splitMiss(read, g, natural) ?? touchingMiss(read, hit, natural)
  }
  return touchingMiss(read, hit, natural)
}

/**
 * A recipe with a block missing that splits it in two (a T without its middle Ferrovein: the handle's foot is one
 * build, the head another): the isolated groups within a recipe's box of the struck one, taken together, judged as
 * one arrangement (arrangementMiss). Null when there is no other piece, when a piece touches something else, or when
 * the pieces together span more than a recipe's box. Each piece finds the others, so every block says the same.
 */
function splitMiss(read: Read, g: Gathered, natural?: (x: number, y: number, z: number) => boolean): NearMiss | null {
  const cells = new Map<string, readonly [number, number, number]>()
  for (const c of g.cells) cells.set(`${c[0]},${c[1]},${c[2]}`, c)
  const own = cells.size
  const span = RECIPE_REACH - 1
  for (let y = g.lo[1] - span; y < g.lo[1] + g.size[1] + span; y++) for (let z = g.lo[2] - span; z < g.lo[2] + g.size[2] + span; z++) for (let x = g.lo[0] - span; x < g.lo[0] + g.size[0] + span; x++) {
    if (cells.has(`${x},${y},${z}`) || !read(x, y, z)) continue
    const other = gather(read, [x, y, z], RECIPE_REACH)
    // A piece that touches something past it, or is too big, is not a loose piece of a recipe.
    if (!other.arrangement) return null
    for (const c of other.cells) cells.set(`${c[0]},${c[1]},${c[2]}`, c)
  }
  if (cells.size === own) return null
  const all = [...cells.values()]
  const a = arrangementFrom(all.map((c) => ({ at: c as Cell, id: read(c[0], c[1], c[2]) })))
  if (!a || a.size.some((v) => v > RECIPE_REACH)) return null
  if (!all.some(([x, y, z]) => !natural?.(x, y, z))) return null
  const m = arrangementMiss(a)
  return m && m.missing > 0 ? m : null
}

/**
 * An isolated arrangement against every orientation of each game recipe: null when it is a recipe exactly or near
 * none; else the closest (fewest wrong and missing, the right way round first). Its blocks must all lie in the recipe's
 * shape (an extra block is another build), with at most wrongMax blocks of the wrong kind and wrongMax cells empty.
 */
export function arrangementMiss(a: Arrangement): NearMiss | null {
  if (recipeOf(a)) return null
  const mine = blocksOf(a)
  let best: NearMiss | null = null
  let bestCost = Infinity
  for (const r of allPoses()) for (const pose of r.poses) {
    const max = wrongMax(pose)
    if (mine.length < pose.blocks.length - max) continue
    if (a.size[0] > pose.size[0] || a.size[1] > pose.size[1] || a.size[2] > pose.size[2]) continue
    const want = new Map(pose.blocks.map(([x, y, z, id]) => [`${x},${y},${z}`, id]))
    for (let ox = 0; ox <= pose.size[0] - a.size[0]; ox++) for (let oy = 0; oy <= pose.size[1] - a.size[1]; oy++) for (let oz = 0; oz <= pose.size[2] - a.size[2]; oz++) {
      const wrong: Array<{ is: number; should: number }> = []
      let extra = false
      for (const [x, y, z, id] of mine) {
        const should = want.get(`${x + ox},${y + oy},${z + oz}`)
        if (should === undefined) { extra = true; break }
        if (should !== id) wrong.push({ is: id, should })
      }
      const missing = pose.blocks.length - mine.length
      // Wrong and missing together within the limit, so a label never hides a second fault (review of #982).
      if (extra || wrong.length + missing > max || (!wrong.length && !missing && !pose.turned)) continue
      const cost = wrong.length + missing + (pose.turned ? 0.5 : 0)
      if (cost < bestCost) { bestCost = cost; best = { recipe: r.id, name: r.name, turned: pose.turned && !wrong.length && !missing, touching: null, wrong, missing } }
    }
  }
  return best
}

/**
 * A recipe's blocks exactly at `hit`, in some orientation, touching something: what touches it (natural ground is "the
 * ground", a placed block "a block"), and whether it is turned. The placed blocks touching the recipe's cells, counted
 * from those cells (not from the hit, so every block of it gives the same answer), may be at most NEAR_MISS_EXTRA.
 */
function touchingMiss(read: Read, hit: Cell, natural?: (x: number, y: number, z: number) => boolean): NearMiss | null {
  let best: NearMiss | null = null
  for (const at of anchorsOf(read, hit, natural)) {
    const m = touchingAt(read, at, natural)
    if (m === 'recipe') return null
    if (m && (!best || (best.turned && !m.turned))) best = m
  }
  return best
}

/**
 * Where a recipe's blocks are looked for: the hit, and when it is a placed block, the placed blocks connected to it (a
 * few at most), so a stray block stuck to a recipe finds the recipe too and every block of the build says the same.
 */
function anchorsOf(read: Read, hit: Cell, natural?: (x: number, y: number, z: number) => boolean): Cell[] {
  // Struck on natural ground, only a recipe that holds that very block (digging beside a build never warns).
  if (natural?.(hit[0], hit[1], hit[2])) return [hit]
  const placed: Cell[] = [hit]
  const kept: Cell[] = []
  const seen = new Set([`${hit[0]},${hit[1]},${hit[2]}`])
  for (let i = 0; i < placed.length; i++) {
    const [x, y, z] = placed[i]
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c: Cell = [x + dx, y + dy, z + dz]
      const k = `${c[0]},${c[1]},${c[2]}`
      if (seen.has(k)) continue
      seen.add(k)
      const id = read(c[0], c[1], c[2])
      if (!id) continue
      if (natural?.(c[0], c[1], c[2])) {
        // A natural block of a recipe's material beside the build may be one of its cells (a natural Umberslate as the
        // Quarry Charge's base): an anchor, not followed further, so a stray touching only that base finds the recipe as
        // extraPlaced counts it (review of #982).
        if (RECIPE_IDS.has(id) && kept.length < NATURAL_ANCHORS_MAX) kept.push(c)
        continue
      }
      placed.push(c)
      if (placed.length > RECIPE_MAX + NEAR_MISS_EXTRA) return [hit]
    }
  }
  return [...placed, ...kept]
}

/** The materials of the game's recipes: only a natural block of one of these can be a recipe's cell. */
const RECIPE_IDS: ReadonlySet<number> = new Set(RECIPES.flatMap((r) => [...r.recipe.cells].filter((id) => id)))
/** The most natural blocks looked at as recipe cells round one build. */
const NATURAL_ANCHORS_MAX = 64

/** A recipe's blocks exactly at `at` (one of them), touching something or turned; 'recipe' when it is there isolated and the right way round. */
function touchingAt(read: Read, at: Cell, natural?: (x: number, y: number, z: number) => boolean): NearMiss | 'recipe' | null {
  const hitId = read(at[0], at[1], at[2])
  let best: NearMiss | null = null
  for (const r of allPoses()) for (const pose of r.poses) for (const b of pose.blocks) {
    if (b[3] !== hitId) continue
    const lo = [at[0] - b[0], at[1] - b[1], at[2] - b[2]] as const
    if (!pose.blocks.every(([x, y, z, id]) => read(lo[0] + x, lo[1] + y, lo[2] + z) === id)) continue
    const touching = touchOf(read, lo, pose, natural)
    if (!touching && !pose.turned) return 'recipe'
    // A natural formation alone is never a recipe built wrong (review of #982).
    if (pose.blocks.every(([x, y, z]) => natural?.(lo[0] + x, lo[1] + y, lo[2] + z))) continue
    if (extraPlaced(read, lo, pose, natural) > NEAR_MISS_EXTRA) continue
    const m: NearMiss = { recipe: r.id, name: r.name, turned: pose.turned, touching, wrong: [], missing: 0 }
    // The right way round wins over a turned reading of the same blocks.
    if (!best || (best.turned && !m.turned)) best = m
  }
  return best
}

/** The placed blocks (not natural ground) connected to a recipe's cells at `lo`, not counting its own; stops past NEAR_MISS_EXTRA. */
function extraPlaced(read: Read, lo: readonly [number, number, number], pose: Pose, natural?: (x: number, y: number, z: number) => boolean): number {
  const own = new Set(pose.blocks.map(([x, y, z]) => `${lo[0] + x},${lo[1] + y},${lo[2] + z}`))
  const seen = new Set(own)
  const q: Array<readonly [number, number, number]> = pose.blocks.map(([x, y, z]) => [lo[0] + x, lo[1] + y, lo[2] + z] as const)
  let extra = 0
  for (let i = 0; i < q.length && extra <= NEAR_MISS_EXTRA && q.length <= RECIPE_MAX + NEAR_MISS_EXTRA + 1; i++) {
    const [x, y, z] = q[i]
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = [x + dx, y + dy, z + dz] as const
      const k = `${c[0]},${c[1]},${c[2]}`
      if (seen.has(k)) continue
      seen.add(k)
      if (!read(c[0], c[1], c[2]) || natural?.(c[0], c[1], c[2])) continue
      extra++
      q.push(c)
    }
  }
  return extra
}

/**
 * What touches a recipe at `lo`: a block, not one of its own, on a face, edge or corner of one of its blocks (the
 * owner's isolation rule): natural ground is "the ground", any placed block "a block". A block in its box that touches
 * nothing does not count (arrangement.ts gather).
 */
function touchOf(read: Read, lo: readonly [number, number, number], pose: Pose, natural?: (x: number, y: number, z: number) => boolean): 'ground' | 'block' | null {
  const mine = new Set(pose.blocks.map(([x, y, z]) => `${x},${y},${z}`))
  let found: 'ground' | 'block' | null = null
  for (const [bx, by, bz] of pose.blocks) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const x = bx + dx, y = by + dy, z = bz + dz
    if (mine.has(`${x},${y},${z}`)) continue
    const wx = lo[0] + x, wy = lo[1] + y, wz = lo[2] + z
    if (!read(wx, wy, wz)) continue
    // Natural ground anywhere round it, under it or beside it; anything placed is a block.
    if (natural?.(wx, wy, wz)) return 'ground'
    found = 'block'
  }
  return found
}

/** A world's natural-ground test for nearMiss, when it has one (TerrainWorld naturalCs); a stand-in world without it gives none. */
export function naturalOf(world: { naturalCs?: (x: number, y: number, z: number) => boolean }): ((x: number, y: number, z: number) => boolean) | undefined {
  const f = world.naturalCs
  return f ? (x, y, z) => f.call(world, x, y, z) : undefined
}

/**
 * Whether a bare-handed smash at `hit` meets an isolated construction too big for a bare hand, from the bare gather
 * `g`: isolated with no arrangement is too big already (it fits the bare window of 5, so the Compiler's 16 too); not
 * isolated, it may be a longer build the bare window cut off, so the Compiler's reach is asked (arrangement.ts
 * fitsIsolated), stopping as soon as the group passes 16 on an axis or touches past the window. Never asked with the
 * Compiler in hand, nor when the bare gather made an arrangement.
 */
export function tooBigBare(read: Read, hit: Cell, bare: boolean, g: Pick<Gathered, 'isolated' | 'arrangement'>, reads?: { count: number }): boolean {
  if (!bare || g.arrangement) return false
  if (g.isolated) return true
  return fitsIsolated(read, hit, undefined, reads)
}

/** The one cause the preview names, most important first. */
export type MissCause = 'missing' | 'wrong' | 'turned' | 'ground' | 'block' | 'big'

export function missCause(m: NearMiss): MissCause {
  return m.missing ? 'missing' : m.wrong.length ? 'wrong' : m.turned ? 'turned' : m.touching === 'ground' ? 'ground' : 'block'
}

/** The preview's tail after BREAKS (or COMPILES) and the count. */
export const CAUSE_WORDS: Readonly<Record<MissCause, string>> = {
  missing: 'MISSING A BLOCK',
  wrong: 'WRONG BLOCK',
  turned: 'TURNED',
  ground: 'NOT AIR GAPPED',
  block: 'NOT AIR GAPPED',
  big: 'TOO BIG FOR A BARE HAND',
}

/** A near miss's label by the cross, in the warning red, never COMPILES: "WRONG BLOCK", "2 WRONG BLOCKS", "MISSING A BLOCK". */
export function missLabel(m: NearMiss): string {
  const c = missCause(m)
  if (c === 'missing' && m.missing > 1) return `MISSING ${m.missing} BLOCKS`
  if (c === 'wrong' && m.wrong.length > 1) return `${m.wrong.length} WRONG BLOCKS`
  return CAUSE_WORDS[c]
}

/** What an exact game recipe that will yield says by the cross, in place of COMPILES: its prize. */
export const PRIZE_LABEL: Readonly<Record<RecipeId, string>> = { compiler: 'COMPILER', quarry: 'QUARRY CHARGE' }

/** The line after a bare-handed smash of a build too big for it. */
export const TOO_BIG_LINE = 'Too big for bare hands: 3x3x3 at most. The Compiler takes 16x16x16.'

/** What is wrong with a near miss's shape, as plain labels: "a Rustband where an Umberslate goes", "turned the wrong way". */
function reasons(m: NearMiss): string {
  const why: string[] = []
  // The same wrong block in the same kind's places, said once: "two Rustbands where Umberslates go".
  const same = new Map<string, { is: number; should: number; n: number }>()
  for (const w of m.wrong) { const k = `${w.is}>${w.should}`; const e = same.get(k); if (e) e.n++; else same.set(k, { ...w, n: 1 }) }
  for (const w of same.values()) {
    why.push(w.n === 1
      ? `${article(blockName(w.is))} where ${article(blockName(w.should))} goes`
      : `${countWord(w.n)} ${plural(blockName(w.is))} where ${plural(blockName(w.should))} go`)
  }
  if (m.missing) why.push(m.missing === 1 ? 'a block missing' : `${countWord(m.missing)} blocks missing`)
  if (m.turned) why.push('turned the wrong way')
  return list(why)
}

/** What it touches, in the owner's words: " Not air gapped: touching the ground."; empty when it is air gapped. */
function touchOfMiss(m: NearMiss): string {
  return m.touching ? ` Not air gapped: touching ${m.touching === 'ground' ? 'the ground' : 'another block'}.` : ''
}

/** "Label: what is wrong.", or "Label." when only the touch is wrong, then the touch. */
function missWords(label: string, m: NearMiss): string {
  const shape = reasons(m)
  return `${label}${shape ? `: ${shape}` : ''}.${touchOfMiss(m)}`
}

/** The line after the smash: "No Compiler. Not air gapped: touching the ground." */
export function nearMissLine(m: NearMiss): string {
  return missWords(NO_PRIZE[m.recipe], m)
}

/** "two", "three", or the number. */
function countWord(n: number): string {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'][n] ?? String(n)
}

/** "Rustbands", "Canopy glasses". */
function plural(name: string): string {
  return /(s|x|ch|sh)$/i.test(name) ? `${name}es` : `${name}s`
}

/** "a Rustband", "an Umberslate". */
function article(name: string): string {
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`
}

/** Recipe materials too rare to lose without asking: the rare band, Glowcore and Cinderrock. */
export const RARE_MATERIALS: ReadonlySet<number> = new Set([...PRIZED, GLOWCORE, CINDERROCK])

/**
 * The rare recipe materials among the blocks a smash would delete, by name, once each: only blocks someone placed
 * (owner's ruling, 2026-11-28: digging natural ore never asks). `natural` tells natural ground; without it every block
 * counts as placed.
 */
export function rareLost(blocks: Iterable<{ at: readonly [number, number, number]; id: number }>, natural?: (x: number, y: number, z: number) => boolean): string[] {
  const out: string[] = []
  for (const b of blocks) {
    if (!RARE_MATERIALS.has(b.id) || natural?.(b.at[0], b.at[1], b.at[2])) continue
    const n = blockName(b.id)
    if (!out.includes(n)) out.push(n)
  }
  return out
}

/** "A", "A and B", "A, B and C". */
function list(words: readonly string[]): string {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/**
 * The confirm's question, when a smash that will not compile would destroy placed rare materials, or is a game recipe
 * built wrong: "Won't compile. Breaks 5 blocks, including placed Glowcore.", or for a near miss "Won't compile. Not
 * air gapped: touching the ground. Breaks 5 blocks, including placed Glowcore." The confirm's title asks "Smash
 * anyway?". An isolated turned recipe compiles, in either hand, as another shape, so it
 * "won't make" the recipe's prize rather than "won't compile" (`compiled`).
 */
export function confirmWords(count: number, rare: readonly string[], miss: NearMiss | null, compiled = false, tooBig = false): string {
  const blocks = `${count} block${count === 1 ? '' : 's'}`
  const incl = rare.length ? `, including placed ${list(rare)}` : ''
  if (!miss) return `Won't compile${tooBig ? ': too big for bare hands, 3x3x3 at most' : ''}. Breaks ${blocks}${incl}.`
  const outcome = compiled ? `Won't make ${MAKES[miss.recipe]}` : "Won't compile"
  return `${missWords(outcome, miss)} Breaks ${blocks}${incl}.`
}
