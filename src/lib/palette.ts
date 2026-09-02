/**
 * palette.ts — the visual language.
 *
 * Two encodings carry the protocol meaning and must stay distinguishable:
 *   - terrain K (0..16) as a cool-to-hot field, drawn as filled cells
 *   - LCA boundary height as a full-spectrum hue, violet through red
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
/**
 * Sector lattice. Its own colour rather than WARN, which is amber and means
 * cost: a sector boundary is a fact about where you are, not a warning.
 *
 * Saturated orange because bloom desaturates. WARN sits at 255/176/32, already
 * yellow-leaning, and a bloomed halo of it over a teal scene reads khaki. This
 * gives up brightness in the green channel to hold its hue through the glow.
 */
export const SECTOR = '#f7931a'
/**
 * The aligned-subtree lattice: background structure, and deliberately the most
 * recessive thing drawn.
 *
 * Fixed rather than taken from the LCA ramp. That ramp maps height to hue, and
 * the drawn lattice heights follow the zoom, so the grid slid up the spectrum as
 * you zoomed out: indigo at scaleExp 0, teal by 24, yellow by 55, and orange by
 * 70, where it collides with the sector cage, then red, where it collides with
 * the avatar. Hue has to say WHAT a thing is before it can say how much.
 */
export const LATTICE = '#4b3fa7'
/**
 * Earth, in dataspace.
 *
 * Blue, and free of every other assignment at the zooms it appears: the planet
 * is only drawable between roughly scaleExp 50 and 56, where the lattice ramp is
 * up in yellow and orange and the sector cage has long stopped being drawn.
 */
export const EARTH = '#2f81f7'
/**
 * The geographic reference lines: equator and prime meridian, and their
 * labels. This is v1's dataspace green (0x4bc9a7), revived on purpose: green
 * against EARTH's blue is how v1 marked these two lines, and at the zooms a
 * graticule appears nothing else is speaking green.
 */
export const MERIDIAN = '#4bc9a7'
/**
 * The shoreline.
 *
 * Green because a coastline is the edge of land, and green is what land is,
 * where the graticule stays EARTH's blue because it is a coordinate ruling
 * rather than a thing that exists. MERIDIAN's teal walked twenty degrees
 * toward lime (hue 164 to 144): near enough to read as the same family as the
 * equator and prime meridian, far enough that a continent's outline is never
 * mistaken for one of them.
 *
 * This was briefly a filled tint under the outline. The fill is gone and the
 * colour survived it, which is the right way round: the line was always the
 * content and the fill was always the decoration.
 */
export const COAST = '#4bc97d'
/**
 * The black sun: the one absolute bearing in cyberspace (§11.2).
 *
 * Purple per the spec, and its own constant rather than SIDESTEP, which is also
 * purple but means "this crossing is a Merkle sidestep". The sun is not a cost
 * and not a plane, it is the direction +Z_cs, so sharing a swatch with a cost
 * would say something false about it.
 *
 * Pinker than SIDESTEP so the two are separable when both are on screen, which
 * they routinely are: sidesteps are exactly the expensive moves you make while
 * navigating by the sun. Kept deliberately dark for its size, since it is drawn
 * large enough to sit behind everything else and a bright fill at that scale
 * washes out the geometry you are actually navigating by.
 */
export const BLACK_SUN = '#9258d1'
/**
 * Colour for one level of the lattice: the LCA ramp for hue, lightness for level.
 *
 * The lattice belongs on the ramp. Its walls ARE crossings and their height is
 * exactly what the ramp was built to encode, so as you zoom out the grid should
 * climb the spectrum with the cost: violet in the small, red out where a single
 * step is ruinous. That is what the HUD legend has always promised.
 *
 * It was taken off the ramp for a while because the grid slid into the sector
 * cage's orange as you zoomed out. That is no longer possible: the cage is only
 * drawn between scaleExp 23 and 30, where the lattice sits in blue through
 * green, and the ramp does not reach orange until 55.
 *
 * The three levels are consecutive heights, so on a smooth ramp they land on
 * nearly the same colour, which is why hue alone cannot separate them. Lightness
 * does that instead, and it darkens INWARD from the ramp rather than lightening
 * outward from it. Two reasons.
 *
 * The outermost box is then exactly the colour the legend swatch shows, so the
 * key and the scene agree on one reading rather than on a family of them. And
 * lightening a saturated hue is how you get pastel: an orange lifted toward
 * white came out peach, which read as a different kind of thing rather than as
 * the same ramp one step up. Darkening keeps the hue recognisable all the way
 * down, and the biggest, costliest box being the brightest is the right ordering
 * anyway.
 */
const LIGHTNESS: number[] = [0.45, 0.7, 1]

export function latticeShade(height: number, level: number): string {
  // boundaryColor hands back a cached instance, so it must not be mutated.
  const c = boundaryColor(height).clone()
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  // Hue and saturation held fixed: all three are the same colour at three
  // weights, not three colours.
  c.setHSL(hsl.h, hsl.s, hsl.l * (LIGHTNESS[level] ?? 1))
  return `#${c.getHexString()}`
}
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
 * Colour for an LCA boundary line.
 *
 * Uses a three-stop ramp from extremely dark blue (cheap crossings) through
 * purple (moderate cost) to light purple (expensive crossings). This gives
 * much stronger visual distinction than brightness alone.
 *
 * `excess` is the height above the scale floor (what makes a boundary costly).
 */
const LCA_STOPS: Array<[number, string]> = [
  [0, '#4c1d95'],    // deep violet — cheapest crossings
  [8, '#4338ca'],    // indigo
  [16, '#0284c7'],   // blue
  [26, '#0d9488'],   // teal
  [36, '#16a34a'],   // green
  [48, '#eab308'],   // yellow
  [62, '#f97316'],   // orange
  [85, '#ef4444'],   // red — most expensive crossings
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
