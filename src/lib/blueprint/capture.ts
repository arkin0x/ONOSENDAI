/**
 * capture.ts - RECORD: the BLUEPRINT tool's capture in TERRAIN (design page
 * 4.8 step 1). The build under the cross is read as a smash would read it
 * (lib/blueprint/arrangement.ts), and nothing is removed. It must stand
 * alone, or a smash of it could never match: RECORD says so in plain words
 * (a creation tool, so it may tell the maker; the Compiler still says
 * nothing before a smash). On success the tool opens again at the prize.
 */

import { gather } from './arrangement'
import { terrainSession, useTerrain } from '../../store/useTerrain'
import { terrainCursor } from '../../scene/TerrainLayer'
import { useBlueprintTool } from '../../store/useBlueprintTool'
import { leaveTerrain } from '../../store/padMode'

export function recordAtCursor(): void {
  const s = terrainSession
  const hit = terrainCursor.hit
  if (!s || !hit) { useTerrain.getState().say('Aim at a block of the build, then RECORD.'); return }
  const g = gather((x, y, z) => s.world.blockCs(x, y, z), hit.cell)
  if (!g.isolated || !g.arrangement) {
    useTerrain.getState().say('That build touches something or is too big. It must stand alone, with an empty cell all round, and fit in 16 by 16 by 16.')
    return
  }
  const o = s.world.origin
  useBlueprintTool.getState().captured(g.arrangement, { lo: { x: o.x + BigInt(g.lo[0]), y: o.y + BigInt(g.lo[1]), z: o.z + BigInt(g.lo[2]) }, plane: s.plane })
  leaveTerrain()
}
