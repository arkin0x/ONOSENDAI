/**
 * blockShadingLook.test.ts - how dark Block shading lets a sealed space get,
 * and the targeted block's outline (owner, 2026-11-26: "if we're totally
 * enclosed, it should be much darker", and the outline "is not occluded and
 * it ruins my depth perception").
 */

import { describe, expect, it } from 'vitest'
import { OneFactor, ZeroFactor } from 'three'
import { makeOutlineMaterial, OUTLINE_PULL } from '../TerrainLayer'
import { AO_DARK, EYE_GLIMMER, EYE_LAMP, LIGHT_FLOOR, makeTerrainMaterial } from '../../terrain/terrainMaterial'

/** What a sealed, unlit wall gets at a distance (the shader's floor and eye lamp; the light texture reads 0 there). */
const sealed = (eye: { light: number; reach: number }, blocks: number): number => {
  const near = Math.max(0, 1 - blocks / eye.reach)
  return Math.max(LIGHT_FLOOR, eye.light * near * near)
}

describe('a space sealed off from the open', () => {
  it('is very dark: a faint read of the walls, never more than a tenth of full light 3 blocks off with Headlamp on', () => {
    expect(LIGHT_FLOOR).toBeLessThanOrEqual(0.03)
    expect(sealed(EYE_LAMP, 3)).toBeLessThan(0.1)
    expect(sealed(EYE_LAMP, 8)).toBe(LIGHT_FLOOR)
  })

  it('is darker still with Headlamp off: only a glimmer at arm\'s length', () => {
    expect(EYE_GLIMMER.light).toBeLessThan(EYE_LAMP.light / 3)
    expect(sealed(EYE_GLIMMER, 2)).toBeLessThan(0.01 + LIGHT_FLOOR)
    // A closed corner darkens further still.
    expect(sealed(EYE_GLIMMER, 2) * AO_DARK).toBeLessThan(LIGHT_FLOOR)
  })

  it('follows the Headlamp switch in the material', () => {
    const m = makeTerrainMaterial()
    m.setView(1, true, true, true)
    expect(m.material.uniforms.eyeLight.value).toBe(EYE_LAMP.light)
    m.setView(1, true, true, false)
    expect(m.material.uniforms.eyeLight.value).toBe(EYE_GLIMMER.light)
    expect(m.material.uniforms.eyeReach.value).toBe(EYE_GLIMMER.reach)
    // Every chunk's material shares the same uniforms.
    const tex = { dispose: () => {} } as never
    expect(m.forChunk(tex).material.uniforms.eyeLight).toBe(m.material.uniforms.eyeLight)
    m.dispose()
  })
})

describe('the targeted block\'s outline', () => {
  it('is depth tested, so the blocks round it hide what is behind them, and never writes depth or blooms', () => {
    const m = makeOutlineMaterial('#ffffff')
    expect(m.depthTest).toBe(true)
    expect(m.depthWrite).toBe(false)
    // The bloom's tag: alpha left as it was (NO_BLOOM_BLEND).
    expect(m.blendSrcAlpha).toBe(ZeroFactor)
    expect(m.blendDstAlpha).toBe(OneFactor)
  })

  it('is drawn a hair toward the eye, so its edges do not fight its own block\'s faces', () => {
    const m = makeOutlineMaterial('#ffffff')
    const shader = { vertexShader: 'void main() {\n#include <project_vertex>\n}', fragmentShader: '', uniforms: {} }
    m.onBeforeCompile(shader as never, null as never)
    expect(shader.vertexShader).toContain(`1.0 - ${OUTLINE_PULL.toFixed(3)} / max(length(mvPosition.xyz)`)
    expect(OUTLINE_PULL).toBeGreaterThan(0)
    expect(OUTLINE_PULL).toBeLessThan(0.1)
  })
})
