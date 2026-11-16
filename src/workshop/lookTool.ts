/**
 * lookTool.ts - LOOK, the workshop tool that shows the shard as the world
 * draws it, as plain rules: which tool it is, which ShardMesh switches it
 * takes, and the canvas's units put right (benchLook.tsx says why).
 */

import { cellsPerUnit } from '../scene/dotScale'
import { headlampReach } from '../scene/headlamp'
import type { Tool } from '../store/useWorkshop'

/** LOOK, the tool that only looks (store `view`). */
export const LOOK_TOOL: Tool = 'view'

/** Whether `tool` shows the shard as the world does, with no editing marks. */
export function isLook(tool: Tool): boolean {
  return tool === LOOK_TOOL
}

/**
 * The ShardMesh switches for the bench's shard: the world's in LOOK (`world`,
 * which brings its headlamp, as WorldShards draws every shard), the bench's
 * lights in every other tool.
 */
export function benchShardLook(look: boolean): { world: boolean; lit: boolean } {
  return look ? { world: true, lit: false } : { world: false, lit: true }
}

/**
 * The factor on the discs' size in LOOK (scene/dotScale.ts): model units per
 * render cell for this shard at this zoom, 2^(zoom - unit). At 1 (a shard of
 * unit 0 seen at 2^0, the usual case) the world's numbers as they are.
 */
export function lookDotScale(unit: number, scaleExp: number): number {
  return 1 / cellsPerUnit(unit, scaleExp)
}

/**
 * The headlamp's reach for a bench camera `distance` bench units from what
 * it orbits, for a shard drawn at `k` render cells per model unit: the
 * world's reach for the same view, in cells, brought back to bench units.
 */
export function benchReach(distance: number, k: number): number {
  return headlampReach(distance * k) / k
}
