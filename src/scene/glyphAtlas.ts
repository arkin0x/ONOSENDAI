/**
 * glyphAtlas.ts: one texture holding every glyph the hidden-message letters
 * draw in the world: the ring's glyphs (lib/glyphRing RING_CHARS: capital
 * letters, digits, katakana and the block textures) and the letters and
 * digits a seal's initial may be (lib/letterReveal SEAL_INITIALS). Shared by
 * every letter, so a hall of rings is one texture and one draw
 * (scene/LetterField.tsx).
 *
 * A cell is ATLAS_CELL pixels square, ATLAS_COLS to a row, each glyph white
 * on transparent and centred in its cell; a shader picks a cell by its index
 * (atlasIndex).
 *
 * The glyphs are drawn on a canvas once, then copied into the texture's own
 * array, so the texture never depends on the canvas again. That is the fix
 * for rings that vanished after the app came back from the background
 * (owner, 2026-11-27: "the ring of glyphs disappear sometimes like when i
 * left the app ... i had to refresh"): a mobile browser may throw away a 2D
 * canvas's pixels while the page is hidden, and when it also takes the WebGL
 * context and gives it back, three uploads every texture again from its
 * source. A CanvasTexture's source was the emptied canvas, so the atlas came
 * back blank. An array held in memory comes back whole. The atlas is also
 * drawn again when the page shows again, when the WebGL context comes back
 * (refreshGlyphAtlas, called from LetterField) and once the HUD's font has
 * loaded.
 *
 * Where there is no canvas (tests, a worker) the cells stay empty and the
 * texture is still a texture of the full size, so everything mounts.
 */

import { DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from 'three'
import { RING_CHARS } from '../lib/glyphRing'
import { SEAL_INITIALS } from '../lib/letterReveal'

/** Every character in the atlas: the ring's first (so a ring glyph's index is its place in RING_CHARS), then the initials it lacks, then '?'. */
export const ATLAS_CHARS: string = [...new Set([...RING_CHARS, ...SEAL_INITIALS, '?'])].join('')

/** Cells to a row, and so rows: the smallest square that holds them all. */
export const ATLAS_COLS = Math.ceil(Math.sqrt([...ATLAS_CHARS].length))

/** A cell's side, pixels. */
export const ATLAS_CELL = 64

/** The atlas's side, pixels. */
export const ATLAS_SIDE = ATLAS_COLS * ATLAS_CELL

/** A character's cell in the atlas; '?' for one it does not hold. */
export function atlasIndex(ch: string): number {
  const chars = [...ATLAS_CHARS]
  const i = chars.indexOf(ch)
  return i >= 0 ? i : chars.indexOf('?')
}

let atlas: DataTexture | null = null

/**
 * Draw every glyph into `pixels` (RGBA, ATLAS_SIDE square), rows from the
 * bottom up: the texture's first row is its v = 0, so the canvas's top row,
 * where the first glyphs are, lands at v = 1 as the shaders expect. False
 * where there is no canvas to draw with.
 */
export function drawGlyphs(pixels: Uint8Array): boolean {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  const ctx = canvas?.getContext?.('2d') ?? null
  if (!canvas || !ctx) return false
  canvas.width = ATLAS_SIDE
  canvas.height = ATLAS_SIDE
  ctx.clearRect(0, 0, ATLAS_SIDE, ATLAS_SIDE)
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // The HUD's own monospace for letters, digits and blocks; the system's Japanese face for the katakana.
  ctx.font = `600 ${Math.round(ATLAS_CELL * 0.68)}px "Monaspace Krypton", ui-monospace, "Hiragino Sans", "Noto Sans JP", "Noto Sans CJK JP", "Yu Gothic", sans-serif`
  ;[...ATLAS_CHARS].forEach((ch, i) => {
    const x = (i % ATLAS_COLS) * ATLAS_CELL + ATLAS_CELL / 2
    const y = Math.floor(i / ATLAS_COLS) * ATLAS_CELL + ATLAS_CELL / 2
    ctx.fillText(ch, x, y + ATLAS_CELL * 0.03)
  })
  let image: ImageData
  try { image = ctx.getImageData(0, 0, ATLAS_SIDE, ATLAS_SIDE) } catch { return false }
  const row = ATLAS_SIDE * 4
  for (let y = 0; y < ATLAS_SIDE; y++) pixels.set(image.data.subarray(y * row, (y + 1) * row), (ATLAS_SIDE - 1 - y) * row)
  return true
}

/** The atlas, drawn on first use. */
export function glyphAtlas(): DataTexture {
  if (atlas) return atlas
  const pixels = new Uint8Array(ATLAS_SIDE * ATLAS_SIDE * 4)
  drawGlyphs(pixels)
  const tex = new DataTexture(pixels, ATLAS_SIDE, ATLAS_SIDE, RGBAFormat, UnsignedByteType)
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  atlas = tex
  // Drawn before the HUD's face had loaded, the atlas would keep a fallback for the visit: drawn again once the fonts are in.
  if (typeof document !== 'undefined') document.fonts?.ready?.then(() => refreshGlyphAtlas()).catch(() => undefined)
  return atlas
}

/**
 * Draw the atlas again and send it to the GPU again: on the page showing
 * again, on the WebGL context coming back, once the fonts are in. A glyph
 * that cannot be drawn now keeps what was drawn before.
 */
export function refreshGlyphAtlas(): void {
  if (!atlas) return
  const pixels = atlas.image.data as Uint8Array
  const next = new Uint8Array(pixels.length)
  if (drawGlyphs(next)) pixels.set(next)
  atlas.needsUpdate = true
}

/** Forget the atlas (tests). */
export function forgetGlyphAtlas(): void {
  atlas?.dispose()
  atlas = null
}
