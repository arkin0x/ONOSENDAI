/**
 * recipes.ts - the recipes the game ships. They use exactly the same key and
 * lookup as everyone's blueprints (design page 3, "The starter recipes are
 * blueprints"); the game simply knows them, with every block revealed.
 *
 * The Compiler (owner, 2026-11-27: "a 3x3 hammer", replacing the plus of
 * 2026-11-26): an upright T hammer. A handle of two Ferrovein standing on
 * each other, a Glowcore on top, and a Rustband either side of the Glowcore
 * along X: the head. In world axes (+Y up, TERRAIN's up): a box 3 wide (X),
 * 3 high (Y) and 1 deep (Z), 9 cells read with the empty ones. It fits a
 * bare hand's reach of 3 on every axis, so it compiles bare-handed struck at
 * any of its blocks, as anything that fits does (owner, 2026-11-28), and it
 * is the only way to get a Compiler.
 *
 * The Quarry Charge (DECK-0010 §8.5) is the second game recipe: below.
 */

import { arrangementFrom } from './arrangement'
import type { Arrangement } from './format'

export const GRIDSTONE = 1
export const UMBERSLATE = 2
export const RUSTBAND = 5
export const CINDERROCK = 7
export const FERROVEIN = 40
export const GLOWCORE = 42

/** The Compiler's arrangement, in world axes: the T hammer. */
export const COMPILER_RECIPE: Arrangement = arrangementFrom([
  { at: [1, 0, 0], id: FERROVEIN },
  { at: [1, 1, 0], id: FERROVEIN },
  { at: [0, 2, 0], id: RUSTBAND },
  { at: [1, 2, 0], id: GLOWCORE },
  { at: [2, 2, 0], id: RUSTBAND },
])!

/**
 * The Quarry Charge's arrangement (DECK-0010 §8.5, owner 2026-11-27), in
 * world axes: a cross of seven in a box of 3 on every axis. A Ferrovein at
 * the centre; Rustband on -X, -Z and +Z of it and a Cinderrock on +X; an
 * Umberslate below the centre and another above it. The Cinderrock sets its
 * facing: mirrored across X it is another arrangement and compiles nothing,
 * while mirrored across Y or Z it is the same. It fits a bare hand's reach,
 * so it compiles in either hand (owner, 2026-11-28: smash.ts compiles), and
 * yields seven Quarry Charges.
 */
export const QUARRY_CHARGE_RECIPE: Arrangement = arrangementFrom([
  { at: [1, 0, 1], id: UMBERSLATE },
  { at: [1, 1, 0], id: RUSTBAND },
  { at: [0, 1, 1], id: RUSTBAND },
  { at: [1, 1, 1], id: FERROVEIN },
  { at: [2, 1, 1], id: CINDERROCK },
  { at: [1, 1, 2], id: RUSTBAND },
  { at: [1, 2, 1], id: UMBERSLATE },
])!

/** How many Quarry Charges one compile of its recipe gives (DECK-0010 §8.5: its prize's count). */
export const QUARRY_CHARGE_COUNT = 7

/** Whether two arrangements are the same build (same box, same blocks in the same cells). */
export function sameArrangement(a: Arrangement, b: Arrangement): boolean {
  if (a.size[0] !== b.size[0] || a.size[1] !== b.size[1] || a.size[2] !== b.size[2] || a.cells.length !== b.cells.length) return false
  for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false
  return true
}

/** The blocks a recipe needs, by id. */
export function recipeNeeds(a: Arrangement): Record<number, number> {
  const out: Record<number, number> = {}
  for (const id of a.cells) if (id) out[id] = (out[id] ?? 0) + 1
  return out
}
