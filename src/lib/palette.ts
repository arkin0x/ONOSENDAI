/**
 * palette.ts — the visual language.
 *
 * Two encodings carry the protocol meaning and must stay distinguishable:
 *   - terrain K (0..16) as a cool-to-hot field, drawn as filled cells
 *   - LCA boundary height as line brightness, drawn as lines on top
 *
 * They use different marks (fill vs line) so they can be read simultaneously.
 */

import { Color } from 'three'

export const BG = '#05070d'
export const FG = '#c8f5ff'
export const ACCENT = '#00e5ff'
export const WARN = '#ffb020'
export const DANGER = '#ff3b6b'
/** Merkle sidestep: the ideaspace purple, distinct from hop amber. */
export const SIDESTEP = '#c07dff'
export const DIM = '#3a5566'

/**
 * Terrain K colour ramp. K is Binomial(16, 0.5), so it clusters hard around 8;
 * the ramp is tuned to spread the common 5..11 band rather than the full range.
 */
const TERRAIN_STOPS: Array<[number, string]> = [
  [0, '#06111c'],
  [4, '#0b3550'],
  [6, '#0e5f7a'],
  [8, '#1c8f7a'],
  [10, '#8fbf3f'],
  [12, '#e8a33d'],
  [14, '#f2653c'],
  [16, '#ff2e6b'],
]

const cache = new Map<number, Color>()

/**
 * Colour for a terrain K value in [0, 16].
 */
export function terrainColor(k: number): Color {
  const hit = cache.get(k)
  if (hit) return hit

  let lo = TERRAIN_STOPS[0]
  let hi = TERRAIN_STOPS[TERRAIN_STOPS.length - 1]
  for (let i = 0; i < TERRAIN_STOPS.length - 1; i++) {
    if (k >= TERRAIN_STOPS[i][0] && k <= TERRAIN_STOPS[i + 1][0]) {
      lo = TERRAIN_STOPS[i]
      hi = TERRAIN_STOPS[i + 1]
      break
    }
  }
  const span = hi[0] - lo[0]
  const t = span === 0 ? 0 : (k - lo[0]) / span
  const color = new Color(lo[1]).lerp(new Color(hi[1]), t)
  cache.set(k, color)
  return color
}

/**
 * Brightness for an LCA boundary line.
 *
 * `height` is the LCA height paid to cross, `floor` is the cheapest possible
 * crossing at the current scale (an ordinary step boundary). Excess above the
 * floor is what makes a boundary expensive, so that is what we light up.
 */
export function boundaryIntensity(height: number, floor: number): number {
  const excess = Math.max(0, height - floor)
  // Each extra height level doubles cost, so a log-ish ramp reads linearly.
  return Math.min(1, 0.12 + excess / 12)
}

/**
 * Colour for an LCA boundary line.
 *
 * Uses a three-stop ramp from extremely dark blue (cheap crossings) through
 * purple (moderate cost) to light purple (expensive crossings). This gives
 * much stronger visual distinction than brightness alone.
 *
 * `excess` is the height above the scale floor (what makes a boundary costly).
 */
const LCA_STOPS: Array<[number, string]> = [
  [0, '#0a0e27'],    // extremely dark blue — cheapest crossings
  [5, '#1a1a5e'],    // dark indigo
  [10, '#3b1d8e'],   // deep purple
  [20, '#7c3aed'],   // vivid purple
  [40, '#a855f7'],   // bright purple
  [60, '#c084fc'],   // light purple
  [85, '#e9d5ff'],   // very light purple — most expensive crossings
]

const lcaCache = new Map<number, Color>()

export function boundaryColor(excess: number): Color {
  const cached = lcaCache.get(excess)
  if (cached) return cached

  let lo = LCA_STOPS[0]
  let hi = LCA_STOPS[LCA_STOPS.length - 1]
  for (let i = 0; i < LCA_STOPS.length - 1; i++) {
    if (excess >= LCA_STOPS[i][0] && excess <= LCA_STOPS[i + 1][0]) {
      lo = LCA_STOPS[i]
      hi = LCA_STOPS[i + 1]
      break
    }
  }

  const span = hi[0] - lo[0]
  const t = span === 0 ? 0 : Math.min(1, (excess - lo[0]) / span)
  const color = new Color(lo[1]).lerp(new Color(hi[1]), t)
  lcaCache.set(excess, color)
  return color
}
