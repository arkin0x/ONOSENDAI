/**
 * glyphAtlas.ts: one texture holding every glyph the hidden-message letters
 * draw in the world: decode.ts's GLYPHS for the rings that orbit them, and
 * the letters and digits a seal's initial may be (lib/letterReveal
 * SEAL_INITIALS). Drawn once on a canvas and shared by every letter, so a
 * hall of rings is one texture and one draw (scene/LetterField.tsx).
 *
 * A cell is ATLAS_CELL pixels square, ATLAS_COLS to a row, each glyph white
 * on transparent and centred in its cell; a shader picks a cell by its index
 * (atlasIndex). Where there is no canvas (tests, a worker) the texture is a
 * blank one of the same size, so everything still mounts.
 */

import { CanvasTexture, DataTexture, LinearFilter, RGBAFormat, type Texture } from 'three'
import { GLYPHS } from '../lib/decode'
import { SEAL_INITIALS } from '../lib/letterReveal'

/** Every character in the atlas, GLYPHS first (so a ring glyph's index is its index in GLYPHS), then the initials it lacks, then '?'. */
export const ATLAS_CHARS: string = [...new Set([...GLYPHS, ...SEAL_INITIALS, '?'])].join('')

/** Cells to a row, and so rows: the smallest square that holds them all. */
export const ATLAS_COLS = Math.ceil(Math.sqrt([...ATLAS_CHARS].length))

/** A cell's side, pixels. */
export const ATLAS_CELL = 64

/** A character's cell in the atlas; '?' for one it does not hold. */
export function atlasIndex(ch: string): number {
  const chars = [...ATLAS_CHARS]
  const i = chars.indexOf(ch)
  return i >= 0 ? i : chars.indexOf('?')
}

let atlas: Texture | null = null

/** The atlas, drawn on first use. */
export function glyphAtlas(): Texture {
  if (atlas) return atlas
  const side = ATLAS_COLS * ATLAS_CELL
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  const ctx = canvas?.getContext?.('2d') ?? null
  if (!canvas || !ctx) {
    atlas = new DataTexture(new Uint8Array(4 * 4), 2, 2, RGBAFormat)
    atlas.needsUpdate = true
    return atlas
  }
  canvas.width = side
  canvas.height = side
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // The HUD's own monospace for Latin and hex; the system's Japanese face for the katakana.
  const draw = (): void => {
    ctx.clearRect(0, 0, side, side)
    ctx.font = `600 ${Math.round(ATLAS_CELL * 0.68)}px "Monaspace Krypton", ui-monospace, "Hiragino Sans", "Noto Sans JP", "Noto Sans CJK JP", "Yu Gothic", sans-serif`
    ;[...ATLAS_CHARS].forEach((ch, i) => {
      const x = (i % ATLAS_COLS) * ATLAS_CELL + ATLAS_CELL / 2
      const y = Math.floor(i / ATLAS_COLS) * ATLAS_CELL + ATLAS_CELL / 2
      ctx.fillText(ch, x, y + ATLAS_CELL * 0.03)
    })
  }
  draw()
  const tex = new CanvasTexture(canvas)
  // Drawn before the HUD's face had loaded, the atlas would keep a fallback for the visit: drawn again once the fonts are in.
  document.fonts?.ready?.then(() => { draw(); tex.needsUpdate = true }).catch(() => undefined)
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  atlas = tex
  return atlas
}
