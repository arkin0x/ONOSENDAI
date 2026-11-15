/**
 * The halos and the points at a POINT SIZE (scene/glowHalos.ts): one pass,
 * premultiplied blends that keep the bloom's tag in the world, billboards that
 * share the points' own arrays, an even spread at any budget share, and the
 * blend put back after TV's look rewrites it.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BufferAttribute, BufferGeometry, DoubleSide, OneFactor, OneMinusSrcAlphaFactor, SrcAlphaFactor, ZeroFactor } from 'three'
import { billboardsOf, createCoreMaterial, createHaloMaterial, flowHalos, haloBlend, haloFlow, haloSeeds, keepHaloBlend, syncBillboards } from '../glowHalos'
import { settledShare } from '../PointBillboards'

function points(n: number): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('color', new BufferAttribute(new Float32Array(n * 3), 3))
  return g
}

describe('materials', () => {
  it('draw in one pass, write no depth, test depth, and cut at clipping planes', () => {
    for (const m of [createHaloMaterial('light', true), createHaloMaterial('fog', false), createCoreMaterial(0.4, 1.1, 0.5, false)]) {
      expect(m.side).toBe(DoubleSide)
      expect(m.transparent).toBe(true)
      expect(m.forceSinglePass).toBe(true)
      expect(m.depthWrite).toBe(false)
      expect(m.depthTest).toBe(true)
      expect(m.clipping).toBe(true)
      expect(m.vertexShader).toContain('#include <clipping_planes_vertex>')
      expect(m.fragmentShader).toContain('#include <clipping_planes_fragment>')
    }
  })
  it('opaque points at a POINT SIZE write depth with a hard rim, so large ones cover each other nearest first', () => {
    const m = createCoreMaterial(2, 1.1, 1, false)
    expect(m.depthWrite).toBe(true)
    expect(m.uniforms.uHard.value).toBe(1)
    expect(createCoreMaterial(2, 1.1, 0.5, false).uniforms.uHard.value).toBe(0)
  })
  it('billboards measure as their points, not as the square at the origin', () => {
    const g = points(2)
    ;(g.getAttribute('position').array as Float32Array).set([10, 10, 10, 12, 10, 10])
    const b = billboardsOf(g)
    expect(b.boundingBox!.min.x).toBe(10)
    expect(b.boundingBox!.max.x).toBe(12)
  })
  it('the halo is named for GLOW STRENGTH, never glow opacity', () => {
    const m = createHaloMaterial('fog', true)
    expect(m.uniforms.uStrength).toBeDefined()
    const src = readFileSync('src/scene/glowHalos.ts', 'utf8') + readFileSync('src/scene/PointBillboards.tsx', 'utf8') + readFileSync('src/lib/pointLook.ts', 'utf8')
    expect(src.toLowerCase()).not.toMatch(/glow ?opacity|glowopacity/)
  })
})

describe('blending', () => {
  it('LIGHT adds, FOG lays over, both premultiplied', () => {
    expect(haloBlend('light', true)).toMatchObject({ blendSrc: OneFactor, blendDst: OneFactor })
    expect(haloBlend('fog', true)).toMatchObject({ blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor })
  })
  it('in the world the alpha under a halo (the bloom\'s tag) is kept; elsewhere it accumulates', () => {
    for (const style of ['light', 'fog'] as const) {
      expect(haloBlend(style, true)).toMatchObject({ blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor })
      expect(haloBlend(style, false)).toMatchObject({ blendSrcAlpha: OneFactor, blendDstAlpha: OneMinusSrcAlphaFactor })
    }
  })
  it('a blend rewritten by TV\'s look is put back before the draw', () => {
    const m = createHaloMaterial('fog', true)
    Object.assign(m, { blendSrc: SrcAlphaFactor, blendSrcAlpha: ZeroFactor })
    keepHaloBlend(m)
    expect(m.blendSrc).toBe(OneFactor)
  })
})

describe('billboards', () => {
  it('share the points\' arrays, made once and let go with them', () => {
    const g = points(5)
    const b = billboardsOf(g)
    expect(billboardsOf(g)).toBe(b)
    expect(b.getAttribute('aOffset').array).toBe(g.getAttribute('position').array)
    expect(b.getAttribute('aColor').array).toBe(g.getAttribute('color').array)
    expect(b.instanceCount).toBe(5)
    let gone = false
    b.addEventListener('dispose', () => { gone = true })
    g.dispose()
    expect(gone).toBe(true)
    expect(billboardsOf(g)).not.toBe(b)
  })
  it('upload again after a decode or a paint changes the points', () => {
    const g = points(2)
    const b = billboardsOf(g)
    const before = (b.getAttribute('aColor') as BufferAttribute).version
    syncBillboards(b)
    expect((b.getAttribute('aColor') as BufferAttribute).version).toBe(before)
    ;(g.getAttribute('color') as BufferAttribute).needsUpdate = true
    syncBillboards(b)
    expect((b.getAttribute('aColor') as BufferAttribute).version).toBe(before + 1)
  })
  it('seeds spread evenly: any first share of them by seed is close to that share', () => {
    const s = haloSeeds(1000)
    for (const share of [0.1, 0.25, 0.5, 0.9]) {
      const firstHalf = Array.from(s.slice(0, 500)).filter((x) => x < share).length
      expect(Math.abs(firstHalf / 500 - share)).toBeLessThan(0.02)
    }
  })
})

describe('drift and decode', () => {
  it('the drift stays inside 0..1, however long the page is open', () => {
    flowHalos(1e7 + 0.5)
    for (const v of [haloFlow.a.value, haloFlow.b.value]) {
      expect(v.x).toBeGreaterThanOrEqual(0)
      expect(v.x).toBeLessThan(1)
    }
  })
  it('halos come in with a decode and go with a dissolve', () => {
    expect(settledShare(1000, undefined, undefined)).toBe(1)
    expect(settledShare(1000, 1000, undefined)).toBe(0)
    expect(settledShare(10_000, 1000, undefined)).toBe(1)
    expect(settledShare(1000, undefined, 1000)).toBe(1)
    expect(settledShare(100_000, undefined, 1000)).toBe(0)
  })
})
