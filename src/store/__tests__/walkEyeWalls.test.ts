/**
 * walkEyeWalls.test.ts - eyeReach, the WALK eye pulled back short of the
 * faces that stop a walker: a ceiling over a tall avatar's eye, the floor the
 * walker's point is in, an eye below that floor, a third-person eye behind
 * the avatar with a wall behind it, a wall beside the eye, a glancing plane,
 * a fall between gibsons, and (the rule that matters) that whatever comes
 * back, the line from the walker to the eye crosses nothing.
 *
 * eyePlace, where the rig puts the camera: an eye ahead of the walker at the
 * foot of a riser keeps its height (up, then over), and the eye keeps the
 * near plane's room from a riser in front and from a step's top below it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})
vi.mock('../../lib/contacts', () => ({ GENERAL_RELAYS: [], followsOf: async () => [], fetchContacts: async () => [] }))

import { newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { withConstrain } from '../../lib/walkConstrain'
import { setLocalAuthor } from '../../lib/carried'
import type { AxisName, Position } from '../../lib/space'
import { clearWalls, eyePlace, eyeReach, wallsBuilt, type WallItem } from '../walkWalls'

const AXES: AxisName[] = ['x', 'y', 'z']
const AT: Position = { x: 1n << 60n, y: 3n << 58n, z: 5n << 57n }
const ROOM = 0.15

/** A square slab two ticks thick across `axis`, its near face `near` units out on side `dir`, `half` units each way. */
function slab(axis: AxisName, dir: 1 | -1, near: number, half = 2, unit = 0): ShardModel {
  const i = AXES.indexOf(axis)
  const j = (i + 1) % 3, k = (i + 2) % 3
  const verts: ShardModel['vertices'] = []
  for (const depth of [near * 120, near * 120 + 2]) for (const [a, b] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
    const t = [0, 0, 0]; t[i] = Math.round(depth) * dir; t[j] = a * 120; t[k] = b * 120
    const p = t.map((x) => Math.floor(x / 120)) as [number, number, number]
    const r = t.map((x, n) => x - p[n] * 120) as [number, number, number]
    verts.push(r.some((x) => x !== 0) ? { p, t: r, c: [1, 1, 1] } : { p, c: [1, 1, 1] })
  }
  const q = (a: number, b: number, c: number, e: number): number[][] => [[a, b, c], [a, c, e]]
  const faces = [...q(0, 1, 2, 3), ...q(4, 7, 6, 5), ...q(0, 4, 5, 1), ...q(1, 5, 6, 2), ...q(2, 6, 7, 3), ...q(3, 7, 4, 0)] as Array<[number, number, number]>
  return withConstrain({ ...newShard('Slab'), unit, mode: 'solid', vertices: verts, faces }, 'all')
}

/** A solid box from `lo` to `hi` ticks (the model's axes are cyberspace's). */
function box(lo: number[], hi: number[]): ShardModel {
  const v = (x: number, y: number, z: number): ShardModel['vertices'][number] => {
    const t = [x, y, z]
    const p = t.map((q) => Math.floor(q / 120)) as [number, number, number]
    const r = t.map((q, i) => q - p[i] * 120) as [number, number, number]
    return r.some((q) => q !== 0) ? { p, t: r, c: [1, 1, 1] } : { p, c: [1, 1, 1] }
  }
  const verts = [v(lo[0], lo[1], lo[2]), v(hi[0], lo[1], lo[2]), v(hi[0], lo[1], hi[2]), v(lo[0], lo[1], hi[2]), v(lo[0], hi[1], lo[2]), v(hi[0], hi[1], lo[2]), v(hi[0], hi[1], hi[2]), v(lo[0], hi[1], hi[2])]
  const q = (a: number, b: number, c: number, e: number): number[][] => [[a, b, c], [a, c, e]]
  const faces = [...q(0, 1, 2, 3), ...q(4, 7, 6, 5), ...q(0, 4, 5, 1), ...q(1, 5, 6, 2), ...q(2, 6, 7, 3), ...q(3, 7, 4, 0)] as Array<[number, number, number]>
  return withConstrain({ ...newShard('Box'), mode: 'solid', vertices: verts, faces }, 'all')
}

/** A ramp through the walker's point, rising one in one toward +Z (cyberspace), two units each way, two ticks thick. */
function ramp(): ShardModel {
  const v = (x: number, y: number, z: number): ShardModel['vertices'][number] => {
    const t = [x, y, z]
    const p = t.map((q) => Math.floor(q / 120)) as [number, number, number]
    const r = t.map((q, i) => q - p[i] * 120) as [number, number, number]
    return r.some((q) => q !== 0) ? { p, t: r, c: [1, 1, 1] } : { p, c: [1, 1, 1] }
  }
  // Cyberspace z is model -z on the wire's own frame after the read; the model holds cyberspace axes, so y = z here.
  const verts = [v(-240, -240, -240), v(240, -240, -240), v(240, 240, 240), v(-240, 240, 240), v(-240, -242, -240), v(240, -242, -240), v(240, 238, 240), v(-240, 238, 240)]
  const q = (a: number, b: number, c: number, e: number): number[][] => [[a, b, c], [a, c, e]]
  const faces = [...q(0, 1, 2, 3), ...q(4, 7, 6, 5), ...q(0, 4, 5, 1), ...q(1, 5, 6, 2), ...q(2, 6, 7, 3), ...q(3, 7, 4, 0)] as Array<[number, number, number]>
  return withConstrain({ ...newShard('Ramp'), mode: 'solid', vertices: verts, faces }, 'all')
}

let n = 0
const item = (shard: ShardModel): WallItem => ({ key: `eye-${n++}`, at: { ...AT }, height: 84, plane: 1, shard })

/** Where the eye ends up, gibsons from the walker: the share times the eye. */
function placed(eye: [number, number, number], items: WallItem[], lead: [number, number, number] = [0, 0, 0], up = { axis: 'y' as AxisName, dir: 1 as 1 | -1 }): number[] {
  const k = eyeReach(AT, lead, eye, ROOM, items, up)
  expect(k).toBeGreaterThanOrEqual(0)
  expect(k).toBeLessThanOrEqual(1)
  return eye.map((v) => v * k)
}

afterEach(() => clearWalls())

describe('eyeReach', () => {
  it('leaves the eye where it is with nothing in the way', () => {
    expect(eyeReach(AT, [0, 0, 0], [0, 1.325, 0], ROOM, [])).toBe(1)
    expect(eyeReach(AT, [0, 0, 0], [0, 1.325, 0], ROOM, [item(slab('x', 1, 3))])).toBe(1)
  })

  it('is 1 for an eye at the walker’s point', () => {
    expect(eyeReach(AT, [0, 0, 0], [0, 0, 0], ROOM, [item(slab('y', 1, 0.5))])).toBe(1)
  })

  it('holds a tall avatar’s eye under a ceiling, a near plane’s room and more short of it', () => {
    // The Ship's eye is 1.325 up; a one-gibson tunnel's ceiling is 1 up.
    const [, y] = placed([0, 1.325, 0], [item(slab('y', 1, 1))])
    expect(y).toBeLessThanOrEqual(1 - ROOM + 1e-9)
    expect(y).toBeGreaterThan(0.6)
  })

  it('lets the eye rise from the floor the walker’s point is in', () => {
    // Walking along a floor keeps the walker's point in the floor's plane.
    expect(eyeReach(AT, [0, 0, 0], [0, 0.375, 0], ROOM, [item(slab('y', -1, 0))])).toBe(1)
  })

  it('holds an eye below the walker at the floor it stands in', () => {
    expect(eyeReach(AT, [0, 0, 0], [0, -0.5, 0], ROOM, [item(slab('y', -1, 0))])).toBe(0)
    // Up along another axis (a turned view's gravity): the same floor, seen from +X.
    expect(eyeReach(AT, [0, 0, 0], [-0.5, 0, 0], ROOM, [item(slab('x', -1, 0))], { axis: 'x', dir: 1 })).toBe(0)
  })

  it('pulls a third-person eye behind the avatar in short of a wall behind it', () => {
    // An eye 3 gibsons behind and a little up; a wall 1 gibson behind.
    const eye: [number, number, number] = [0, 0.5, 3]
    expect(eyeReach(AT, [0, 0, 0], eye, ROOM, [])).toBe(1)
    const at = placed(eye, [item(slab('z', 1, 1))])
    expect(at[2]).toBeLessThanOrEqual(1 - ROOM + 1e-9)
    expect(at[2]).toBeGreaterThan(0.5)
  })

  it('steps the eye back from a wall beside it', () => {
    // An eye 0.45 to the side, a wall 0.5 to that side: 0.05 away, inside the near plane's room.
    const at = placed([0.45, 0, 0], [item(slab('x', 1, 0.5))])
    expect(0.5 - at[0]).toBeGreaterThanOrEqual(ROOM - 1e-9)
    // A wall 0.1 beside the walker and the whole line up to the eye: stepping
    // back cannot clear it, and the eye is no nearer it than the walker is,
    // so the eye stays up (it does not fall back into the floor).
    expect(eyeReach(AT, [0, 0, 0], [0, 1.3, 0], ROOM, [item(slab('x', 1, 0.1)), item(slab('y', -1, 0))])).toBe(1)
    // An eye that leans toward that wall is held from coming nearer it than the walker is.
    const lean = placed([0.3, 1, 0], [item(slab('x', 1, 0.1))])
    expect(lean[0]).toBeLessThanOrEqual(1e-9 + 0.075)
    // A short wall beside the walker that the eye rises clear of: it stays.
    expect(eyeReach(AT, [0, 0, 0], [0, 1, 0], ROOM, [item(slab('x', 1, 0.1, 0.25))])).toBe(1)
  })

  it('keeps the near plane’s room square to a face the line meets at a slant', () => {
    const at = placed([1, 1, 0], [item(slab('y', 1, 0.5))])
    expect(0.5 - at[1]).toBeGreaterThanOrEqual(ROOM - 1e-9)
  })

  it('asks from a fall’s height between gibsons', () => {
    // Half a gibson up in a fall, a ceiling 1 up: an eye 0.375 above the fall's point meets it.
    const at = placed([0, 0.375, 0], [item(slab('y', 1, 1))], [0, 0.5, 0])
    expect(0.5 + at[1]).toBeLessThanOrEqual(1 - ROOM + 1e-9)
  })

  it('scales with the shard’s unit', () => {
    // Unit 2: the slab's near face is 4 gibsons up.
    expect(eyeReach(AT, [0, 0, 0], [0, 3, 0], ROOM, [item(slab('y', 1, 1, 2, 2))])).toBe(1)
    const [, y] = placed([0, 6, 0], [item(slab('y', 1, 1, 2, 2))])
    expect(y).toBeLessThanOrEqual(4 - ROOM + 1e-9)
  })

  it('holds any eye at the walker standing in a wall\u2019s plane', () => {
    // A wall across X through the walker's point (a walker walks into its plane along it).
    const wall = [item(slab('x', 1, 0))]
    expect(eyeReach(AT, [0, 0, 0], [2, 0.5, 0], ROOM, wall)).toBe(0)
    expect(eyeReach(AT, [0, 0, 0], [-2, 0.5, 0], ROOM, wall)).toBe(0)
    expect(eyeReach(AT, [0, 0, 0], [0, 0.5, 3], ROOM, wall)).toBe(0)
    // Straight up, inside the wall's plane: edge-on, it would see both sides.
    expect(eyeReach(AT, [0, 0, 0], [0, 1.3, 0], ROOM, wall)).toBe(0)
  })

  it('lets the eye rise from the rim of a block the walker stands on', () => {
    // A block one unit deep below the walker, its edge through the walker's point: x from 0 to 2, y from -1 to 0.
    const block = item(box([0, -120, -240], [240, 0, 240]))
    expect(eyeReach(AT, [0, 0, 0], [0, 1.3, 0], ROOM, [block])).toBe(1)
    // Behind, away from the block and a little up: clear.
    expect(eyeReach(AT, [0, 0, 0], [-2, 0.5, 0], ROOM, [block])).toBe(1)
    // Down into the block: held.
    expect(eyeReach(AT, [0, 0, 0], [1, -0.5, 0], ROOM, [block])).toBe(0)
  })

  it('keeps a level eye behind the walker over the floor it stands in', () => {
    expect(eyeReach(AT, [0, 0, 0], [0, 0, -4], ROOM, [item(slab('y', -1, 0))])).toBe(1)
  })

  it('holds the eye at a walker against the underside of a block', () => {
    // A block from the walker's height up to 2: its underside in the walker's plane.
    expect(eyeReach(AT, [0, 0, 0], [0, 1.3, 0], ROOM, [item(box([-240, 0, -240], [240, 240, 240]))])).toBe(0)
  })

  it('holds the eye when the walker as drawn is past a face from its gibson', () => {
    // Drawn half a gibson toward +X (a coarse zoom's cell centre), with a wall 0.25 out between.
    expect(eyeReach(AT, [0.5, 0, 0], [0, 1, 0], ROOM, [item(slab('x', 1, 0.25, 2))])).toBe(0)
    expect(eyeReach(AT, [0.5, 0, 0], [0, 1, 0], ROOM, [item(slab('x', 1, 1, 2))])).toBe(1)
  })

  it('lets the eye rise from a ramp the walker stands on, and holds an eye behind and below it', () => {
    const r = item(ramp())
    expect(eyeReach(AT, [0, 0, 0], [0, 1.3, 0], ROOM, [r])).toBe(1)
    // The ramp rises toward +Z: an eye behind (+Z) and a little up is under it.
    expect(eyeReach(AT, [0, 0, 0], [0, 0.5, 4], ROOM, [r])).toBe(0)
    // Toward -Z and a little up the ramp falls away: clear.
    expect(eyeReach(AT, [0, 0, 0], [0, 0.5, -2], ROOM, [r])).toBe(1)
  })

  it('reads up from the gravity it is given', () => {
    // A floor across Z through the walker, gravity along -Z: an eye toward -Z is below it.
    const floor = [item(slab('z', -1, 0))]
    expect(eyeReach(AT, [0, 0, 0], [0, 0, -0.5], ROOM, floor, { axis: 'z', dir: 1 })).toBe(0)
    expect(eyeReach(AT, [0, 0, 0], [0, 0, 0.5], ROOM, floor, { axis: 'z', dir: 1 })).toBe(1)
    // The same eye with gravity along -Y: the slab is a wall through the walker.
    expect(eyeReach(AT, [0, 0, 0], [0, 0, 0.5], ROOM, floor)).toBe(0)
  })

  it('keeps the near plane\u2019s room from every face it leaves the eye near', () => {
    let seed = 11
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let trial = 0; trial < 80; trial++) {
      clearWalls()
      const items: WallItem[] = []
      const boxes: Array<{ lo: number[]; hi: number[] }> = []
      for (let w = 0; w < 3; w++) {
        const axis = AXES[Math.floor(rnd() * 3)], dir = rnd() < 0.5 ? 1 : -1
        const near = Math.round((0.3 + rnd() * 2) * 12) / 12, half = Math.round((0.5 + rnd() * 2) * 12) / 12
        items.push(item(slab(axis, dir, near, half)))
        // The slab as a box, in gibsons from the walker (the model's axes are cyberspace's).
        const i = AXES.indexOf(axis)
        const lo = [-half, -half, -half], hi = [half, half, half]
        const a = near * dir, b = (near + 2 / 120) * dir
        lo[i] = Math.min(a, b); hi[i] = Math.max(a, b)
        boxes.push({ lo, hi })
      }
      const eye: [number, number, number] = [(rnd() - 0.5) * 6, (rnd() - 0.3) * 6, (rnd() - 0.5) * 6]
      const k = eyeReach(AT, [0, 0, 0], eye, ROOM, items)
      const at = eye.map((v) => v * k)
      const dist = (p: number[], bx: { lo: number[]; hi: number[] }): number => Math.hypot(...p.map((v, q) => Math.max(bx.lo[q] - v, 0, v - bx.hi[q])))
      // Every slab is at least the room from where the eye ends, or no nearer it than the walker is
      // (give or take the hair the line starts above the walker, EYE_LIFT).
      for (const bx of boxes) {
        const d = dist(at, bx)
        expect(d >= ROOM - 2e-4 || d >= dist([0, 0, 0], bx) - 2e-4, JSON.stringify({ eye, k, bx, d })).toBe(true)
      }
    }
  })

  it('asks a shard\u2019s placed walls, and holds the eye at the walker while they are still being built', async () => {
    const ME = 'a'.repeat(64)
    const wallAt = `33331:${ME}:wall`
    // A maze: its wall across -Z carried in the table and placed 3 out.
    const maze = withConstrain({ ...newShard('Maze'), mode: 'solid', vertices: [], faces: [], author: ME, refs: [['a', wallAt]], parts: [{ ref: 0, at: [0, 0, -360], turn: [0, 0, 0], step: 0 }], objects: { [wallAt]: toPayload(slab('z', -1, 0)) } }, 'off') as ShardModel
    setLocalAuthor(() => ME)
    try {
      const m = { ...item(maze), mine: true, author: ME }
      const out = { pending: false }
      expect(eyeReach(AT, [0, 0, 0], [0, 0.5, -5], ROOM, [m], undefined, out)).toBe(0)
      expect(out.pending).toBe(true)
      await wallsBuilt()
      const k = eyeReach(AT, [0, 0, 0], [0, 0.5, -5], ROOM, [m], undefined, out)
      expect(out.pending).toBe(false)
      const z = -5 * k
      expect(z).toBeGreaterThanOrEqual(-3 + ROOM - 1e-9)
      expect(z).toBeLessThan(-2)
    } finally { setLocalAuthor(null) }
  })

  it('leaves out a shard\u2019s own faces outside its region, where they are not drawn', () => {
    // At height 1 the region is the 2-gibson block holding AT: a ceiling 3 up is outside it.
    expect(eyeReach(AT, [0, 0, 0], [0, 3.5, 0], ROOM, [{ ...item(slab('y', 1, 3)), height: 1 }])).toBe(1)
    expect(eyeReach(AT, [0, 0, 0], [0, 3.5, 0], ROOM, [item(slab('y', 1, 3))])).toBeLessThan(1)
  })

  it('never leaves the line from the walker to the eye crossing a face', () => {
    // Pseudo-random rooms and eyes, fixed seed: the eye it gives, asked again
    // with no room at all, is reached whole (nothing crosses its line).
    let seed = 7
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let trial = 0; trial < 120; trial++) {
      clearWalls()
      const items: WallItem[] = []
      for (let w = 0; w < 4; w++) {
        const axis = AXES[Math.floor(rnd() * 3)]
        items.push(item(slab(axis, rnd() < 0.5 ? 1 : -1, Math.round((0.1 + rnd() * 2) * 120) / 120, 0.5 + rnd() * 2)))
      }
      const eye: [number, number, number] = [(rnd() - 0.5) * 6, (rnd() - 0.3) * 6, (rnd() - 0.5) * 6]
      const k = eyeReach(AT, [0, 0, 0], eye, ROOM, items)
      const got = eye.map((v) => v * k) as [number, number, number]
      expect(eyeReach(AT, [0, 0, 0], got, 0, items)).toBe(1)
    }
  })
})

describe('eyePlace', () => {
  /** A floor through the walker's point and a riser `gap` ahead along +X, its top `top` up. */
  const riser = (gap: number, top: number): WallItem[] => [
    item(box([-480, -240, -480], [480, 0, 480])),
    item(box([Math.round(gap * 120), -240, -480], [720, Math.round(top * 120), 480])),
  ]
  /** How far `p` is from the box `lo`..`hi` (ticks), in gibsons. */
  const away = (p: number[], lo: number[], hi: number[]): number => Math.hypot(...p.map((v, q) => Math.max(lo[q] / 120 - v, 0, v - hi[q] / 120)))

  it('is the eye itself with nothing in the way, and eyeReach\u2019s share of it when that is the whole answer', () => {
    expect(eyePlace(AT, [0, 0, 0], [0.27, 2.8, 0], ROOM, [])).toEqual([0.27, 2.8, 0])
    // A ceiling straight over the walker: the eye comes down under it as eyeReach has it.
    const ceiling = [item(slab('y', 1, 1))]
    const k = eyeReach(AT, [0, 0, 0], [0, 1.325, 0], ROOM, ceiling)
    expect(eyePlace(AT, [0, 0, 0], [0, 1.325, 0], ROOM, ceiling)[1]).toBeCloseTo(1.325 * k, 12)
    // A walker standing in a wall's plane: held at the walker, as eyeReach holds it.
    expect(eyePlace(AT, [0, 0, 0], [2, 0.5, 0], ROOM, [item(slab('x', 1, 0))])).toEqual([0, 0, 0])
  })

  it('keeps an eye ahead of the walker at its height at the foot of a riser: up, then over', () => {
    // His operative's eye, 2.8 up and 0.27 ahead, the walker 0.05 short of a riser 1 tall.
    const items = riser(0.05, 1)
    // The straight line runs into the riser low down, and takes the eye back to the feet.
    expect(eyeReach(AT, [0, 0, 0], [0.27, 2.8, 0], ROOM, items)).toBeLessThan(0.05)
    const p = eyePlace(AT, [0, 0, 0], [0.27, 2.8, 0], ROOM, items)
    expect(p[0]).toBeCloseTo(0.27, 9)
    expect(p[1]).toBeCloseTo(2.8, 9)
  })

  it('holds the near plane\u2019s room from a riser in front of the eye, keeping its height', () => {
    // An eye straight up, 1.33, the walker 0.05 short of a riser 2 tall: the eye is as near it as the walker.
    const items = riser(0.05, 2)
    expect(eyeReach(AT, [0, 0, 0], [0, 1.33, 0], ROOM, items)).toBe(1)
    const p = eyePlace(AT, [0, 0, 0], [0, 1.33, 0], ROOM, items)
    expect(p[1]).toBeCloseTo(1.33, 9)
    expect(0.05 - p[0]).toBeGreaterThanOrEqual(ROOM - 1e-9)
    // Forward toward it, it is held short and stepped back the same.
    const q = eyePlace(AT, [0, 0, 0], [0.5, 1.33, 0], ROOM, items)
    expect(q[1]).toBeCloseTo(1.33, 9)
    expect(0.05 - q[0]).toBeGreaterThanOrEqual(ROOM - 1e-9)
  })

  it('lifts an eye off the top of the next step a stair\u2019s trail lowered it onto', () => {
    // The walker 0.1 short of a riser 1 tall; the eye 0.3 ahead and 1.03 up, 0.03 over that step's top.
    const p = eyePlace(AT, [0, 0, 0], [0.3, 1.03, 0], ROOM, riser(0.1, 1))
    expect(p[0]).toBeCloseTo(0.3, 9)
    expect(p[1] - 1).toBeGreaterThanOrEqual(ROOM - 1e-9)
  })

  it('slides a third-person eye far behind down its line short of a wall, as eyeReach does', () => {
    // 3 behind and 0.5 up, a wall 1 behind: up-then-over is only for an eye mostly above the walker.
    const items = [item(slab('z', 1, 1))]
    const k = eyeReach(AT, [0, 0, 0], [0, 0.5, 3], ROOM, items)
    const p = eyePlace(AT, [0, 0, 0], [0, 0.5, 3], ROOM, items)
    expect(p[1]).toBeCloseTo(0.5 * k, 9)
    expect(p[2]).toBeCloseTo(3 * k, 9)
  })

  it('keeps the near plane\u2019s room in pseudo-random rooms, wherever the walker is not itself nearer', () => {
    let seed = 23
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    let kept = 0
    for (let trial = 0; trial < 120; trial++) {
      clearWalls()
      const items: WallItem[] = [item(box([-720, -240, -720], [720, 0, 720]))]
      const solids: Array<{ lo: number[]; hi: number[] }> = [{ lo: [-720, -240, -720], hi: [720, 0, 720] }]
      for (let w = 0; w < 3; w++) {
        // A step or a pillar beside the walker, never over its point.
        const x = Math.round((0.02 + rnd() * 1.5) * 120) * (rnd() < 0.5 ? 1 : -1)
        const z = Math.round((rnd() - 0.5) * 2 * 120)
        const lo = [x > 0 ? x : x - 240, 0, z - 120], hi = [x > 0 ? x + 240 : x, Math.round((0.3 + rnd() * 3) * 120), z + 120]
        items.push(item(box(lo, hi)))
        solids.push({ lo, hi })
      }
      const eye: [number, number, number] = [(rnd() - 0.5) * 1.2, 0.5 + rnd() * 2.5, (rnd() - 0.5) * 1.2]
      const p = eyePlace(AT, [0, 0, 0], eye, ROOM, items)
      for (const b of solids) {
        const d = away(p, b.lo, b.hi)
        // At least the room from every solid, unless boxed in tighter than the room on both sides.
        if (d >= ROOM - 1e-6) kept++
        else expect(away([0, 0, 0], b.lo, b.hi), JSON.stringify({ eye, p, b, d })).toBeLessThan(2 * ROOM)
      }
      // Never through a face from the walker: up its line (asked with no room), and never inside a solid.
      expect(eyeReach(AT, [0, 0, 0], [0, p[1], 0], 0, items)).toBe(1)
      for (const b of solids) expect(away(p, b.lo, b.hi), JSON.stringify({ eye, p, b })).toBeGreaterThan(0)
    }
    expect(kept).toBeGreaterThan(400)
  })
})

