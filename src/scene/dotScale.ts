/**
 * dotScale.ts - how big a shard's point discs are, for a canvas whose units
 * are not the world's render cells.
 *
 * A disc's size (pointDisc.ts) is a diameter in the units of the camera that
 * draws it, never in the shard's own model units: a shard drawn larger by its
 * group's scale keeps the same dots. In the world those units are render
 * cells, and a shard of `unit` u at the zoom 2^n is drawn at 2^(u - n) cells
 * per model unit (WorldShards placeShard), so its dots are SIZE / 2^(u - n)
 * of a model unit across. The workshop's bench draws one model unit per bench
 * unit. Its LOOK tool shows the shard as the world does (arkinox, 2026-11-15:
 * "in the LOOK tool only we should make the vertices and faces look exactly
 * like they would in cyberspace"), so there the discs are given in model
 * units, 2^(n - u) of the world's size, and at the same size on screen the
 * two pictures carry the same dots. The pixel floor and cap are CSS pixels on
 * both canvases and stay as they are.
 *
 * Every other canvas reads 1 and draws exactly as before. A context rather
 * than a prop, so the shard's placed objects, drawn by its own ShardMesh,
 * take the same scale with no prop threaded through.
 */

import { createContext, useContext } from 'react'
import type { DiscProfile } from './pointDisc'

/** The factor on every disc's size below it: 1, the world's, unless a canvas says otherwise. */
export const DotScale = createContext(1)

/** The factor this ShardMesh's discs are drawn at. */
export function useDotScale(): number {
  return useContext(DotScale)
}

/** A disc profile at `k` times its size; the same object at 1, so nothing else changes. */
export function scaledDisc(profile: DiscProfile, k: number): DiscProfile {
  return k === 1 || !(k > 0) || !Number.isFinite(k) ? profile : { ...profile, size: profile.size * k }
}

/**
 * Render cells per model unit for a shard of `unit` at the zoom 2^`scaleExp`,
 * as the world draws it (WorldShards placeShard): 2^(unit - scaleExp).
 */
export function cellsPerUnit(unit: number, scaleExp: number): number {
  return 2 ** (unit - scaleExp)
}
