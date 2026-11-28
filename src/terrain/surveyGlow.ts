/**
 * surveyGlow.ts - how the chunk a SURVEY hold will fill is lit, as numbers
 * (owner, 2026-11-27: "light up the chunk region being surveyed somehow while
 * the survey button is being held so we know what one is being acted upon").
 * scene/SurveyGlow.tsx draws it: the chunk's twelve edges glowing in
 * TERRAIN's mint, its faces faintly filled, breathing a little faster as the
 * hold fills; steady with reduced motion. Let go and it is gone; held to the
 * end, it flashes once as the ground comes in, and fades.
 *
 * The chunk is the hold's own (surveyHold.ts `key`), the one the survey
 * fills, never chosen again here. Pure: nothing here reads a store or the clock.
 */

import { holdFraction } from './holdProgress'

/** TERRAIN's mint, the SURVEY hold's own colour (holdProgress.ts HOLD_ACTIONS). */
export const GLOW_COLOUR = '#7cffc4'
/** One breath at the start of a hold, and at its end, in milliseconds: it quickens as the hold fills. */
export const GLOW_SLOW_MS = 1400
export const GLOW_FAST_MS = 380
/** The edges' opacity between breaths and at a breath's height; held steady (reduced motion) at GLOW_EDGE_STEADY. */
export const GLOW_EDGE_LOW = 0.5
export const GLOW_EDGE_HIGH = 1
export const GLOW_EDGE_STEADY = 0.85
/** The faces' opacity, the same way: faint, so the scene inside the chunk stays readable. */
export const GLOW_FACE_LOW = 0.035
export const GLOW_FACE_HIGH = 0.09
export const GLOW_FACE_STEADY = 0.06
/** The wide soft line under the edges (the glow), as a share of the edges' opacity. */
export const GLOW_HALO_SHARE = 0.32
/** The flash as a hold completes: this long, starting this bright, fading to nothing. */
export const GLOW_FLASH_MS = 520
export const GLOW_FLASH_FACE = 0.22

/** What the glow draws this frame. */
export interface GlowLook {
  /** The chunk lit, by key, or null for nothing. */
  key: string | null
  edge: number
  face: number
  halo: number
}

/** What the glow reads from the hold (surveyHold.ts). */
export interface GlowHold {
  since: number | null
  key: string | null
  flash: { key: string; at: number } | null
}

/** One breath's length at `fraction` of the hold. */
export function glowPeriod(fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction))
  return GLOW_SLOW_MS + (GLOW_FAST_MS - GLOW_SLOW_MS) * f
}

/** The breath's phase (0 to 1, round) after `dt` milliseconds more at `fraction` of the hold. */
export function advanceGlow(phase: number, dt: number, fraction: number): number {
  const p = phase + Math.max(0, dt) / glowPeriod(fraction)
  return p - Math.floor(p)
}

/**
 * The look this frame, written into `out` (a frame makes nothing new): the
 * hold's chunk while it is held (breathing at `phase`, or steady when
 * `reduced`), the flash just after a hold completes (not with reduced motion),
 * else nothing.
 */
export function glowLook(out: GlowLook, hold: GlowHold, now: number, phase: number, reduced: boolean): GlowLook {
  if (hold.since !== null && hold.key) {
    const wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase)
    out.key = hold.key
    out.edge = reduced ? GLOW_EDGE_STEADY : GLOW_EDGE_LOW + (GLOW_EDGE_HIGH - GLOW_EDGE_LOW) * wave
    out.face = reduced ? GLOW_FACE_STEADY : GLOW_FACE_LOW + (GLOW_FACE_HIGH - GLOW_FACE_LOW) * wave
    out.halo = out.edge * GLOW_HALO_SHARE
    return out
  }
  const f = hold.since === null && hold.flash && !reduced ? 1 - (now - hold.flash.at) / GLOW_FLASH_MS : 0
  if (f > 0 && f <= 1 && hold.flash) {
    out.key = hold.flash.key
    out.edge = f
    out.face = GLOW_FLASH_FACE * f
    out.halo = f * 0.6
    return out
  }
  out.key = null; out.edge = 0; out.face = 0; out.halo = 0
  return out
}

/** How far through the hold it is, for the breath's speed (holdProgress.ts holdFraction). */
export function glowFraction(hold: GlowHold, now: number, holdMs: number): number {
  return holdFraction(hold.since, holdMs, now)
}
