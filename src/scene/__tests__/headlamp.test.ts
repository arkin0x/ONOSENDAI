import { describe, expect, it } from 'vitest'
import { ShaderLib } from 'three'
import {
  DISTANCE_FLOOR,
  FACE_FLOOR,
  HEADLAMP_FACES,
  HEADLAMP_LINES,
  HEADLAMP_NEVER,
  NEAR_SHARE,
  REACH_MAX,
  REACH_MIN,
  distanceShare,
  facingShare,
  headlampReach,
  headlampUniforms,
  patchHeadlamp,
} from '../headlamp'
import { SHARD_DOTS, createDiscMaterial } from '../pointDisc'

// The world's headlamp (arkinox, 2026-10-23): faces shaded by how squarely
// they face the view and how far off they are, through one patch of three's
// basic shader and two uniforms every material shares.

/** three's own `basic` shader, which MeshBasicMaterial and LineBasicMaterial both compile. */
function basic(): { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> } {
  return { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader, uniforms: {} }
}

const count = (s: string, sub: string): number => s.split(sub).length - 1

describe('the headlamp patch', () => {
  it('applies to three\'s basic shader, once, however often it is asked', () => {
    const s = basic()
    expect(patchHeadlamp(s, true)).toBe(true)
    const once = { v: s.vertexShader, f: s.fragmentShader }
    expect(count(s.vertexShader, 'vHeadlamp = mvPosition.xyz;')).toBe(1)
    expect(count(s.fragmentShader, 'gl_FragColor.rgb *=')).toBe(1)
    expect(patchHeadlamp(s, true)).toBe(true)
    expect(s.vertexShader).toBe(once.v)
    expect(s.fragmentShader).toBe(once.f)
  })

  it('scales the colour after three has it and before the fog, only while on', () => {
    const s = basic()
    patchHeadlamp(s, true)
    const at = s.fragmentShader.indexOf('gl_FragColor.rgb *=')
    expect(at).toBeGreaterThan(s.fragmentShader.indexOf('#include <opaque_fragment>'))
    expect(at).toBeLessThan(s.fragmentShader.indexOf('#include <fog_fragment>'))
    // Off is a skipped multiply, so the picture is exactly the unlit one.
    expect(s.fragmentShader).toContain('if (uHeadlamp > 0.5) gl_FragColor.rgb *= headlampFacing(vHeadlamp) * headlampDistance(length(vHeadlamp));')
  })

  it('shades lines by distance only: a line has no face to turn', () => {
    const s = basic()
    patchHeadlamp(s, false)
    expect(s.fragmentShader).toContain('if (uHeadlamp > 0.5) gl_FragColor.rgb *= headlampDistance(length(vHeadlamp));')
    expect(s.fragmentShader).not.toContain('headlampFacing')
    expect(s.fragmentShader).not.toContain('dFdx')
  })

  it('hands every material the same two uniform objects, so one write reaches all', () => {
    const a = basic()
    const b = basic()
    patchHeadlamp(a, true)
    patchHeadlamp(b, false)
    expect(a.uniforms.uHeadlamp).toBe(headlampUniforms.uHeadlamp)
    expect(a.uniforms.uHeadlampReach).toBe(headlampUniforms.uHeadlampReach)
    expect(b.uniforms.uHeadlamp).toBe(a.uniforms.uHeadlamp)
    expect(b.uniforms.uHeadlampReach).toBe(a.uniforms.uHeadlampReach)
  })

  it('leaves a shader it does not recognise as it was', () => {
    const s = { vertexShader: 'void main() {}', fragmentShader: 'void main() {}', uniforms: {} as Record<string, { value: unknown }> }
    const warn = console.warn
    console.warn = () => {}
    try { expect(patchHeadlamp(s, true)).toBe(false) } finally { console.warn = warn }
    expect(s.fragmentShader).toBe('void main() {}')
    expect(s.uniforms).toEqual({})
  })

  it('gives every face one program key and every line another, constant, not the hook\'s source', () => {
    expect(HEADLAMP_FACES.customProgramCacheKey()).toBe(HEADLAMP_FACES.customProgramCacheKey())
    expect(HEADLAMP_LINES.customProgramCacheKey()).not.toBe(HEADLAMP_FACES.customProgramCacheKey())
    expect(HEADLAMP_FACES.customProgramCacheKey()).not.toContain('patchHeadlamp')
  })
})

describe('the point discs', () => {
  it('dim with distance in the world, through the shared uniforms, and never elsewhere, from one source', () => {
    const world = createDiscMaterial(SHARD_DOTS, 1, true)
    const bench = createDiscMaterial(SHARD_DOTS, 1)
    expect(world.uniforms.uHeadlamp).toBe(headlampUniforms.uHeadlamp)
    expect(world.uniforms.uHeadlampReach).toBe(headlampUniforms.uHeadlampReach)
    expect(bench.uniforms.uHeadlamp).toBe(HEADLAMP_NEVER)
    expect(HEADLAMP_NEVER.value).toBe(0)
    // One program for both: the same source, the difference is a uniform.
    expect(world.vertexShader).toBe(bench.vertexShader)
    expect(world.fragmentShader).toBe(bench.fragmentShader)
    expect(world.fragmentShader).toContain('if (uHeadlamp > 0.5) color *= headlampDistance(vHeadlampDistance);')
    world.dispose()
    bench.dispose()
  })
})

describe('the shading', () => {
  it('shows a face square to the view at its full colour, from either side, and never black edge on', () => {
    expect(facingShare(1)).toBe(1)
    expect(facingShare(-1)).toBe(1)
    expect(facingShare(0)).toBe(FACE_FLOOR)
    expect(FACE_FLOOR).toBeGreaterThan(0.2)
    for (const nz of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      expect(facingShare(nz)).toBe(facingShare(-nz))
      expect(facingShare(nz)).toBeGreaterThan(facingShare(nz - 0.1))
    }
  })

  it('keeps near things at full colour and dims far ones gradually, never past the floor', () => {
    for (const reach of [REACH_MIN, 26, REACH_MAX]) {
      expect(distanceShare(0, reach)).toBe(1)
      expect(distanceShare(reach * NEAR_SHARE, reach)).toBe(1)
      // What the camera looks at is still most of its colour.
      expect(distanceShare(reach, reach)).toBeGreaterThan(0.85)
      let last = 1
      for (let d = reach; d < reach * 20; d += reach / 4) {
        const s = distanceShare(d, reach)
        expect(s).toBeLessThan(last)
        expect(s).toBeGreaterThan(DISTANCE_FLOOR)
        last = s
      }
    }
  })

  it('scales with the reach, so a dolly or a zoom keeps the same falloff', () => {
    for (const k of [0.5, 1, 1.5, 3, 6]) expect(distanceShare(k * 20, 20)).toBeCloseTo(distanceShare(k * 40, 40), 12)
  })

  it('takes the reach from the camera\'s distance, held between its limits', () => {
    expect(headlampReach(26)).toBe(26)
    expect(headlampReach(0.001)).toBe(REACH_MIN)
    expect(headlampReach(1e9)).toBe(REACH_MAX)
    expect(headlampReach(Number.NaN)).toBe(REACH_MIN)
  })
})
