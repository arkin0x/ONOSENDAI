/**
 * heldLight.test.ts - a glowing block in hand lights where you are (owner,
 * 2026-11-27: "if i select a glowing block in my inventory i want that
 * block's glow effect to surround my avatar and provide light where i am so
 * i can see"): which blocks are lights, the light on and off as the slot
 * changes, the light following the eye's cell, the same light a placed
 * block gives, worked out only from the chunks round you and only when the
 * cell changes, how it meets the Headlamp, and the glow on screen with
 * reduced motion.
 */

import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { CELLS, idx } from '../terrain/coords'
import { aroundIndex, BRIGHT_BLOCK, brightness, computeLight, EMIT, lightAt, lightTables, type Around } from '../terrain/light'
import { computeHeldLight, fillHeldPass, glowingKinds, heldAt, heldChunks, heldCorner, heldGlow, heldGlowLook, heldLightSource, heldShine, HELD_BYTES, HELD_REACH, HELD_SIDE } from '../terrain/heldLight'
import { COMPILER_ID } from '../terrain/terrainDb'
import { EYE_LAMP, LIGHT_FLOOR, makeTerrainMaterial } from '../../terrain/terrainMaterial'
import { EYE_SLACK, HeldLightDriver, eyeCell } from '../../scene/heldLight'

const STONE = 1
const CINDERROCK = 7
const GLOWCORE = 42
const MAGMAFLOW = 12
const PRISMITE = 8
const tables = lightTables()

const inv = (hotbar: number[], slot: number, counts: Record<number, number>) => ({ hotbar, slot, counts })

describe('which blocks light your way', () => {
  it('is every block that glows, at its own level and colour, Glowcore cyan at the full 15', () => {
    const all = glowingKinds()
    expect(all.map((g) => g.name).sort()).toEqual(Object.keys(EMIT).sort())
    const glowcore = heldGlow(GLOWCORE)!
    expect(glowcore.level).toBe(15)
    expect(glowcore.color).toBe('#00e5ff')
    // Cyan: no red, green a little under blue, which is the full level.
    expect(glowcore.rgb).toEqual([0, 13, 15])
    expect(heldGlow(PRISMITE)!.level).toBe(10)
    expect(heldGlow(MAGMAFLOW)!.rgb[0]).toBe(15)
  })

  it('is not plain rock, Cinderrock (only embers in its picture), open space or the Compiler', () => {
    expect(heldGlow(STONE)).toBeNull()
    expect(heldGlow(CINDERROCK)).toBeNull()
    expect(heldGlow(0)).toBeNull()
    expect(heldLightSource(inv([COMPILER_ID, GLOWCORE], 0, { [GLOWCORE]: 3 }))).toBeNull()
  })
})

describe('on and off as the slot changes', () => {
  it('lights while the chosen slot holds a glowing block you carry, and goes out on another slot, an empty one or none left', () => {
    const counts = { [GLOWCORE]: 2, [STONE]: 9 }
    expect(heldLightSource(inv([GLOWCORE, STONE, 0], 0, counts))?.name).toBe('Glowcore')
    expect(heldLightSource(inv([GLOWCORE, STONE, 0], 1, counts))).toBeNull()
    expect(heldLightSource(inv([GLOWCORE, STONE, 0], 2, counts))).toBeNull()
    expect(heldLightSource(inv([GLOWCORE, STONE, 0], 0, { ...counts, [GLOWCORE]: 0 }))).toBeNull()
  })

  it('puts the light on the blocks and takes it off them, and off again when TERRAIN closes or Block shading is off', () => {
    const calls: Array<Uint8Array | null> = []
    const d = new HeldLightDriver({ setHeld: (b) => calls.push(b) })
    const world = { slotAt: () => null }
    const glow = heldGlow(GLOWCORE)
    expect(d.frame({ world, version: 1, glow, shading: true, eye: [0, 0, 0] })).toBe(true)
    expect(d.lit).toBe(true)
    // Another slot: out.
    d.frame({ world, version: 1, glow: null, shading: true, eye: [0, 0, 0] })
    expect(d.lit).toBe(false)
    expect(calls.at(-1)).toBeNull()
    d.frame({ world, version: 1, glow, shading: true, eye: [0, 0, 0] })
    expect(d.lit).toBe(true)
    // TERRAIN closed (no field): out.
    d.frame({ world: null, version: 1, glow, shading: true, eye: [0, 0, 0] })
    expect(d.lit).toBe(false)
    d.frame({ world, version: 1, glow, shading: true, eye: [0, 0, 0] })
    d.frame({ world, version: 1, glow, shading: false, eye: [0, 0, 0] })
    expect(d.lit).toBe(false)
    // Out once, not every frame.
    const n = calls.length
    d.frame({ world, version: 1, glow: null, shading: true, eye: [0, 0, 0] })
    expect(calls.length).toBe(n)
  })

  it('reaches the material: on with its cube corner, out again', () => {
    const m = makeTerrainMaterial()
    const u = m.material.uniforms
    expect(u.heldOn.value).toBe(0)
    m.setHeld(new Uint8Array(HELD_BYTES), [-15, 2, -15])
    expect(u.heldOn.value).toBe(1)
    expect((u.heldAt.value as Vector3).toArray()).toEqual([-15, 2, -15])
    // Every chunk's materials share it, each placed by its own corner.
    const c = m.forChunk(m.material.uniforms.light.value, [1, 0, -2])
    expect(c.material.uniforms.heldOn).toBe(u.heldOn)
    expect(c.clearMaterial.uniforms.held).toBe(u.held)
    expect((c.material.uniforms.chunkAt.value as Vector3).toArray()).toEqual([32, 0, -64])
    expect(c.clearMaterial.uniforms.chunkAt).toBe(c.material.uniforms.chunkAt)
    m.setHeld(null)
    expect(u.heldOn.value).toBe(0)
    c.material.dispose(); c.clearMaterial.dispose(); m.dispose()
  })
})

describe('where the light is', () => {
  it('is the cube round the eye, the eye at its middle, its outer layer dark', () => {
    expect(HELD_SIDE).toBe(2 * HELD_REACH + 1)
    expect(heldCorner([40, 5, -3])).toEqual([25, -10, -18])
    const light = computeHeldLight(new Uint8Array(HELD_SIDE ** 3).fill(1), heldGlow(GLOWCORE)!.rgb)
    expect(heldAt(light, HELD_REACH, HELD_REACH, HELD_REACH)).toEqual([0, BRIGHT_BLOCK[13], BRIGHT_BLOCK[15]])
    for (let a = 0; a < HELD_SIDE; a++) for (let b = 0; b < HELD_SIDE; b++) {
      expect(heldAt(light, 0, a, b)).toEqual([0, 0, 0])
      expect(heldAt(light, HELD_SIDE - 1, a, b)).toEqual([0, 0, 0])
      expect(heldAt(light, a, 0, b)).toEqual([0, 0, 0])
      expect(heldAt(light, a, b, HELD_SIDE - 1)).toEqual([0, 0, 0])
    }
  })

  it('follows the eye into a new cell, not before: an eye resting on a cell\'s side never flips', () => {
    const field = new Matrix4().makeTranslation(-0.5, -0.5, -0.5)
    const out: [number, number, number] = [NaN, NaN, NaN]
    // Field coordinate = render + 0.5.
    expect(eyeCell(new Vector3(2.7, 0.9, -3.2), field, out)).toEqual([3, 1, -3])
    // A hair past the side, still the same cell.
    eyeCell(new Vector3(3.5 + EYE_SLACK / 2, 0.9, -3.2), field, out)
    expect(out).toEqual([3, 1, -3])
    // Well into the next: it follows.
    eyeCell(new Vector3(3.5 + 2 * EYE_SLACK, 0.9, -3.2), field, out)
    expect(out).toEqual([4, 1, -3])
  })

  it('is worked out again when the eye moves into another cell, and only then', () => {
    let sets = 0
    const d = new HeldLightDriver({ setHeld: () => { sets++ } })
    const blocks = new Uint8Array(CELLS)
    const slot = { blocks, version: 1 }
    const world = { slotAt: (cx: number, cy: number, cz: number) => (cx === 0 && cy === 0 && cz === 0 ? slot : null) } as never
    const glow = heldGlow(GLOWCORE)
    d.frame({ world, version: 1, glow, shading: true, eye: [10, 10, 10] })
    for (let i = 0; i < 30; i++) d.frame({ world, version: 1, glow, shading: true, eye: [10, 10, 10] })
    expect(sets).toBe(1)
    d.frame({ world, version: 1, glow, shading: true, eye: [11, 10, 10] })
    expect(sets).toBe(2)
    // Another kind in hand: worked out again in its colour.
    d.frame({ world, version: 1, glow: heldGlow(MAGMAFLOW), shading: true, eye: [11, 10, 10] })
    expect(sets).toBe(3)
  })
})

describe('the same light a placed block gives', () => {
  // A sealed room of stone, 9 by 4 by 9, in the middle chunk; every chunk round it solid, so no open light gets in.
  const solid = (): Uint8Array => new Uint8Array(CELLS).fill(STONE)
  const room = (): Uint8Array => {
    const b = solid()
    for (let y = 10; y < 14; y++) for (let z = 8; z < 17; z++) for (let x = 8; x < 17; x++) b[idx(x, y, z)] = 0
    // A tunnel off it, round a corner.
    for (let x = 17; x < 23; x++) b[idx(x, 10, 12)] = 0
    for (let z = 12; z < 20; z++) b[idx(22, 10, z)] = 0
    // A pocket beyond the room's wall, near in a straight line but with no way in.
    b[idx(12, 11, 19)] = 0
    return b
  }
  const around = (mid: Uint8Array): Around => Array.from({ length: 27 }, (_, i) => (i === aroundIndex(0, 0, 0) ? mid : solid()))
  const eye: [number, number, number] = [12, 11, 12]
  const held = (b: Uint8Array, id: number): Uint8Array => {
    const corner = heldCorner(eye)
    const pass = fillHeldPass((cx, cy, cz) => (cx === 0 && cy === 0 && cz === 0 ? b : solid()), corner, new Uint8Array(HELD_SIDE ** 3))
    return computeHeldLight(pass, heldGlow(id)!.rgb)
  }

  it('matches a Magmaflow (walked through) placed at the eye, cell for cell, in the room and round the tunnel\'s corner', () => {
    const b = room()
    const mine = held(b, MAGMAFLOW)
    const placed = b.slice(); placed[idx(...eye)] = MAGMAFLOW
    const theirs = computeLight(around(placed), null, tables)
    let lit = 0
    for (let y = 9; y < 15; y++) for (let z = 7; z < 21; z++) for (let x = 7; x < 27; x++) {
      const h = heldAt(mine, x - eye[0] + HELD_REACH, y - eye[1] + HELD_REACH, z - eye[2] + HELD_REACH)
      expect(h).toEqual(lightAt(theirs, x, y, z))
      if (h[0] > 0) lit++
    }
    expect(lit).toBeGreaterThan(300)
  })

  it('matches a solid Glowcore placed at the eye everywhere but the eye\'s own cell, which the placed block fills', () => {
    const b = room()
    const mine = held(b, GLOWCORE)
    const placed = b.slice(); placed[idx(...eye)] = GLOWCORE
    const theirs = computeLight(around(placed), null, tables)
    for (let y = 9; y < 15; y++) for (let z = 7; z < 21; z++) for (let x = 7; x < 27; x++) {
      if (x === eye[0] && y === eye[1] && z === eye[2]) continue
      expect(heldAt(mine, x - eye[0] + HELD_REACH, y - eye[1] + HELD_REACH, z - eye[2] + HELD_REACH)).toEqual(lightAt(theirs, x, y, z))
    }
    expect(heldAt(mine, HELD_REACH, HELD_REACH, HELD_REACH)[2]).toBe(BRIGHT_BLOCK[15])
    // Round the tunnel's corner it still reaches, dimmer; never through a wall into the pocket.
    expect(heldAt(mine, 22 - eye[0] + HELD_REACH, 10 - eye[1] + HELD_REACH, 14 - eye[2] + HELD_REACH)[2]).toBe(BRIGHT_BLOCK[2])
    expect(heldAt(mine, 12 - eye[0] + HELD_REACH, 11 - eye[1] + HELD_REACH, 19 - eye[2] + HELD_REACH)).toEqual([0, 0, 0])
  })

  it('lights a sealed room far past the Headlamp: Glowcore\'s blue at the room\'s wall, 4 blocks off', () => {
    const mine = held(room(), GLOWCORE)
    const wall = brightness(heldAt(mine, HELD_REACH - 4, HELD_REACH, HELD_REACH)[2])
    const lamp = EYE_LAMP.light * (1 - 4 / EYE_LAMP.reach) ** 2
    expect(wall).toBeGreaterThan(0.6)
    expect(wall).toBeGreaterThan(10 * lamp)
  })
})

describe('worked out only from the chunks round you', () => {
  it('reads only the chunks the cube overlaps: one deep in a chunk, eight at a corner, never the 27 round it', () => {
    expect(heldChunks(heldCorner([16, 16, 16]))).toEqual([[0, 0, 0]])
    expect(heldChunks(heldCorner([0, 0, 0]))).toHaveLength(8)
    const asked = new Set<string>()
    fillHeldPass((cx, cy, cz) => { asked.add(`${cx},${cy},${cz}`); return null }, heldCorner([31, 3, 40]), new Uint8Array(HELD_SIDE ** 3))
    expect(asked.size).toBe(8)
  })

  it('is not worked out again for a change in a chunk outside its cube, and is for one inside it', () => {
    let sets = 0
    const d = new HeldLightDriver({ setHeld: () => { sets++ } })
    const near = { blocks: new Uint8Array(CELLS), version: 1 }
    const far = { blocks: new Uint8Array(CELLS), version: 1 }
    const world = { slotAt: (cx: number, cy: number, cz: number) => (cx === 0 && cy === 0 && cz === 0 ? near : cx === 3 && cy === 0 && cz === 0 ? far : null) } as never
    const glow = heldGlow(GLOWCORE)
    d.frame({ world, version: 1, glow, shading: true, eye: [16, 16, 16] })
    far.version++
    d.frame({ world, version: 2, glow, shading: true, eye: [16, 16, 16] })
    expect(sets).toBe(1)
    near.version++
    d.frame({ world, version: 3, glow, shading: true, eye: [16, 16, 16] })
    expect(sets).toBe(2)
  })

  it('costs less a cell change than one chunk\'s light (the cube round you reads up to 8 chunks, and relights none of them)', () => {
    const b = new Uint8Array(CELLS)
    for (let i = 0; i < CELLS; i++) b[i] = (i * 2654435761) % 7 === 0 ? STONE : 0
    const d = new HeldLightDriver({ setHeld: () => {} })
    const world = { slotAt: () => ({ blocks: b, version: 1 }) } as never
    const glow = heldGlow(GLOWCORE)
    for (let i = 0; i < 40; i++) d.frame({ world, version: 1, glow, shading: true, eye: [i, 5, 3] })
    const per = d.stats.totalMs / d.stats.updates
    const t0 = performance.now()
    const chunks = 4
    for (let i = 0; i < chunks; i++) computeLight(Array.from({ length: 27 }, () => b), null, tables)
    const chunk = (performance.now() - t0) / chunks
    expect(per).toBeLessThan(chunk)
  })
})

describe('with the Headlamp', () => {
  it('takes the brighter of the two in each colour, so Glowcore stays cyan and is never washed grey', () => {
    const glow = [0, brightness(BRIGHT_BLOCK[13]), brightness(BRIGHT_BLOCK[15])] as const
    const shine = heldShine([0, 0, 0], glow, EYE_LAMP.light, LIGHT_FLOOR)
    expect(shine[2]).toBeCloseTo(glow[2])
    expect(shine[1]).toBeCloseTo(glow[1])
    // Red, which Glowcore has none of, keeps the Headlamp's.
    expect(shine[0]).toBe(EYE_LAMP.light)
    // Never past the brightest of them (no sum blowing out to white at your feet).
    expect(Math.max(...shine)).toBeLessThanOrEqual(Math.max(glow[2], EYE_LAMP.light))
  })

  it('is what the block shader does', () => {
    const m = makeTerrainMaterial()
    const frag = m.material.fragmentShader
    expect(frag).toContain('shine = max(shine, hv * hv')
    expect(frag.indexOf('shine = max(shine, hv * hv')).toBeLessThan(frag.indexOf('eyeLight * near * near'))
    m.dispose()
  })
})

describe('the glow on screen', () => {
  it('is the block\'s colour, as strong as its light level', () => {
    expect(heldGlowLook(heldGlow(GLOWCORE), false)).toEqual({ rgb: '0, 229, 255', strength: 1, pulse: true })
    expect(heldGlowLook(heldGlow(PRISMITE), false)!.strength).toBeCloseTo(10 / 15)
    expect(heldGlowLook(null, false)).toBeNull()
  })

  it('holds still with reduced motion', () => {
    expect(heldGlowLook(heldGlow(GLOWCORE), true)!.pulse).toBe(false)
  })
})
