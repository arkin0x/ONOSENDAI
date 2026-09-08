/**
 * glow.ts - one soft round sprite for points that should read as light.
 *
 * A radial falloff from a white core to nothing, drawn once on a small canvas
 * and shared by every points material and halo sprite that asks. Tinted by
 * the material's colour, blended additively, it turns a square point into a
 * small glow. Null where there is no document (tests, workers), and callers
 * draw plain points then.
 */

import { CanvasTexture, SRGBColorSpace, type Texture } from 'three'

let cached: Texture | null | undefined

export function glowTexture(): Texture | null {
  if (cached !== undefined) return cached
  if (typeof document === 'undefined') return (cached = null)
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return (cached = null)
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.18, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.45, 'rgba(255,255,255,0.28)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  return (cached = tex)
}
