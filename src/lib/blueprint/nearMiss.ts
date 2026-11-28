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
 * - touching: another block is in the recipe's box grown by one (faces,
 *   edges and corners). "The ground" when that block is natural ground (when
 *   the caller can tell) or lies under the build, what it rests on; "a block"
 *   otherwise.
 * - turned: the right blocks in the right shape, but rotated or mirrored
 *   into another arrangement (every turn and mirror of the box is tried; one
 *   that gives the same arrangement, as the Quarry Charge's mirror across Y
 *   or Z does, is the right way round).
 * - needs the Compiler: the Quarry Charge, isolated and the right way round,
 *   struck bare-handed (only the Compiler's own recipe compiles bare).
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

import { arrangementFrom, type Cell } from './arrangement'
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
  /** What touches it: natural ground or what it rests on, another block, or nothing. */
  touching: 'ground' | 'block' | null
  /** The Quarry Charge struck bare-handed: it compiles only with the Compiler in hand. */
  needsCompiler: boolean
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

/**
 * Whether a game recipe stands at `hit` (its blocks exactly, in some orientation, the hit one of them) and will not
 * compile; null when no recipe is there, or when it is there and compiles. `natural` says whether a cell is natural
 * ground (TERRAIN's generated ground, unchanged); without it only what the build rests on counts as the ground.
 */
export function nearMiss(read: Read, hit: Cell, bare: boolean, natural?: (x: number, y: number, z: number) => boolean): NearMiss | null {
  const hitId = read(hit[0], hit[1], hit[2])
  if (!hitId) return null
  let best: NearMiss | null = null
  for (const r of allPoses()) for (const pose of r.poses) for (const b of pose.blocks) {
    if (b[3] !== hitId) continue
    const lo = [hit[0] - b[0], hit[1] - b[1], hit[2] - b[2]] as const
    if (!pose.blocks.every(([x, y, z, id]) => read(lo[0] + x, lo[1] + y, lo[2] + z) === id)) continue
    const touching = touchOf(read, lo, pose, natural)
    const needsCompiler = bare && r.id !== 'compiler'
    // Isolated, the right way round and in a hand that compiles it: not a miss.
    if (!touching && !pose.turned && !needsCompiler) return null
    const m: NearMiss = { recipe: r.id, name: r.name, turned: pose.turned, touching, needsCompiler }
    // The right way round wins over a turned reading of the same blocks.
    if (!best || (best.turned && !m.turned)) best = m
  }
  return best
}

/** What touches a recipe at `lo`: a cell of its box grown by one that is not one of its blocks and holds a block. */
function touchOf(read: Read, lo: readonly [number, number, number], pose: Pose, natural?: (x: number, y: number, z: number) => boolean): 'ground' | 'block' | null {
  const mine = new Set(pose.blocks.map(([x, y, z]) => `${x},${y},${z}`))
  let found: 'ground' | 'block' | null = null
  for (let y = -1; y <= pose.size[1]; y++) for (let z = -1; z <= pose.size[2]; z++) for (let x = -1; x <= pose.size[0]; x++) {
    if (mine.has(`${x},${y},${z}`)) continue
    const wx = lo[0] + x, wy = lo[1] + y, wz = lo[2] + z
    if (!read(wx, wy, wz)) continue
    // Under the build (what it rests on), or natural ground anywhere round it.
    if (y < 0 || natural?.(wx, wy, wz)) return 'ground'
    found = 'block'
  }
  return found
}

/** A world's natural-ground test for nearMiss, when it has one (TerrainWorld naturalCs); a stand-in world without it gives none. */
export function naturalOf(world: { naturalCs?: (x: number, y: number, z: number) => boolean }): ((x: number, y: number, z: number) => boolean) | undefined {
  const f = world.naturalCs
  return f ? (x, y, z) => f.call(world, x, y, z) : undefined
}

/** The one cause the preview names, most important first. */
export type MissCause = 'turned' | 'ground' | 'block' | 'compiler'

export function missCause(m: NearMiss): MissCause {
  return m.turned ? 'turned' : m.touching === 'ground' ? 'ground' : m.touching === 'block' ? 'block' : 'compiler'
}

/** The preview's tail after BREAKS and the count. */
export const CAUSE_WORDS: Readonly<Record<MissCause, string>> = {
  turned: 'TURNED THE WRONG WAY',
  ground: 'TOUCHING THE GROUND',
  block: 'TOUCHING A BLOCK',
  compiler: 'NEEDS THE COMPILER',
}

/** Why a near miss will not compile, in the past (after the smash) or the present (before it). */
function reasons(m: NearMiss, past: boolean): string {
  const why: string[] = []
  if (m.turned) why.push(past ? 'it was turned the wrong way' : 'it is turned the wrong way')
  if (m.touching === 'ground') why.push(past ? 'it touched the ground' : 'it is touching the ground')
  if (m.touching === 'block') why.push(past ? 'it touched another block' : 'it is touching another block')
  if (m.needsCompiler) why.push('it needs the Compiler in hand')
  return list(why)
}

/** How to build it so it compiles, or nothing when only the hand was wrong. */
function fixOf(m: NearMiss): string {
  return m.turned && m.touching ? ' Build it as the card shows, with a gap all round.'
    : m.turned ? ' Build it as the card shows.'
      : m.touching ? ' Build it with a gap all round.'
        : ''
}

/** The line after the smash: "That was the Compiler, but it touched the ground. Build it with a gap all round." */
export function nearMissLine(m: NearMiss): string {
  return `That was ${m.name}, but ${reasons(m, true)}.${fixOf(m)}`
}

/** Recipe materials too rare to lose without asking: the rare band, Glowcore and Cinderrock. */
export const RARE_MATERIALS: ReadonlySet<number> = new Set([...PRIZED, GLOWCORE, CINDERROCK])

/** The rare recipe materials among the blocks a smash would delete, by name, rarest kinds as found, once each. */
export function rareLost(ids: Iterable<number>): string[] {
  const out: string[] = []
  for (const id of ids) if (RARE_MATERIALS.has(id)) { const n = blockName(id); if (!out.includes(n)) out.push(n) }
  return out
}

/** "A", "A and B", "A, B and C". */
function list(words: readonly string[]): string {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/**
 * The confirm's question, when a smash that will not compile would destroy rare materials or is a recipe near miss:
 * "This won't compile. It breaks 5 blocks, including your Glowcore. Smash anyway?", or for a near miss "This is the
 * Compiler, but it is touching the ground, so it won't compile. Build it with a gap all round. Smashing breaks 5
 * blocks, including your Glowcore. Smash anyway?"
 */
export function confirmWords(count: number, rare: readonly string[], miss: NearMiss | null): string {
  const blocks = `${count} block${count === 1 ? '' : 's'}`
  const incl = rare.length ? `, including your ${list(rare)}` : ''
  if (!miss) return `This won't compile. It breaks ${blocks}${incl}. Smash anyway?`
  return `This is ${miss.name}, but ${reasons(miss, false)}, so it won't compile.${fixOf(miss)} Smashing breaks ${blocks}${incl}. Smash anyway?`
}
