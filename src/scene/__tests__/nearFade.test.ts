/**
 * nearFade.test.ts: what fades out as the camera comes right up to it
 * (scene/nearFade.ts, owner 2026-11-13). The ramp is 0 inside `from`, whole
 * from `to`, smooth between, and the shader is patched once, onto three's own
 * basic (lines) and standard (the spawn marker) shaders, with the headlamp's
 * patch alongside on a world line. At normal distances nothing changes.
 */
import { describe, expect, it } from 'vitest'
import { ShaderLib } from 'three'
import { HEADLAMP_LINES } from '../headlamp'
import { ORBIT_MIN_DISTANCE } from '../camera'
import { LINE_FADE_FROM, LINE_FADE_TO, MARKER_FADE_FROM_RADII, MARKER_FADE_TO_RADII, NEAR_FADE_LINES, lineFade, nearFadeShare, patchNearFade } from '../nearFade'

const shaderOf = (lib: 'basic' | 'standard') => ({ vertexShader: ShaderLib[lib].vertexShader, fragmentShader: ShaderLib[lib].fragmentShader, uniforms: {} as Record<string, { value: unknown }> })

describe('the ramp', () => {
  it('lines: nothing within half a cell, whole from the closest orbit (2 cells), smooth and rising between', () => {
    expect(LINE_FADE_FROM).toBe(0.5)
    expect(LINE_FADE_TO).toBe(ORBIT_MIN_DISTANCE)
    expect(nearFadeShare(0.2, LINE_FADE_FROM, LINE_FADE_TO)).toBe(0)
    expect(nearFadeShare(0.5, LINE_FADE_FROM, LINE_FADE_TO)).toBe(0)
    expect(nearFadeShare(1.25, LINE_FADE_FROM, LINE_FADE_TO)).toBeCloseTo(0.5, 6)
    expect(nearFadeShare(2, LINE_FADE_FROM, LINE_FADE_TO)).toBe(1)
    let last = 0
    for (let d = 0.5; d <= 2; d += 0.05) { const f = nearFadeShare(d, LINE_FADE_FROM, LINE_FADE_TO); expect(f).toBeGreaterThanOrEqual(last); last = f }
  })

  it('normal distances are untouched: the closest orbit and a stopped VIEW (2 cells), the close-up (about 6), the orbit and out', () => {
    for (const d of [ORBIT_MIN_DISTANCE, 3, 6, 8, 26, 1000]) expect(nearFadeShare(d, LINE_FADE_FROM, LINE_FADE_TO)).toBe(1)
  })

  it('the spawn marker at 2^0 (ring radius 3 cells): gone within 3 cells, faint at the 4 cells the bars stood at, whole from 9', () => {
    const r = 3
    const [from, to] = [MARKER_FADE_FROM_RADII * r, MARKER_FADE_TO_RADII * r]
    expect(nearFadeShare(2.4, from, to)).toBe(0)
    expect(nearFadeShare(4, from, to)).toBeLessThan(0.1)
    expect(nearFadeShare(5, from, to)).toBeLessThan(0.3)
    expect(nearFadeShare(9, from, to)).toBe(1)
    expect(nearFadeShare(26, from, to)).toBe(1)
  })
})

describe('the shader', () => {
  it('patches three\'s basic and standard shaders once, alpha only, behind a gate, reading the range given', () => {
    for (const lib of ['basic', 'standard'] as const) {
      const s = shaderOf(lib)
      const range = { value: { x: 1, y: 3 } } as unknown as Parameters<typeof patchNearFade>[1]
      expect(patchNearFade(s, range)).toBe(true)
      expect(s.uniforms.uNearFade).toBe(range)
      expect(s.vertexShader).toContain('vNearFade = mvPosition.xyz;')
      expect(s.fragmentShader).toContain('gl_FragColor.a *= smoothstep(uNearFade.x, uNearFade.y, length(vNearFade));')
      expect(s.fragmentShader).toContain('if (uNearFadeOn > 0.5)')
      const once = s.fragmentShader
      expect(patchNearFade(s, range)).toBe(true)
      expect(s.fragmentShader).toBe(once)
    }
  })

  it('a world line wears the headlamp and the fade together, on the shared line range and gate; the rooms wear the fade', () => {
    const s = shaderOf('basic')
    HEADLAMP_LINES.onBeforeCompile(s as never)
    expect(s.fragmentShader).toContain('headlampDistance')
    expect(s.fragmentShader).toContain('length(vNearFade)')
    expect(s.uniforms.uNearFade).toBe(lineFade.range)
    expect(s.uniforms.uNearFadeOn).toBe(lineFade.on)
    expect(HEADLAMP_LINES.customProgramCacheKey()).not.toBe(NEAR_FADE_LINES.customProgramCacheKey())
    const r = shaderOf('basic')
    NEAR_FADE_LINES.onBeforeCompile(r as never)
    expect(r.uniforms.uNearFade).toBe(lineFade.range)
  })

  it('leaves a shader it does not know as it was', () => {
    const s = { vertexShader: 'void main() {}', fragmentShader: 'void main() {}', uniforms: {} }
    expect(patchNearFade(s, lineFade.range)).toBe(false)
    expect(s.fragmentShader).toBe('void main() {}')
  })
})
