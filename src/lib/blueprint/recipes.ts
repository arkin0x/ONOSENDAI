/**
 * recipes.ts - the recipes the game ships. They use exactly the same key and
 * lookup as everyone's blueprints (design page 3, "The starter recipes are
 * blueprints"); the game simply knows them, with every block revealed.
 *
 * The Compiler (owner, 2026-11-26): four Gridstone in a plus around a
 * Ferrovein, a Glowcore on top. The only recipe a bare hand can smash (a
 * longer hold, and only the 3 by 3 by 3 box round the hit, so it comes away
 * whole when hit in its middle column), and the only way to get a Compiler. The plus lies flat
 * (cyberspace X and Z) and the Glowcore stands on it (+Y, TERRAIN's up): a
 * box 3 wide, 3 deep and 2 high, 18 cells read with the empty ones.
 */

import { arrangementFrom } from './arrangement'
import type { Arrangement } from './format'

export const GRIDSTONE = 1
export const FERROVEIN = 40
export const GLOWCORE = 42

/** The Compiler's arrangement, in world axes. */
export const COMPILER_RECIPE: Arrangement = arrangementFrom([
  { at: [1, 0, 0], id: GRIDSTONE },
  { at: [0, 0, 1], id: GRIDSTONE },
  { at: [1, 0, 1], id: FERROVEIN },
  { at: [2, 0, 1], id: GRIDSTONE },
  { at: [1, 0, 2], id: GRIDSTONE },
  { at: [1, 1, 1], id: GLOWCORE },
])!

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
