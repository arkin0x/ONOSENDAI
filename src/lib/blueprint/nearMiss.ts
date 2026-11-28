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
 *
 * And for any build, not only the game's: too big for a bare hand, an
 * isolated construction longer than a bare hand's reach of 3 on some axis
 * (tooBigBare). A bare hand compiles anything that fits its reach (owner,
 * 2026-11-28: "You should be able to compile anything without the compiler
 * as long as it's small enough to fit within the range."), so that is the
 * only hand a build can be wrong for.
 *
 * The struck block must be one of the recipe's: the search anchors the
 * recipe on it in every orientation, so it is a few reads per anchor and
 * never per frame (the preview works it out only when the aim rests on a new
 * block: smashPreview.ts).
 *
 * The words (the preview's tail and the line after the smash) live here too,
 * so the preview and the smash never say different things. The owner's
 * wording rule: "not touching any other block", "isolated" or "with a gap all
 * round"; never the words for upright posture.
 */

import { arrangementFrom, fitsIsolated, type Cell, type Gathered } from './arrangement'
import { cellAt, type Arrangement } from './format'
import { CINDERROCK, COMPILER_RECIPE, GLOWCORE, QUARRY_CHARGE_RECIPE, recipeNeeds, sameArrangement } from './recipes'
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

/** What a recipe makes, in a sentence: "it won't make Quarry Charges". */
const MAKES: Readonly<Record<RecipeId, string>> = { compiler: 'the Compiler', quarry: 'Quarry Charges' }

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

/**
 * The struck build's blocks, counted by material: the placed blocks (not natural ground) reachable from `hit` through
 * faces, edges and corners. Null past RECIPE_MAX + NEAR_MISS_EXTRA blocks (it can be no near miss), or when the hit is
 * natural ground.
 */
function placedCounts(read: Read, hit: Cell, natural?: (x: number, y: number, z: number) => boolean): Map<number, number> | null {
  const placed = (x: number, y: number, z: number): boolean => read(x, y, z) !== 0 && !natural?.(x, y, z)
  if (!placed(hit[0], hit[1], hit[2])) return null
  const seen = new Set<string>([`${hit[0]},${hit[1]},${hit[2]}`])
  const q: Array<readonly [number, number, number]> = [hit]
  for (let i = 0; i < q.length; i++) {
    const [x, y, z] = q[i]
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = [x + dx, y + dy, z + dz] as const
      const k = `${c[0]},${c[1]},${c[2]}`
      if (seen.has(k) || !placed(c[0], c[1], c[2])) continue
      seen.add(k)
      q.push(c)
      if (q.length > RECIPE_MAX + NEAR_MISS_EXTRA) return null
    }
  }
  const out = new Map<number, number>()
  for (const [x, y, z] of q) { const id = read(x, y, z); out.set(id, (out.get(id) ?? 0) + 1) }
  return out
}

/** Whether counted blocks hold a recipe's: at least its count of every material, and at most NEAR_MISS_EXTRA more blocks. */
function holdsRecipe(counts: ReadonlyMap<number, number>, recipe: Arrangement): boolean {
  const needs = recipeNeeds(recipe)
  let need = 0, have = 0
  for (const [id, n] of Object.entries(needs)) { if ((counts.get(Number(id)) ?? 0) < n) return false; need += n }
  for (const n of counts.values()) have += n
  return have - need <= NEAR_MISS_EXTRA
}

/**
 * Whether a game recipe is built at `hit` (its blocks exactly, in some orientation, the hit one of them) but will not
 * make what it makes; null when no recipe is there, or when it is there and makes it. `natural` says whether a cell is
 * natural ground (TERRAIN's generated ground, unchanged); without it nothing touching counts as the ground.
 *
 * Only when the struck build is the recipe's blocks and at most NEAR_MISS_EXTRA more (coordinator's ruling on #973):
 * the placed blocks connected to the hit, counted by material, must hold the recipe's, with no more than 3 besides. A
 * T on a small platform or with a stray block is TOUCHING A BLOCK; a larger build that holds a recipe's shape is never
 * called a near miss. Natural ground is not part of the build, so a recipe resting on it is TOUCHING THE GROUND.
 */
export function nearMiss(read: Read, hit: Cell, natural?: (x: number, y: number, z: number) => boolean): NearMiss | null {
  const hitId = read(hit[0], hit[1], hit[2])
  if (!hitId) return null
  const counts = placedCounts(read, hit, natural)
  if (!counts) return null
  let best: NearMiss | null = null
  for (const r of allPoses()) {
    if (!holdsRecipe(counts, RECIPES.find((x) => x.id === r.id)!.recipe)) continue
    for (const pose of r.poses) for (const b of pose.blocks) {
      if (b[3] !== hitId) continue
      const lo = [hit[0] - b[0], hit[1] - b[1], hit[2] - b[2]] as const
      if (!pose.blocks.every(([x, y, z, id]) => read(lo[0] + x, lo[1] + y, lo[2] + z) === id)) continue
      const touching = touchOf(read, lo, pose, natural)
      // Isolated and the right way round: it compiles in either hand (every game recipe fits a bare hand's reach).
      if (!touching && !pose.turned) return null
      const m: NearMiss = { recipe: r.id, name: r.name, turned: pose.turned, touching }
      // The right way round wins over a turned reading of the same blocks.
      if (!best || (best.turned && !m.turned)) best = m
    }
  }
  return best
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
export type MissCause = 'turned' | 'ground' | 'block' | 'big'

export function missCause(m: NearMiss): MissCause {
  return m.turned ? 'turned' : m.touching === 'ground' ? 'ground' : 'block'
}

/** The preview's tail after BREAKS (or COMPILES) and the count. */
export const CAUSE_WORDS: Readonly<Record<MissCause, string>> = {
  turned: 'TURNED THE WRONG WAY',
  ground: 'TOUCHING THE GROUND',
  block: 'TOUCHING A BLOCK',
  big: 'TOO BIG FOR A BARE HAND',
}

/** The line after a bare-handed smash of a build too big for it. */
export const TOO_BIG_LINE = 'Nothing compiled. That build is too big for a bare hand, which compiles builds up to 3 blocks on every side. The Compiler reaches 16.'

/** Why a near miss will not compile, in the past (after the smash) or the present (before it). */
function reasons(m: NearMiss, past: boolean): string {
  const why: string[] = []
  if (m.turned) why.push(past ? 'it was turned the wrong way' : 'it is turned the wrong way')
  if (m.touching === 'ground') why.push(past ? 'it touched the ground' : 'it is touching the ground')
  if (m.touching === 'block') why.push(past ? 'it touched another block' : 'it is touching another block')
  return list(why)
}

/** How to build it so it compiles. */
function fixOf(m: NearMiss): string {
  return m.turned && m.touching ? ' Build it as the card shows, with a gap all round.'
    : m.turned ? ' Build it as the card shows.'
      : ' Build it with a gap all round.'
}

/** The line after the smash: "That was the Compiler, but it touched the ground. Build it with a gap all round." */
export function nearMissLine(m: NearMiss): string {
  return `That was ${m.name}, but ${reasons(m, true)}.${fixOf(m)}`
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
 * built wrong: "This won't compile. It breaks 5 blocks, including placed Glowcore. Smash anyway?", or for a near miss
 * "This is the Compiler, but it is touching the ground, so it won't compile. Build it with a gap all round. Smashing
 * breaks 5 blocks, including placed Glowcore. Smash anyway?". An isolated turned recipe compiles, in either hand, as
 * another shape, so it "won't make" the recipe's prize rather than "won't compile" (`compiled`).
 */
export function confirmWords(count: number, rare: readonly string[], miss: NearMiss | null, compiled = false, tooBig = false): string {
  const blocks = `${count} block${count === 1 ? '' : 's'}`
  const incl = rare.length ? `, including placed ${list(rare)}` : ''
  const big = tooBig ? ' It is too big for a bare hand, which compiles builds up to 3 blocks on every side.' : ''
  if (!miss) return `This won't compile.${big} It breaks ${blocks}${incl}. Smash anyway?`
  const outcome = compiled ? `it won't make ${MAKES[miss.recipe]}` : "it won't compile"
  return `This is ${miss.name}, but ${reasons(miss, false)}, so ${outcome}.${fixOf(miss)} Smashing breaks ${blocks}${incl}. Smash anyway?`
}
