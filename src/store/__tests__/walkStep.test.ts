/**
 * walkStep.test.ts - WALK's automatic step-up and step-down (store/walkStep.ts),
 * away from the walk store: both Maze Kit stairs (the grand stair, 53
 * degrees, and the aqueduct cascade's, about 58) take one press per gibson
 * up and down with no other key; a riser of 1 or 2 climbs and one of 3 does
 * not; a ceiling or a lintel holds the lift; a rail with nothing beyond it
 * holds you; a shard without collision is never climbed, stood on or
 * stepped down onto; step-down settles only onto a collision floor, only 1
 * or 2 down, and only from one; and everything else (up and down, floating,
 * a press past a tile, a flat floor) is the plain stepLimit.
 * Then a random walk among closed boxes that never ends inside one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { fromPayload, newShard, type ShardModel, type ShardPayload } from 'sno-core/shards'
import { withConstrain, type Constrain } from '../../lib/walkConstrain'
import type { AxisName, Position } from '../../lib/space'
import { clearWalls, stepLimit, type WallItem } from '../walkWalls'
import { standing, walkStep } from '../walkStep'
import hallStairs from '../fixtures/maze-kit-basilica-hall-stairs.json'
import aqCascade from '../fixtures/maze-kit-basilica-civic-aq-cascade.json'

/** The shards' origin, in the middle of a region so no clip cuts them. */
const AT: Position = { x: (1n << 50n) + (1n << 39n), y: (1n << 50n) + (1n << 39n), z: (1n << 50n) + (1n << 39n) }
const rel = (x: number, y: number, z: number): Position => ({ x: AT.x + BigInt(x), y: AT.y + BigInt(y), z: AT.z + BigInt(z) })
const off = (p: Position): [number, number, number] => [Number(p.x - AT.x), Number(p.y - AT.y), Number(p.z - AT.z)]

type V3 = [number, number, number]

/** A closed box from `lo` to `hi` in gibsons from its origin (multiples of 1/120), at unit 0. Model axes are cyberspace axes. */
function boxes(name: string, c: Constrain, list: Array<[V3, V3]>, extra: Partial<ShardModel> = {}): ShardModel {
  const vertices: ShardModel['vertices'] = []
  const faces: Array<[number, number, number]> = []
  for (const [lo, hi] of list) {
    const base = vertices.length
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
      const t = [x, y, z].map((v) => Math.round(v * 120))
      const p = t.map((v) => Math.floor(v / 120)) as V3
      const r = t.map((v, n) => v - p[n] * 120) as V3
      vertices.push(r.some((v) => v !== 0) ? { p, t: r, c: [1, 1, 1] } : { p, c: [1, 1, 1] })
    }
    // Corner index: x*4 + y*2 + z.
    for (const [a, b, cc, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) {
      faces.push([base + a, base + b, base + cc], [base + a, base + cc, base + d])
    }
  }
  return withConstrain({ ...newShard(name), mode: 'solid', vertices, faces, ...extra }, c)
}

let n = 0
const item = (shard: ShardModel, at: Position = AT): WallItem => ({ key: `k${n++}`, at: { ...at }, height: 84, plane: 1, shard })

/** A floor whose top is at y 0, 20 across, and the walker's line along +z at x 0, standing at y 1. */
const FLOOR: [V3, V3] = [[-10, -1, -10], [10, 0, 10]]

beforeEach(() => clearWalls())

describe('a riser', () => {
  /** The floor, and a riser `h` high from z 2 on. */
  const riser = (h: number, c: Constrain = 'all', floor: Constrain = 'all'): WallItem[] => [
    item(boxes('Floor', floor, [FLOOR])),
    item(boxes(`Riser ${h}`, c, [[[-10, 0, 2], [10, h, 10]]])),
  ]

  it('of 1 or 2 is climbed by one press: you land on top of it, standing', () => {
    for (const h of [1, 2, 0.5, 1.5]) {
      clearWalls()
      const items = riser(h)
      const from = rel(0, 1, 1)
      expect(standing(from, items)).toBe(true)
      const s = walkStep(from, 'z', 1, 1n, items)
      expect(s.by).toBeNull()
      expect(off(s.to)[2]).toBe(2)
      // A riser under your line is walked onto; one whose top is at your line or
      // up to 1 above it is lifted over by 1, one up to 2 above it by 2.
      expect(off(s.to)[1]).toBe(h < 1 ? 1 : h < 2 ? 2 : 3)
      expect(standing(s.to, items)).toBe(true)
      expect(off(s.to)[1]).toBeGreaterThan(h)
    }
  })

  it('of 3 or more is not: the press stops short and names the riser', () => {
    for (const h of [3, 4, 8]) {
      clearWalls()
      const items = riser(h)
      const s = walkStep(rel(0, 1, 1), 'z', 1, 1n, items)
      expect(s.to).toEqual(rel(0, 1, 1))
      expect(s.by?.shard.name).toBe(`Riser ${h}`)
    }
  })

  it('without collision is passed through as before, and is never stood on', () => {
    const items = riser(2, 'off')
    const s = walkStep(rel(0, 1, 1), 'z', 1, 1n, items)
    expect(s).toEqual({ to: rel(0, 1, 2), by: null })
    // A see-through riser set to OPAQUE: the same.
    clearWalls()
    const glass = [item(boxes('Floor', 'all', [FLOOR])), item(boxes('Glass', 'opaque', [[[-10, 0, 2], [10, 2, 10]]], { opacity: 50 }))]
    expect(walkStep(rel(0, 1, 1), 'z', 1, 1n, glass)).toEqual({ to: rel(0, 1, 2), by: null })
  })

  it('is never climbed off a floor without collision: you are not standing, so the step is the plain one', () => {
    const items = riser(1, 'all', 'off')
    expect(standing(rel(0, 1, 1), items)).toBe(false)
    const s = walkStep(rel(0, 1, 1), 'z', 1, 1n, items)
    expect(s.to).toEqual(rel(0, 1, 1))
    expect(s.by?.shard.name).toBe('Riser 1')
  })

  it('is never climbed while you float: only standing climbs', () => {
    const items = riser(1)
    // 3 above the floor: not standing.
    const from = rel(0, 3, 1)
    expect(standing(from, items)).toBe(false)
    // The riser's top is below the walker's line: the plain step goes on.
    expect(walkStep(from, 'z', 1, 1n, items)).toEqual({ ...stepOf(from, 'z', 1, 1n, items) })
  })
})

describe('a ceiling', () => {
  it('right over you holds the lift', () => {
    const items = [item(boxes('Floor', 'all', [FLOOR])), item(boxes('Riser', 'all', [[[-10, 0, 2], [10, 1, 10]]])), item(boxes('Ceiling', 'all', [[[-10, 2, -10], [10, 3, 10]]]))]
    const s = walkStep(rel(0, 1, 1), 'z', 1, 1n, items)
    expect(s.to).toEqual(rel(0, 1, 1))
    expect(s.by?.shard.name).toBe('Riser')
  })

  it('over the riser at the lifted heights (a lintel) holds it too: you never climb into it', () => {
    for (const bottom of [1.75, 2]) {
      clearWalls()
      const items = [item(boxes('Floor', 'all', [FLOOR])), item(boxes('Riser', 'all', [[[-10, 0, 2], [10, 1.5, 10]]])), item(boxes('Lintel', 'all', [[[-10, bottom, 2], [10, bottom + 2, 10]]]))]
      const s = walkStep(rel(0, 1, 1), 'z', 1, 1n, items)
      expect(s.to).toEqual(rel(0, 1, 1))
      expect(s.by?.shard.name).toBe('Riser')
    }
  })

  it('with room under it lets you climb, and you land under it, never in or past it', () => {
    const items = [item(boxes('Floor', 'all', [FLOOR])), item(boxes('Riser', 'all', [[[-10, 0, 2], [10, 2, 10]]])), item(boxes('Ceiling', 'all', [[[-10, 3.5, -10], [10, 4.5, 10]]]))]
    const s = walkStep(rel(0, 1, 1), 'z', 1, 1n, items)
    expect(s.by).toBeNull()
    expect(off(s.to)).toEqual([0, 3, 2])
  })
})

describe('a rail', () => {
  it('with nothing to stand on beyond it holds you: no climbing into the air', () => {
    const items = [item(boxes('Floor', 'all', [[[-10, -1, -10], [10, 0, 2.5]]])), item(boxes('Rail', 'all', [[[-10, 0, 2.2], [10, 1, 2.4]]]))]
    const s = walkStep(rel(0, 1, 2), 'z', 1, 1n, items)
    expect(s.to).toEqual(rel(0, 1, 2))
    expect(s.by?.shard.name).toBe('Rail')
  })

  it('too thin to stand on holds you even with floor beyond it', () => {
    const items = [item(boxes('Floor', 'all', [FLOOR])), item(boxes('Rail', 'all', [[[-10, 0, 2.2], [10, 1, 2.4]]]))]
    expect(walkStep(rel(0, 1, 2), 'z', 1, 1n, items).to).toEqual(rel(0, 1, 2))
  })
})

describe('step-down', () => {
  /** The upper floor (top y 0) to z 2, a lower one `d` down from there. */
  const ledge = (d: number, lower: Constrain = 'all'): WallItem[] => [
    item(boxes('Upper', 'all', [[[-10, -1, -10], [10, 0, 2]]])),
    item(boxes('Lower', lower, [[[-10, -d - 1, 2], [10, -d, 10]]])),
  ]

  it('settles onto a collision floor 1 or 2 down, standing', () => {
    for (const d of [1, 2, 0.5, 1.75]) {
      clearWalls()
      const items = ledge(d)
      const s = walkStep(rel(0, 1, 2), 'z', 1, 1n, items)
      expect(off(s.to)[2]).toBe(3)
      expect(off(s.to)[1]).toBe(1 - Math.ceil(d))
      expect(standing(s.to, items)).toBe(true)
    }
  })

  it('does not settle 3 down, or onto a floor without collision: you stay at your height', () => {
    for (const items of [ledge(3), ledge(1, 'off')]) {
      clearWalls()
      expect(walkStep(rel(0, 1, 2), 'z', 1, 1n, items)).toEqual({ to: rel(0, 1, 3), by: null })
    }
  })

  it('does not settle when you were not standing', () => {
    const items = ledge(1)
    // 2 above the upper floor: floating. Over the lower floor, 3 above it.
    expect(walkStep(rel(0, 2, 2), 'z', 1, 1n, items)).toEqual({ to: rel(0, 2, 3), by: null })
    // 1.5 over a floor that is not a shard's at all: nothing to settle onto.
    clearWalls()
    expect(walkStep(rel(0, 1, 2), 'z', 1, 1n, [])).toEqual({ to: rel(0, 1, 3), by: null })
  })
})

/** The plain step: what WALK did before step-up. */
function stepOf(from: Position, axis: AxisName, dir: 1 | -1, length: bigint, items: WallItem[]): { to: Position; by: WallItem | null } {
  const w = stepLimit(from, axis, dir, length, items)
  return { to: { ...from, [axis]: from[axis] + BigInt(dir) * w.reach }, by: w.by }
}

describe('everything else is the plain step', () => {
  it('up and down, off a floor, past a tile, and on a flat floor, it is exactly stepLimit', () => {
    const items = [item(boxes('Floor', 'all', [FLOOR])), item(boxes('Wall', 'all', [[[-10, 0, 4.5], [10, 9, 5]]])), item(boxes('Ceiling', 'all', [[[-10, 6, -10], [10, 7, 10]]]))]
    const cases: Array<[Position, AxisName, 1 | -1, bigint]> = [
      [rel(0, 1, 0), 'y', 1, 1n], [rel(0, 1, 0), 'y', 1, 8n], [rel(0, 3, 0), 'y', -1, 4n],
      [rel(0, 3, 0), 'z', 1, 1n], [rel(0, 3, 0), 'z', 1, 8n], [rel(0, 1, 0), 'z', 1, 32n], [rel(0, 1, 0), 'x', -1, 64n],
      [rel(0, 1, 0), 'z', 1, 1n], [rel(0, 1, 0), 'z', 1, 2n], [rel(0, 1, 0), 'z', 1, 16n], [rel(0, 1, 0), 'x', 1, 8n], [rel(0, 1, 0), 'z', -1, 16n],
    ]
    for (const [from, axis, dir, length] of cases) {
      expect(walkStep(from, axis, dir, length, items)).toEqual(stepOf(from, axis, dir, length, items))
    }
  })
})

/** A kit piece read as the workshop imports it. */
const kit = (payload: unknown): ShardModel => fromPayload(payload as ShardPayload, 'x')!

/**
 * The two Maze Kit stairs, from the walker's line: the grand stair climbs
 * along -z at x 0 from its foot doorway (y -7, standing on the floor at -8,
 * z 8) to its head (y 9, z -8); the cascade's stair runs along +x's wall at x
 * 5, along +z, from the lower floor (z -7) to the platform (y 9, z 7).
 */
const STAIRS = [
  { name: 'grand stair', shard: () => kit(hallStairs), x: 0, dir: -1 as const, foot: -7, head: 9, z0: 8, z1: -8 },
  { name: 'aqueduct cascade', shard: () => kit(aqCascade), x: 5, dir: 1 as const, foot: -7, head: 9, z0: -7, z1: 7 },
]

describe('the Maze Kit stairs', () => {
  for (const st of STAIRS) {
    it(`${st.name}: up and down, one press per gibson, the same key every time`, () => {
      const items = [item(st.shard())]
      expect(st.shard().extra?.constrain ?? (st.shard() as { constrain?: string }).constrain).toBe('all')
      for (const [y0, y1, z0, z1] of [[st.foot, st.head, st.z0, st.z1], [st.head, st.foot, st.z1, st.z0]]) {
        let at = rel(st.x, y0, z0)
        expect(standing(at, items)).toBe(true)
        const dir = (z1 > z0 ? 1 : -1) as 1 | -1
        const presses = Math.abs(z1 - z0)
        for (let k = 0; k < presses; k++) {
          const s = walkStep(at, 'z', dir, 1n, items)
          // Every press goes one gibson along, rising or falling at most 2.
          expect(s.by).toBeNull()
          expect(Number(s.to.z - at.z)).toBe(dir)
          expect(Math.abs(Number(s.to.y - at.y))).toBeLessThanOrEqual(2)
          expect(standing(s.to, items)).toBe(true)
          at = s.to
        }
        expect(off(at)).toEqual([st.x, y1, z1])
      }
    })

    it(`${st.name}: a press of 2, 4 or 16 gibsons climbs it too, never stopping at the foot`, () => {
      const items = [item(st.shard())]
      for (const len of [2n, 4n, 16n]) {
        let at = rel(st.x, st.foot, st.z0)
        const dir = (st.z1 > st.z0 ? 1 : -1) as 1 | -1
        for (let k = 0; k < 16 && off(at)[2] !== st.z1; k++) at = walkStep(at, 'z', dir, len, items).to
        expect(off(at)).toEqual([st.x, st.head, st.z1])
      }
    })

    it(`${st.name}: without collision, the stair is walked straight through`, () => {
      const items = [item(withConstrain(st.shard(), 'off'))]
      const from = rel(st.x, st.foot, st.z0)
      const dir = (st.z1 > st.z0 ? 1 : -1) as 1 | -1
      const s = walkStep(from, 'z', dir, 4n, items)
      expect(s).toEqual({ to: { ...from, z: from.z + BigInt(dir) * 4n }, by: null })
    })
  }
})

describe('never into geometry', () => {
  it('a random walk among closed boxes never ends inside one', () => {
    // A seeded generator, so a failure repeats.
    let seed = 0x5eed
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000 }
    // Box sides on quarter gibsons, never on the whole gibsons a walker stands on.
    const q = (lo: number, hi: number): number => Math.floor(lo + rnd() * (hi - lo)) + [0.25, 0.5, 0.75][Math.floor(rnd() * 3)]
    let total = 0
    for (let world = 0; world < 6; world++) {
      clearWalls()
      // A floor with tall walls round it, so the walk stays among the blocks.
      const list: Array<[V3, V3]> = [
        [[-12.25, -1.5, -12.25], [12.25, -0.25, 12.25]],
        [[-13.25, -1.5, -13.25], [-12.25, 12.25, 13.25]], [[12.25, -1.5, -13.25], [13.25, 12.25, 13.25]],
        [[-12.25, -1.5, -13.25], [12.25, 12.25, -12.25]], [[-12.25, -1.5, 12.25], [12.25, 12.25, 13.25]],
      ]
      // Blocks standing on the floor, from a quarter gibson to 4 high (some
      // climbable, some walls), and slabs floating over them (ceilings, lintels).
      for (let b = 0; b < 40; b++) {
        const lo: V3 = [q(-12, 10), -0.5, q(-12, 10)]
        list.push([lo, [lo[0] + q(0, 3) + 0.25, q(0, 4), lo[2] + q(0, 3) + 0.25]])
      }
      for (let b = 0; b < 12; b++) {
        const lo: V3 = [q(-12, 10), q(1, 6), q(-12, 10)]
        list.push([lo, [lo[0] + q(0, 4) + 0.25, lo[1] + q(0, 2) + 0.25, lo[2] + q(0, 4) + 0.25]])
      }
      const items = [item(boxes('Maze', 'all', list))]
      const inside = (p: Position): boolean => {
        const [x, y, z] = off(p)
        return list.some(([lo, hi]) => x > lo[0] && x < hi[0] && y > lo[1] && y < hi[1] && z > lo[2] && z < hi[2])
      }
      let at = rel(0, 0, 0)
      for (let t = 0; t < 50 && inside(at); t++) at = rel(Math.floor(rnd() * 20) - 10, Math.floor(rnd() * 8), Math.floor(rnd() * 20) - 10)
      if (inside(at)) continue
      // Mostly level presses, a hop up now and then, and a long press down
      // that lands you back on whatever is under you.
      const moves: Array<[AxisName, 1 | -1, bigint | null]> = [['x', 1, null], ['x', -1, null], ['z', 1, null], ['z', -1, null], ['z', 1, null], ['x', 1, null], ['x', -1, null], ['z', -1, null], ['y', 1, 1n], ['y', -1, 16n]]
      let climbs = 0
      for (let k = 0; k < 600; k++) {
        const [axis, dir, fixed] = moves[Math.floor(rnd() * moves.length)]
        const len = fixed ?? [1n, 1n, 1n, 2n, 4n][Math.floor(rnd() * 5)]
        const s = walkStep(at, axis, dir, len, items)
        if (s.to.y > at.y && axis !== 'y') climbs++
        expect(inside(s.to)).toBe(false)
        // Along the press no further than it asked; up or down no more than 2 a gibson.
        expect((s.to[axis] - at[axis]) * BigInt(dir)).toBeLessThanOrEqual(len)
        if (axis !== 'y') expect(Math.abs(Number(s.to.y - at.y))).toBeLessThanOrEqual(2 * Number(len))
        else expect(s.to.x === at.x && s.to.z === at.z).toBe(true)
        at = s.to
      }
      total += climbs
    }
    // The walks did meet risers to climb.
    expect(total).toBeGreaterThan(50)
  })
})
