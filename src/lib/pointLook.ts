/**
 * pointLook.ts - an object's point size and glow as the renderer and the
 * workshop read them (DECK-0003 §1.15 Point size, §1.16 Glow).
 *
 * sno-core reads the two fields (sno-core/glow: drawnPointSize, drawnGlow)
 * and applies their rules: read only in POINTS mode, ignored by an avatar,
 * malformed means absent. This file turns what it reads into what is drawn:
 *
 * | Field | Drawn as |
 * |---|---|
 * | `pointsize` absent | the client's own point size (scene/pointDisc.ts SHARD_POINTS), as before |
 * | `pointsize` 0 | no points at all |
 * | `pointsize` n | points n ticks across: n / 120 model units, scaled with the object like its vertices |
 * | `glow` | a halo round each point, `radius / 120` model units, GLOW STRENGTH `strength / 100` at its centre |
 *
 * GLOW STRENGTH is the glow's own: the object's opacity never multiplies it
 * (owner, 2026-11-15: "we want to be able to cast a glow or fog without
 * drawing a point"). An object at opacity 0 draws nothing of its own, and its
 * glow still shows.
 *
 * The workshop shows both lengths in gibsons at the object's scale
 * (ticksToGibsons, gibsonsLabel) and writes ticks.
 */

import { drawnGlow, drawnPointSize, type Glow } from 'sno-core/glow'
import { TICKS_PER_UNIT, drawnOpacity, type ShardModel } from 'sno-core/shards'

type Looked = Pick<ShardModel, 'mode' | 'opacity' | 'vertices'> & Partial<Pick<ShardModel, 'extra' | 'parts'>>

/** Ticks of an object's own lattice as model units: 120 ticks to the unit. */
export function ticksToUnits(ticks: number): number {
  return ticks / TICKS_PER_UNIT
}

/** Ticks of an object's own lattice in gibsons, at its `unit` (one model unit is 2^unit gibsons) and any placement step. */
export function ticksToGibsons(ticks: number, unit: number, step = 0): number {
  return (ticks / TICKS_PER_UNIT) * 2 ** (unit + step)
}

/** Gibsons for reading: "0.4 GIBSON", "1 GIBSON", "16 GIBSONS", "2^40 GIBSONS" past a million. */
export function gibsonsLabel(g: number): string {
  if (!(g > 0)) return '0 GIBSONS'
  if (g >= 1_000_000) return `2^${Math.round(Math.log2(g))} GIBSONS`
  const shown = g >= 100 ? Math.round(g) : g >= 10 ? Math.round(g * 10) / 10 : Math.round(g * 100) / 100
  const text = shown === 0 ? '<0.01' : String(shown)
  return `${text} ${shown === 1 ? 'GIBSON' : 'GIBSONS'}`
}

/** What one object draws of its points and glow, for the renderer. */
export interface PointLook {
  /** The point's diameter in model units, or undefined for the client's own size; 0 draws no points. */
  pointSize: number | undefined
  /** The glow, or undefined for none. */
  glow: Glow | undefined
  /** The halo's radius in model units (0 with no glow). */
  glowRadius: number
  /** GLOW STRENGTH at a point's centre, 0 to 1 (0 with no glow). Never multiplied by the object's opacity. */
  glowStrength: number
  /** Opacity 0: the object draws no face, line, point or dot of its own (its glow still shows). */
  hidden: boolean
}

/**
 * How `s` draws its points and glow. `avatar`: an avatar ignores both, and its
 * opacity too (DECK-0003 §3.3), so it is never hidden. A placed object passes
 * its own model, never its parent's (§1.10).
 */
export function pointLookOf(s: Looked, { avatar = false }: { avatar?: boolean } = {}): PointLook {
  const ticks = drawnPointSize(s, { avatar })
  const glow = drawnGlow(s, { avatar })
  return {
    pointSize: ticks === undefined ? undefined : ticksToUnits(ticks),
    glow,
    glowRadius: glow ? ticksToUnits(glow.radius) : 0,
    glowStrength: glow ? glow.strength / 100 : 0,
    hidden: !avatar && drawnOpacity(s) === 0,
  }
}

/**
 * Whether an object draws anything at all, itself or what it places: a
 * picture of one that draws nothing is rightly blank (scene/ThumbStage.tsx
 * waits for a draw otherwise). Nothing is drawn when it has no vertices, or
 * is at opacity 0, or is POINTS at point size 0, and it has no glow and
 * places nothing.
 */
export function drawsAnything(s: Looked, opts: { avatar?: boolean } = {}): boolean {
  if ((s.parts?.length ?? 0) > 0) return true
  return drawsItself(s, opts)
}

/** Whether an object draws anything of its own, leaving aside what it places (scene/ThumbStage.tsx knownBlank). */
export function drawsItself(s: Looked, opts: { avatar?: boolean } = {}): boolean {
  if (s.vertices.length === 0) return false
  const look = pointLookOf(s, opts)
  if (look.glow) return true
  if (look.hidden) return false
  return !(s.mode === 'points' && look.pointSize === 0)
}

/** What ShardMesh draws for one object: its faces, lines, points (the client's disc, billboards at a POINT SIZE, or none) and halos. */
export interface DrawPlan {
  faces: boolean
  lines: boolean
  points: 'disc' | 'billboard' | 'none'
  halos: boolean
}

/**
 * The draw plan for an object in `mode` with `look` (pointLookOf). `cull`:
 * an avatar seen from inside (only its faces' fronts). `glowAllowed`: the
 * Settings switch lets halos draw here (scene/PointBillboards.tsx).
 * At opacity 0 nothing of the object's own is drawn, and its halos are.
 */
export function drawPlan(mode: ShardModel['mode'], look: Pick<PointLook, 'pointSize' | 'glow' | 'hidden'>, { cull = false, glowAllowed = true }: { cull?: boolean; glowAllowed?: boolean } = {}): DrawPlan {
  const own = !look.hidden
  const points = cull || !own ? 'none' : look.pointSize === undefined ? 'disc' : look.pointSize > 0 ? 'billboard' : 'none'
  return {
    faces: own && mode === 'solid',
    lines: own && !cull && mode === 'lines',
    points,
    halos: !!look.glow && glowAllowed && !cull,
  }
}

/**
 * What a halo's GLOW STRENGTH is multiplied by: only the client's own fade of
 * the whole object (a ghost's share, `dim` for a held item or a fade), never
 * the object's opacity (owner, 2026-11-15).
 */
export function haloFade({ ghostShare = 1, dim = 1 }: { ghostShare?: number; dim?: number }): number {
  return ghostShare * dim
}

/**
 * How many doublings further off an object's glow keeps it worth drawing
 * (WorldShards FAR_CULL): log2(1 + radius in model units), 0 with no glow. A
 * glow of 64 units widens the cull by six, and one of the 4,096-unit cap by twelve.
 */
export function glowReachDoublings(s: Looked): number {
  const g = drawnGlow(s)
  return g ? Math.log2(1 + ticksToUnits(g.radius)) : 0
}

/**
 * Whether no one can see an object (a walker it stops is shown its outline,
 * store/wallHint.ts; the bench shows faint dots): opacity 0 (its glow, if any,
 * does not show where the faces are), or POINTS at point size 0 with no glow.
 */
export function unseenObject(s: Looked): boolean {
  if (s.vertices.length === 0) return false
  if (drawnOpacity(s) === 0) return true
  return s.mode === 'points' && drawnPointSize(s) === 0 && drawnGlow(s) === undefined
}

/**
 * Whether the workshop's bench shows faint dots for an object no one can see
 * (DECK-0003 §1.11, §1.15: its author must be able to find it). The bench's
 * vertex handles mark every vertex in every editing tool, except while an
 * object with `anim` is drawn moving, when they are hidden (`moving`); LOOK
 * (`world`, the bench drawing the shard as the world does) shows the world
 * as it is, so never there; never off the bench.
 */
export function benchFaintDots(s: Looked, look: Pick<PointLook, 'hidden' | 'pointSize' | 'glow'>, { onBench, moving, cull = false, world }: { onBench: boolean; moving: boolean; cull?: boolean; world: boolean }): boolean {
  if (!onBench || !moving || cull || world) return false
  return look.hidden || (s.mode === 'points' && look.pointSize === 0 && !look.glow)
}
