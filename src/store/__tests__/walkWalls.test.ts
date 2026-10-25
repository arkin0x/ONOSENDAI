/**
 * walkWalls.test.ts - stepLimit, the WALK step against placed shards, away
 * from the walk store: every axis and sign (the render frame flips Z), units
 * above 0, the region clip, turned and nested parts, a shard standing on the
 * Earth, a monument at a coarse unit pressed into again and again (review of
 * #461), and a part far finer than its parent.
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

import { newShard, type Ref, type ShardModel } from 'sno-core/shards'
import { primeRef } from '../../lib/parts'
import { withConstrain } from '../../lib/walkConstrain'
import type { AxisName, Position } from '../../lib/space'
import { WALL_BUDGET, clearWalls, stepLimit, wallBudgetLeft, warmWalls, type WallItem } from '../walkWalls'
import { useShards } from '../useShards'
import { toPayload } from 'sno-core/shards'

const AXES: AxisName[] = ['x', 'y', 'z']
const AT: Position = { x: 1n << 60n, y: 3n << 58n, z: 5n << 57n }

/** A square slab two ticks thick across `axis`, its near face `near` units out on side `dir`, `half` units each way. */
function slab(axis: AxisName, dir: 1 | -1, near: number, half = 2, unit = 0): ShardModel {
  const i = AXES.indexOf(axis)
  const j = (i + 1) % 3, k = (i + 2) % 3
  const verts: ShardModel['vertices'] = []
  for (const depth of [near * 120, near * 120 + 2]) for (const [a, b] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
    const t = [0, 0, 0]; t[i] = depth * dir; t[j] = a * 120; t[k] = b * 120
    const p = t.map((x) => Math.floor(x / 120)) as [number, number, number]
    const r = t.map((x, n) => x - p[n] * 120) as [number, number, number]
    verts.push(r.some((x) => x !== 0) ? { p, t: r, c: [1, 1, 1] } : { p, c: [1, 1, 1] })
  }
  const q = (a: number, b: number, c: number, e: number): number[][] => [[a, b, c], [a, c, e]]
  const faces = [...q(0, 1, 2, 3), ...q(4, 7, 6, 5), ...q(0, 4, 5, 1), ...q(1, 5, 6, 2), ...q(2, 6, 7, 3), ...q(3, 7, 4, 0)] as Array<[number, number, number]>
  return withConstrain({ ...newShard('Slab'), unit, mode: 'solid', vertices: verts, faces }, 'all')
}

const item = (shard: ShardModel, extra: Partial<WallItem> = {}): WallItem => ({ key: `k-${shard.id}-${Math.random()}`, at: { ...AT }, height: 84, plane: 1, shard, ...extra })

function walk(from: Position, axis: AxisName, dir: 1 | -1, step: bigint, items: WallItem[], presses: number): Position {
  let at = { ...from }
  for (let n = 0; n < presses; n++) {
    const r = stepLimit(at, axis, dir, step, items)
    at = { ...at, [axis]: at[axis] + BigInt(dir) * r.reach }
  }
  return at
}

beforeEach(() => clearWalls())

describe('stepLimit', () => {
  it('stops one gibson short on every axis and sign, at unit 0 and unit 2', () => {
    for (const unit of [0, 2]) for (const axis of AXES) for (const dir of [1, -1] as const) {
      clearWalls()
      const w = item(slab(axis, dir, 3, 2, unit))
      const end = walk(AT, axis, dir, 1n, [w], 40)
      const face = 3n << BigInt(unit)
      expect((end[axis] - AT[axis]) * BigInt(dir)).toBe(face - 1n)
      // The way back is free.
      expect(stepLimit(end, axis, -dir as 1 | -1, 1n, [w]).reach).toBe(1n)
    }
  })

  it('cuts a long step at the face, and lets a step beside the wall go', () => {
    const w = item(slab('z', -1, 3))
    expect(stepLimit(AT, 'z', -1, 1n << 10n, [w])).toMatchObject({ reach: 2n })
    const beside = { ...AT, x: AT.x + 5n }
    expect(stepLimit(beside, 'z', -1, 1n << 10n, [w]).reach).toBe(1n << 10n)
  })

  it('holds only inside the region its own faces are drawn in', () => {
    // At height 1 the region is the 2-gibson block holding AT: the face 3 out is outside it, so not drawn and not a wall.
    const w = item(slab('y', 1, 3), { height: 1 })
    expect(stepLimit(AT, 'y', 1, 10n, [w]).reach).toBe(10n)
  })

  it('a part turned a quarter, and a part of a part, hold where they are drawn', () => {
    const aRef: Ref = ['a', `33331:${'c'.repeat(64)}:slab-x`]
    const bRef: Ref = ['a', `33331:${'c'.repeat(64)}:holder`]
    // A wall across +X 3 out, turned a quarter about Y: it now stands across Z.
    primeRef(aRef, toPayload(slab('x', 1, 3)))
    const turned = withConstrain({ ...newShard('Turned'), mode: 'solid', vertices: [], faces: [], refs: [aRef], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 90, 0], step: 0 }] }, 'off')
    // The holder places that turned object again, 2 units up.
    primeRef(bRef, toPayload(turned))
    const nested = withConstrain({ ...newShard('Nested'), mode: 'solid', vertices: [], faces: [], refs: [bRef], parts: [{ ref: 0, at: [0, 240, 0], turn: [0, 0, 0], step: 0 }] }, 'off')
    return (async () => {
      const t = item(turned), n = item(nested)
      stepLimit(AT, 'x', 1, 1n, [t, n])
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => setTimeout(r, 0))
      // Along +X nothing holds now; along one Z way the turned wall does.
      expect(stepLimit(AT, 'x', 1, 10n, [t]).reach).toBe(10n)
      const zs = [stepLimit(AT, 'z', 1, 10n, [t]).reach, stepLimit(AT, 'z', -1, 10n, [t]).reach].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      expect(zs).toEqual([2n, 10n])
      // The nested copy, 2 up (stepLimit keeps only the shards it is given, so this one is resolved again).
      stepLimit(AT, 'x', 1, 1n, [n])
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => setTimeout(r, 0))
      // Held along Z from 2 up, free 3 below the walker's own height.
      const up2 = { ...AT, y: AT.y + 2n }
      const nz = [stepLimit(up2, 'z', 1, 10n, [n]).reach, stepLimit(up2, 'z', -1, 10n, [n]).reach].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      expect(nz).toEqual([2n, 10n])
      const low = { ...AT, y: AT.y - 3n }
      expect([stepLimit(low, 'z', 1, 10n, [n]).reach, stepLimit(low, 'z', -1, 10n, [n]).reach]).toEqual([10n, 10n])
    })()
  })

  it('a closed box standing on the Earth holds the walker inside it every way', () => {
    // A cube of half-side 3 turned by a pose holds a sphere of radius 3: every way out meets a face 3 to 5.2 gibsons away.
    const cube = (): ShardModel => {
      const v: ShardModel['vertices'] = []
      for (const x of [-3, 3]) for (const y of [-3, 3]) for (const z of [-3, 3]) v.push({ p: [x, y, z], c: [1, 1, 1] })
      const f = [[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]] as Array<[number, number, number]>
      return withConstrain({ ...newShard('Box'), mode: 'solid', vertices: v, faces: f, up: true, spin: 37 }, 'all')
    }
    const w = item(cube(), { plane: 0, at: { x: (1n << 84n) + (1n << 60n), y: (1n << 84n) + (3n << 58n), z: (1n << 84n) - (1n << 59n) } })
    for (const axis of AXES) for (const dir of [1, -1] as const) {
      const r = stepLimit(w.at, axis, dir, 100n, [w])
      expect(r.by).not.toBeNull()
      expect(Number(r.reach)).toBeGreaterThanOrEqual(2)
      expect(Number(r.reach)).toBeLessThanOrEqual(5)
    }
  })

  it('a monument at a coarse unit holds however often you press into it', () => {
    for (const unit of [48, 52, 53, 56, 70]) {
      clearWalls()
      const w = item(slab('x', 1, 3, 2, unit))
      // Starting a little short of the face, three presses of 2^40 gibsons.
      for (const short of [1n, 7n, 199n]) {
        const from = { ...AT, x: AT.x + (3n << BigInt(unit)) - short - (1n << 41n) }
        const end = walk(from, 'x', 1, 1n << 40n, [w], 3)
        expect(end.x - AT.x).toBeLessThan(3n << BigInt(unit))
      }
    }
  })

  it('a part far finer than its parent is still a wall', () => {
    const ref: Ref = ['a', `33331:${'d'.repeat(64)}:fine`]
    primeRef(ref, toPayload(slab('x', 1, 3, 2, 0)))
    return (async () => {
      for (const gap of [10, 18, 26]) {
        clearWalls()
        // The parent is at unit `gap`; the part keeps its own unit 0 (§1.10), so it is 2^gap times finer.
        const parent = withConstrain({ ...newShard('Coarse'), unit: gap, mode: 'solid', vertices: [], faces: [], refs: [ref], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }] }, 'off')
        const w = item(parent)
        stepLimit(AT, 'x', 1, 1n, [w])
        await new Promise((r) => setTimeout(r, 0))
        expect(stepLimit(AT, 'x', 1, 10n, [w]).reach).toBe(2n)
      }
    })()
  })
})

describe('what WALK resolves is bounded as a whole', () => {
  const ME = 'a'.repeat(64)
  const addr = (d: string): string => `33331:${ME}:${d}`
  // Four levels each placing the next 30 times, carried: 810,000 placements if nothing bounds them.
  const level = (name: string, next: string | null): Record<string, unknown> => ({
    ...toPayload({ ...newShard(name), mode: 'solid' }),
    ...(next ? { refs: [['a', addr(next)]], parts: Array.from({ length: 30 }, (_, i) => [0, i, 0, 0, 0, 0, 0, 0]) } : {}),
  })
  const heavy = (): ShardModel => ({
    ...slab('x', 1, 2),
    author: ME,
    refs: [['a', addr('b')]],
    parts: Array.from({ length: 30 }, (_, i) => ({ ref: 0, at: [0, i, 0] as [number, number, number], turn: [0, 0, 0] as [number, number, number], step: 0 })),
    objects: { [addr('b')]: level('b', 'c'), [addr('c')]: level('c', 'd'), [addr('d')]: level('d', 'e'), [addr('e')]: level('e', null) },
  })
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  it('a step that cannot enter a shard\'s region resolves nothing of it', async () => {
    warmWalls(1)
    const far = item(heavy(), { height: 4, at: { x: AT.x + (1n << 20n), y: AT.y, z: AT.z } })
    expect(stepLimit(AT, 'z', 1, 5n, [far]).reach).toBe(5n)
    await settle()
    expect(wallBudgetLeft()).toBe(WALL_BUDGET)
  })

  it('every shard around the walker shares one budget, nearest first', async () => {
    const shards = Array.from({ length: 6 }, (_, i) => item(heavy(), { key: `heavy-${i}`, at: { x: AT.x + BigInt(i), y: AT.y, z: AT.z } }))
    const world = useShards.getState().worldItems
    useShards.setState({ worldItems: () => shards.map((w) => ({ ...w, type: 'shard' as const })) as unknown as ReturnType<typeof world> })
    try {
      warmWalls(1, AT)
      for (let n = 0; n < 20 && wallBudgetLeft() > 0; n++) await settle()
      expect(wallBudgetLeft()).toBe(0)
      // A later step resolves nothing more than what is left.
      stepLimit(AT, 'y', 1, 3n, shards)
      await settle()
      expect(wallBudgetLeft()).toBe(0)
    } finally {
      useShards.setState({ worldItems: world })
    }
  })
})

describe('a starved shard fails closed, and no shard takes the whole budget (round-3 review)', () => {
  const ME = 'a'.repeat(64), THEM = 'b'.repeat(64)
  const at = (pk: string, d: string): string => `33331:${pk}:${d}`
  const place = (n: number, spread = 60): ShardModel['parts'] =>
    Array.from({ length: n }, (_, i) => ({ ref: 0, at: [(i % 100) * spread, 0, Math.floor(i / 100) * spread] as [number, number, number], turn: [0, 0, 0] as [number, number, number], step: 0 }))
  // The maze: its wall across -Z, carried, placed 3 out, so it needs the budget to stand (and its known box is out there, not around the walker).
  const maze = (): ShardModel => withConstrain({ ...newShard('Maze'), mode: 'solid', vertices: [], faces: [], author: ME, refs: [['a', at(ME, 'wall')]], parts: [{ ref: 0, at: [0, 0, -360], turn: [0, 0, 0], step: 0 }], objects: { [at(ME, 'wall')]: toPayload(slab('z', -1, 0)) } }, 'off')
  // Mallory's: four levels of 30 carried under her own key, 810,000 placements unbounded.
  const level = (pk: string, name: string, next: string | null): Record<string, unknown> => ({
    ...toPayload({ ...newShard(name), mode: 'solid' }),
    ...(next ? { refs: [['a', at(pk, next)]], parts: Array.from({ length: 30 }, (_, i) => [0, i, 0, 0, 0, 0, 0, 0]) } : {}),
  })
  const hostile = (): ShardModel => ({
    ...newShard('Hostile'), mode: 'solid', vertices: [], faces: [], author: THEM,
    refs: [['a', at(THEM, 'b')]], parts: Array.from({ length: 30 }, (_, i) => ({ ref: 0, at: [0, i * 120, 0] as [number, number, number], turn: [0, 0, 0] as [number, number, number], step: 0 })),
    objects: { [at(THEM, 'b')]: level(THEM, 'b', 'c'), [at(THEM, 'c')]: level(THEM, 'c', 'd'), [at(THEM, 'd')]: level(THEM, 'd', 'e'), [at(THEM, 'e')]: level(THEM, 'e', null) },
  })
  // A legitimate floor of 5,000 tiles, five units below the walker.
  const floor = (): ShardModel => withConstrain({ ...newShard('Floor'), mode: 'solid', vertices: [], faces: [], author: ME, refs: [['a', at(ME, 'tile')]], parts: place(5000), objects: { [at(ME, 'tile')]: toPayload(slab('y', 1, 0, 1)) } }, 'off')
  const below = { ...AT, y: AT.y - 5n }
  const settleAll = async (): Promise<void> => { for (let n = 0; n < 30; n++) await new Promise((r) => setTimeout(r, 0)) }
  const withWorld = async (items: WallItem[], run: () => Promise<void>): Promise<void> => {
    const world = useShards.getState().worldItems
    useShards.setState({ worldItems: () => items.map((w) => ({ ...w, type: 'shard' as const })) as unknown as ReturnType<typeof world> })
    try { await run() } finally { useShards.setState({ worldItems: world }) }
  }
  const towardWall = (items: WallItem[]): bigint => stepLimit(AT, 'z', -1, 1n << 10n, items).reach

  it('a hostile shard nearer the walker cannot take the maze wall down, this WALK or the next, or once it is gone', async () => {
    const h = item(hostile(), { key: 'hostile' })
    const m = item(maze(), { key: 'maze' })
    await withWorld([h, m], async () => {
      warmWalls(1, AT)
      await settleAll()
      expect(towardWall([h, m])).toBe(2n)
      // The next WALK.
      warmWalls(1, AT)
      await settleAll()
      expect(towardWall([h, m])).toBe(2n)
    })
    // The hostile shard gone.
    await withWorld([m], async () => {
      warmWalls(1, AT)
      await settleAll()
      expect(towardWall([m])).toBe(2n)
    })
  })

  it('four 5,000-tile floors resolved first leave the maze its share', async () => {
    const floors = [0, 1, 2, 3].map((i) => item(floor(), { key: `floor-${i}`, at: below }))
    const m = item(maze(), { key: 'maze' })
    await withWorld([...floors, m], async () => {
      warmWalls(1, AT)
      await settleAll()
      expect(towardWall([...floors, m])).toBe(2n)
    })
  })

  it('when the whole budget is spent before the maze, it fails closed: the walker is still held', async () => {
    const hs = [0, 1, 2, 3, 4, 5].map((i) => item(hostile(), { key: `hostile-${i}` }))
    const m = item(maze(), { key: 'maze' })
    await withWorld([...hs, m], async () => {
      warmWalls(1, AT)
      await settleAll()
      expect(towardWall([...hs, m])).toBeLessThanOrEqual(2n)
      // Once they are gone, the next WALK builds the maze whole: its own wall again.
    })
    await withWorld([m], async () => {
      warmWalls(1, AT)
      await settleAll()
      expect(towardWall([m])).toBe(2n)
    })
  })
})

