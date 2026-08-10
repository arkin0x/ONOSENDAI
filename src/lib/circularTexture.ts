/**
 * circularTexture.ts — generates a radial gradient texture for point sprites.
 *
 * Creates a soft circular gradient that fades from opaque center to transparent
 * edge. Used by the shader to render smooth Gibson points without hard edges.
 */

import { DataTexture, RGBAFormat, FloatType, NearestFilter } from 'three'

/**
 * Generate a circular gradient texture.
 *
 * @param size - Texture dimensions (size × size pixels)
 * @returns DataTexture with radial gradient from center (1.0) to edge (0.0)
 */
export function createCircularTexture(size = 64): DataTexture {
  const data = new Float32Array(size * size * 4)
  const center = size / 2
  const radius = size / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center
      const dy = y - center
      const dist = Math.sqrt(dx * dx + dy * dy)
      const normalized = Math.min(1, dist / radius)
      
      // Smooth falloff: 1.0 at center, 0.0 at edge
      const alpha = 1 - normalized
      
      // Apply a smoothstep for softer edges
      const smoothAlpha = alpha * alpha * (3 - 2 * alpha)
      
      const i = (y * size + x) * 4
      data[i]     = 1.0  // R
      data[i + 1] = 1.0  // G
      data[i + 2] = 1.0  // B
      data[i + 3] = smoothAlpha  // A
    }
  }

  const texture = new DataTexture(data, size, size, RGBAFormat, FloatType)
  texture.needsUpdate = true
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  
  return texture
}
