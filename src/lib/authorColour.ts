/**
 * authorColour.ts: each author's colour, one of eight picked from their key
 * (hidden messages UI, shared piece "Author colour"; owner, 2026-11-26).
 *
 * The colour is on a letter's seal in the world, on the seal in the lists, by
 * the name on a card and as the dot beside a name in a row. It is a hash of
 * the pubkey, so the same author wears the same colour on every device and
 * in every list, with nothing stored.
 *
 * The eight keep clear of the colours that already mean something in the
 * scene, so a seal never reads as one of them: the trail's red, the sidestep
 * purple, the pink of a game and the green of a region box (RESERVED_HUES).
 * That leaves two bands of hue, the warm one from orange through lime and
 * the cool one from aqua through periwinkle, and the eight are spread across
 * both at a lightness that reads on the dark scene and under white text's
 * shadow alike.
 *
 * Pure: no store, no DOM.
 */

/** The hues already spoken for in the scene, in degrees, with what each means. */
export const RESERVED_HUES: ReadonlyArray<{ name: string; colour: string; hue: number; clearance?: number }> = [
  // scene/PathTrail.tsx TRAIL_RED
  { name: 'trail red', colour: '#ff0000', hue: 0 },
  // lib/palette.ts SIDESTEP
  { name: 'sidestep purple', colour: '#c07dff', hue: 272 },
  // lib/palette.ts GAME
  { name: 'game pink', colour: '#ff7ad9', hue: 317 },
  // scene/DeployRegionBox.tsx REGION and SecretRegions HELD
  { name: 'region green', colour: '#52e39f', hue: 152 },
  // lib/palette.ts ACCENT: the HUD's cyan, the colour of the glyph ring, the decode and the arrows.
  // Kept apart less widely (ACCENT_CLEARANCE), so a sky blue may stand beside it.
  { name: 'HUD cyan', colour: '#00e5ff', hue: 186, clearance: 15 },
]

/** How far, in degrees of hue, every author colour stays from every reserved hue. */
export const HUE_CLEARANCE = 24

/**
 * The eight, warm band first. Each is checked against RESERVED_HUES by test
 * (authorColour.test.ts), so a change that drifts toward a meaning colour fails.
 */
export const AUTHOR_COLOURS: readonly string[] = [
  '#ffa35e', // orange
  '#ffcf6b', // amber
  '#f2e266', // straw
  '#c4ec6c', // lime
  '#9ae873', // leaf, well short of the region box's mint
  '#7cc8ff', // sky
  '#8ea6ff', // periwinkle
  '#c4e4ff', // ice, the sky made pale
]

/** A hex colour's hue in degrees [0, 360), or null for a grey. */
export function hueOf(hex: string): number | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return null
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return null
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return ((h * 60) + 360) % 360
}

/** The shortest way round the hue circle between two hues, degrees. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Which of the eight an author wears: an FNV-1a hash of the pubkey, so it never changes. */
export function authorColourIndex(pubkey: string): number {
  let h = 2166136261
  for (let i = 0; i < pubkey.length; i++) h = Math.imul(h ^ pubkey.charCodeAt(i), 16777619)
  return (h >>> 0) % AUTHOR_COLOURS.length
}

/** An author's colour. An unknown author (no pubkey) wears the first. */
export function authorColour(pubkey: string | null | undefined): string {
  return AUTHOR_COLOURS[pubkey ? authorColourIndex(pubkey) : 0]
}
