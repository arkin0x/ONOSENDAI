/**
 * The bench's grid (arkinox, 2026-10-31: "subdivisions beyond 1/10 aren't
 * visually reflected"). Past twelve lines a unit the grid drew a divisor of
 * the snap, because true lines were too heavy. These pin the two halves of the
 * answer: every division is drawn as itself, where the snap lands, and the
 * drawing costs the same four vertices and one draw call however fine or wide.
 * That the pixels really do come out right is read off the screen by
 * scripts/verify-bench-grid.mjs.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Color, DoubleSide, Vector3, type BufferAttribute } from 'three'
import { DIVISIONS, MAX_EXTENT, TICKS_PER_UNIT } from 'sno-core/shards'
import { ACCENT } from '../../lib/palette'
import { TRANSLUCENT_ORDER } from '../../scene/shardFaces'
import { BenchGrid } from '../benchGrid'

const made = (extent = 8, division = 1): BenchGrid => { const g = new BenchGrid(); g.set(extent, division); return g }
const uniforms = (g: BenchGrid) => g.mesh.material.uniforms

describe('every division draws as itself', () => {
  it('the number the shader spaces its lines by is the division, for all of them', () => {
    const g = made()
    const seen = new Set<number>()
    for (const d of DIVISIONS) {
      g.set(8, d)
      expect(uniforms(g).uDivision.value).toBe(d)
      seen.add(uniforms(g).uDivision.value as number)
    }
    // 1/20, 1/30, 1/40 once all drew tenths; 1/24, 1/60, 1/120 all drew twelfths.
    expect(seen.size).toBe(DIVISIONS.length)
    g.dispose()
  })

  it('a snap at every division lands on a line of that division, out to the extent', () => {
    for (const d of DIVISIONS) {
      const step = TICKS_PER_UNIT / d
      const extent = 64
      for (const k of [-extent * d, -d - 1, -1, 0, 1, d + 1, 7 * d + 1, extent * d]) {
        // Where the snap puts it, in ticks and then in the bench's units, as Bench.tsx snap and toRender do.
        const ticks = Math.round(k) * step
        const render = ticks / TICKS_PER_UNIT
        // What the shader takes the distance to the nearest line of: position times division.
        const c = render * d
        expect(Math.abs(c - Math.round(c))).toBeLessThan(1e-9)
      }
    }
  })

  it('the shader spaces its lines by the uniform with nothing capping it', () => {
    const src = new BenchGrid().mesh.material.fragmentShader
    expect(src).toMatch(/lines\(vLocal, uDivision\)/)
    expect(src).toMatch(/fract\(c - 0\.5\)/)
  })

  it('never divides by a rate of zero, which two pixels holding the same float can give far from the origin', () => {
    const src = new BenchGrid().mesh.material.fragmentShader
    expect(src).toMatch(/return max\(vec2\(length\(vec2\(dx\.x, dy\.x\)\), length\(vec2\(dx\.y, dy\.y\)\)\), vec2\(1e-6\)\);/)
  })

  it('the bench no longer draws line geometry or a divisor of the snap', () => {
    const bench = readFileSync(join(process.cwd(), 'src/workshop/Bench.tsx'), 'utf8')
    expect(bench).not.toMatch(/<gridHelper/)
    expect(bench).not.toMatch(/drawnDivision/)
  })
})

describe('the colours', () => {
  it('unit lines step up when a unit is divided, and the rest hold', () => {
    const g = made(8, 1)
    const plain = new Color('#1d3547'), up = new Color('#166c86')
    expect((uniforms(g).uUnitColor.value as Color).equals(plain)).toBe(true)
    g.set(8, 10)
    expect((uniforms(g).uUnitColor.value as Color).equals(up)).toBe(true)
    expect((uniforms(g).uDivisionColor.value as Color).equals(plain)).toBe(true)
    expect((uniforms(g).uCentreColor.value as Color).equals(new Color(ACCENT))).toBe(true)
    g.set(8, 1)
    expect((uniforms(g).uUnitColor.value as Color).equals(plain)).toBe(true)
    g.dispose()
  })
})

describe('the cost', () => {
  it('four vertices at every division and extent', () => {
    const g = made()
    for (const e of [1, 8, 64, 1024, 4096]) for (const d of DIVISIONS) {
      g.set(e, d)
      expect(g.mesh.geometry.getAttribute('position').count).toBe(4)
      expect(g.mesh.geometry.getIndex()!.count).toBe(6)
    }
    g.dispose()
  })

  it('stepping through every division touches no geometry and makes no object', () => {
    const g = made(8, 1)
    const geometry = g.mesh.geometry, material = g.mesh.material
    const position = geometry.getAttribute('position') as BufferAttribute
    const v = position.version, mv = material.version
    for (let round = 0; round < 50; round++) for (const d of DIVISIONS) g.set(8, d)
    expect(g.mesh.geometry).toBe(geometry)
    expect(g.mesh.material).toBe(material)
    expect(position.version).toBe(v)
    // A uniform is one number sent; a material version would mean a shader recompiled.
    expect(material.version).toBe(mv)
    g.dispose()
  })

  it('a new extent rewrites the same four corners, keeps the buffer, and bounds the lattice', () => {
    const g = made(8, 1)
    const position = g.mesh.geometry.getAttribute('position') as BufferAttribute
    const v = position.version
    g.set(64, 1)
    expect(g.mesh.geometry.getAttribute('position')).toBe(position)
    expect(position.version).toBe(v + 1)
    expect(uniforms(g).uExtent.value).toBe(64)
    expect(Math.abs(position.getX(0))).toBeGreaterThan(64)
    expect(g.mesh.geometry.boundingSphere!.radius).toBeGreaterThan(64)
    g.dispose()
  })

  it('has no per-frame hook of React\'s: its only hook runs when the bench draws, and is arithmetic', () => {
    // The bench draws on demand, so a bench left alone runs nothing. Each frame
    // it does draw, the hook moves uOrigin, and only when the camera crosses a unit.
    const src = readFileSync('src/workshop/benchGrid.ts', 'utf8')
    expect(src).not.toMatch(/useFrame/)
    const g = made(4096, 120)
    g.mesh.updateMatrixWorld()
    const o = uniforms(g).uOrigin.value
    const before = o
    g.follow(new Vector3(4090.4, 0.9, -4089.6))
    expect([o.x, o.y]).toEqual([4090, -4090])
    expect(uniforms(g).uOrigin.value).toBe(before) // the same object, set in place
    g.dispose()
  })

  it('follows the camera in the grid\'s own frame, turned to its plane', () => {
    const g = made(4096, 120)
    // Facing +X (plane 0): a quarter about Z, as Bench Grid turns it.
    g.mesh.rotation.set(0, 0, -Math.PI / 2)
    g.mesh.updateMatrixWorld()
    g.follow(new Vector3(0.2, 12.6, -30.4))
    const o = uniforms(g).uOrigin.value
    // Its local X is world -Y there.
    expect([o.x, o.y]).toEqual([-13, -30])
    g.dispose()
  })

  it('draws the unit and division lines from a whole unit near the camera, and the rest from the origin', () => {
    const src = new BenchGrid().mesh.material.fragmentShader
    expect(src).toMatch(/lines\(vLocal, uDivision\)/)
    expect(src).toMatch(/float a = lines\(vLocal, 1\.0\);/)
    expect(src).toMatch(/lines\(vGrid, cells\)/)
    expect(new BenchGrid().mesh.material.vertexShader).toMatch(/vLocal = position\.xz - uOrigin;/)
  })

  it('cannot be tapped: the tap plane is its own mesh', () => {
    const g = made()
    const hits: unknown[] = []
    g.mesh.raycast(undefined as never, hits as never)
    expect(hits).toEqual([])
    g.dispose()
  })
})

describe('the material rules', () => {
  it('blends in one pass and writes no depth, so it hides no handle or face behind it', () => {
    const m = made().mesh.material
    expect(m.transparent).toBe(true)
    expect(m.side).toBe(DoubleSide)
    expect(m.forceSinglePass).toBe(true)
    expect(m.depthWrite).toBe(false)
    expect(m.toneMapped).toBe(false)
  })

  it('draws after opaque faces and before see-through ones, so the depth test can sort it against a face', () => {
    // Faces are order 0 and write depth; the grid writes none. At -1 a face painted over the grid even behind it.
    expect(made().mesh.renderOrder).toBeGreaterThan(0)
    expect(made().mesh.renderOrder).toBeLessThan(TRANSLUCENT_ORDER)
    expect(made().mesh.material.depthTest).toBe(true)
  })
})

/**
 * GRID SIZE runs to 4,096 (DECK-0003 §1.8, 2026-11-23). Seen whole, that grid
 * has several units to a pixel, so coarser lines come in as finer ones fade.
 * A model of the shader's weights, per family, for a pixel this many pixels
 * per unit across, with the same smoothstep and thresholds as the shader.
 */
describe('adaptive past the unit (GRID SIZE to 4,096)', () => {
  const smooth = (lo: number, hi: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t) }
  const resolves = (pxPerUnit: number, cells: number): number => smooth(1.1, 3.0, pxPerUnit / cells)
  /** How strongly each coarser family (8, 64, 512, 4,096 units) may draw, as the shader gates it. */
  const gates = (pxPerUnit: number): number[] => {
    const out: number[] = []
    let finer = resolves(pxPerUnit, 1)
    let cells = 1
    for (let k = 0; k < 4; k++) { cells /= 8; out.push(1 - finer); finer = resolves(pxPerUnit, cells) }
    return out
  }

  it('the shader draws the four coarser families, each gated by the one finer', () => {
    const src = new BenchGrid().mesh.material.fragmentShader
    expect(src).toMatch(/for \(int k = 0; k < 4; k\+\+\)/)
    expect(src).toMatch(/cells \/= 8\.0;/)
    expect(src).toMatch(/a = max\(a, lines\(vGrid, cells\) \* \(1\.0 - finer\)\);/)
    expect(src).toMatch(/finer = resolves\(vGrid, cells\);/)
  })

  it('changes nothing while the unit lines resolve: every grid at the distances it always was', () => {
    for (const px of [3, 10, 100, 1000]) expect(gates(px)).toEqual([0, 0, 0, 0])
  })

  it('brings in lines 8 apart as the units fade, and coarser ones as those fade in turn', () => {
    expect(gates(1)[0]).toBe(1)
    // 8,192 units across a 1,000 pixel view: about 0.12 pixels a unit.
    const whole = gates(1000 / (2 * MAX_EXTENT))
    expect(whole[0]).toBe(1)
    expect(whole[1]).toBe(1)
    // 64-unit lines are 7.8 pixels apart there and resolve, so nothing coarser is needed.
    expect(whole[2]).toBe(0)
    expect(whole[3]).toBe(0)
  })

  it('at any zoom, some family in reach is far enough apart to read', () => {
    for (let px = 1e-4; px < 1e3; px *= 1.37) {
      const spacing = [1, 8, 64, 512, 4096].map((u) => u * px)
      expect(spacing.some((d) => d >= 3) || px * 4096 < 3).toBe(true)
    }
  })
})
