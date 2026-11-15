/**
 * lessDarkness.test.ts - the scene's darkening cut to about a tenth (arkinox,
 * 2026-11-15, of a Landscape Kit plains tile at 2^0: "we need to reduce the
 * darkness by a lot. maybe 10% of this.").
 *
 * Three things darkened a world face: the headlamp's facing (FACE_FLOOR), its
 * distance (DISTANCE_FLOOR), and the black fog (fog.ts). The
 * lights, tone mapping and bloom never touch a world face (unlit, not tone
 * mapped, read as dark by the bloom). A shard's vertex dots never fogged at
 * all, so far off they were all that showed; they take the fog now.
 *
 * Nearer than where the fog begins the darkening is about a tenth of the old
 * (a little more for ground seen near edge on, which keeps a little shade for
 * its shapes). The fog keeps the old one's long fade (it was a thin band at
 * the draw edge for a while, #769, and the owner liked the old one better)
 * but begins twice as far off and ends half as far again.
 */

import { describe, expect, it } from 'vitest'
import { DISTANCE_FLOOR, FACE_FLOOR, HEADLAMP_DISTANCE_GLSL, distanceShare, facingShare, patchHeadlamp } from '../headlamp'
import { FOG_FAR, FOG_NEAR, fogFar, fogNear } from '../fog'
import { ShaderLib } from 'three'
import { SHARD_DOTS, createDiscMaterial } from '../pointDisc'

/** three's linear fog factor: 0 before `near`, 1 at `far`. */
const fogFactor = (d: number, near: number, far: number): number => Math.min(1, Math.max(0, (d - near) / (far - near)))

/** What share of its colour a world face keeps, as the shaders take it. */
function kept(d: number, nz: number, reach: number, near: number, far: number, face = facingShare(nz), dist = distanceShare(d, reach)): number {
  return face * dist * (1 - fogFactor(d, near, far))
}

/** As the scene shades it now, for a third-person camera 26 cells from its target (the usual orbit). */
const keptNow = (d: number, nz: number): number => kept(d, nz, 26, fogNear(false, 26), fogFar(false, 26))

/** The old shading, as it stood before 2026-11-15, for the comparison. */
function keptBefore(d: number, nz: number, reach: number, far = 166): number {
  const face = 0.4 + 0.6 * Math.min(1, Math.abs(nz))
  const past = Math.max(0, d - reach * 0.75) / (reach * 1.6)
  const dist = 0.3 + 0.7 * Math.exp(-past)
  return kept(d, nz, reach, far * 0.225, far, face, dist)
}

/** The mean share of colour lost from `from` to `to` cells. */
function meanLoss(f: (d: number) => number, from: number, to: number): number {
  let sum = 0
  let n = 0
  for (let d = from; d <= to; d += 0.5) { sum += 1 - f(d); n++ }
  return sum / n
}

describe('the darkening, cut to about a tenth', () => {
  it('has the new values: faces keep 0.9 edge on, far things 0.93; TV\'s and WALK\'s fog fades from 48 to 96', () => {
    expect(FACE_FLOOR).toBe(0.9)
    expect(DISTANCE_FLOOR).toBe(0.93)
    expect(FOG_NEAR).toBe(48)
    expect(FOG_FAR).toBe(96)
    expect(facingShare(0)).toBe(0.9)
    expect(distanceShare(1e6, 26)).toBeCloseTo(0.93, 6)
  })

  it('bakes the new floors into the shaders the world compiles', () => {
    expect(HEADLAMP_DISTANCE_GLSL).toContain('return 0.9300 + 0.0700 * exp(-past);')
    const shader = { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader, uniforms: {} }
    expect(patchHeadlamp(shader, true)).toBe(true)
    expect(shader.fragmentShader).toContain('return 0.9000 + 0.1000 * min(nz, 1.0);')
  })

  it('loses about a tenth of what it lost nearer than where the fog begins, and much less out to the old fog\'s end', () => {
    // The usual orbit: 26 cells out, the fog from 79 to 251 (it was 37.4 to 166).
    const near = fogNear(false, 26)
    expect([near, fogFar(false, 26)]).toEqual([79, 251])
    const ratio = (nz: number, to: number): number => meanLoss((d) => keptNow(d, nz), 5, to) / meanLoss((d) => keptBefore(d, nz, 26), 5, to)
    // Facing the camera, a tenth or less; ground near edge on (nz 0.3) keeps a little more, for its shapes.
    expect(ratio(1, near)).toBeLessThan(0.1)
    expect(ratio(0.6, near)).toBeLessThan(0.14)
    expect(ratio(0.3, near)).toBeLessThan(0.2)
    // Out to where the old fog was black, the long fade takes about a third of what the old took.
    for (const nz of [0.3, 0.6, 1]) expect(ratio(nz, 166), `nz ${nz}`).toBeLessThan(0.4)
  })

  it('keeps a tile 100 cells off coloured: most of its colour, where it kept a fifth or less', () => {
    expect(keptBefore(100, 0.3, 26)).toBeLessThan(0.15)
    expect(keptBefore(100, 1, 26)).toBeLessThan(0.25)
    expect(keptNow(100, 0.3)).toBeGreaterThan(0.7)
    expect(keptNow(100, 1)).toBeGreaterThan(0.8)
    // And one 166 off, where the old fog was black, about half.
    expect(keptBefore(166, 1, 26)).toBe(0)
    expect(keptNow(166, 1)).toBeGreaterThan(0.4)
  })

  it('fades to black gently over a long way, not at a thin band at the edge', () => {
    for (const d of [2, 26, 60, 96, 400, 1280]) {
      const near = fogNear(false, d)
      const far = fogFar(false, d)
      expect(kept(far, 1, d, near, far)).toBe(0)
      // The fade is longer than the clear range before it is shorter than it: at least 2.3 times its start.
      expect(far / near).toBeGreaterThanOrEqual(2.3)
      // Half way through it, about half the colour.
      const mid = kept((near + far) / 2, 1, d, near, far)
      expect(mid).toBeGreaterThan(0.4)
      expect(mid).toBeLessThan(0.55)
    }
    // TV's and WALK's own end.
    expect(kept(96, 1, 8, fogNear(true, 0), fogFar(true, 0))).toBe(0)
    expect(fogFar(true, 0) / fogNear(true, 0)).toBe(2)
  })

  it('fogs a shard\'s vertex dots with its faces, so far off they no longer show alone or pop at the cull line', () => {
    for (const headlamp of [true, false]) {
      const m = createDiscMaterial(SHARD_DOTS, 1, headlamp)
      expect(m.fog).toBe(true)
      for (const u of ['fogColor', 'fogNear', 'fogFar']) expect(m.uniforms[u], u).toBeDefined()
      expect(m.vertexShader).toContain('#include <fog_pars_vertex>')
      expect(m.vertexShader).toContain('#include <fog_vertex>')
      // fog_vertex reads mvPosition: radialFog's straight-line distance.
      expect(m.vertexShader.indexOf('vec4 mvPosition = mv;')).toBeLessThan(m.vertexShader.indexOf('#include <fog_vertex>'))
      expect(m.fragmentShader).toContain('#include <fog_pars_fragment>')
      // After the colour is final, as three's own materials do it.
      expect(m.fragmentShader.indexOf('#include <fog_fragment>')).toBeGreaterThan(m.fragmentShader.indexOf('gl_FragColor = vec4(color, alpha);'))
      m.dispose()
    }
    // Each material its own fog uniforms (three writes them in place).
    const a = createDiscMaterial(SHARD_DOTS, 1, true)
    const b = createDiscMaterial(SHARD_DOTS, 1, true)
    expect(a.uniforms.fogNear).not.toBe(b.uniforms.fogNear)
    a.dispose()
    b.dispose()
  })

  it('still shades two faces of one colour at different angles apart, a little', () => {
    expect(facingShare(1) - facingShare(0)).toBeCloseTo(0.1, 9)
    expect(facingShare(0.5)).toBeLessThan(facingShare(1))
  })
})
