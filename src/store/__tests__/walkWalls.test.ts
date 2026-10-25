/**
 * walkWalls.test.ts - stepLimit, the WALK step against placed shards, away
 * from the walk store: every axis and sign (the render frame flips Z), units
 * above 0, the region clip, turned and nested parts, a shard standing on the
 * Earth, a monument at a coarse unit pressed into again and again (review of
 * #461), and a part far finer than its parent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

// A resolve that never lands, when asked: to show a wait is let go (wallsBuilt).
const hang = vi.hoisted(() => ({ on: false, calls: new Map<string, number>() }))
vi.mock('../../lib/parts', async (orig) => {
  const mod = await orig<typeof import('../../lib/parts')>()
  return { ...mod, resolvePartsShared: (...args: Parameters<typeof mod.resolvePartsShared>) => {
    // How often each shard (by name) is resolved: to show what is built again, and when.
    hang.calls.set(args[0].name, (hang.calls.get(args[0].name) ?? 0) + 1)
    return hang.on ? new Promise<never>(() => {}) : mod.resolvePartsShared(...args)
  } }
})

// WALK reads your follows; here from `contacts.read`, never a relay.
const contacts = vi.hoisted(() => ({ read: async (_pubkey: string): Promise<string[]> => [] }))
vi.mock('../../lib/contacts', () => ({ GENERAL_RELAYS: [], followsOf: (pk: string) => contacts.read(pk), fetchContacts: async () => [] }))

import { newShard, type Ref, type ShardModel } from 'sno-core/shards'
import { primeRef } from '../../lib/parts'
import { withConstrain } from '../../lib/walkConstrain'
import type { AxisName, Position } from '../../lib/space'
import { STRANGER_BUDGET, STRANGER_READS, STRANGER_SHARD_READS, TRUSTED_BUDGET, TRUSTED_READS, WALL_WAIT_MS, clearWalls, setWallFollows, stepLimit, takeWallWait, wallBudgetLeft, wallReadsLeft, wallsBuilt, warmWalls, type WallItem } from '../walkWalls'
import { MAX_MODELS } from 'sno-core/parts'
import { setLocalAuthor } from '../../lib/carried'
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

describe("WALK's walls are built by trust (arkinox 2026-10-25: \"ok A sounds good\")", () => {
  const ME = 'a'.repeat(64), THEM = 'b'.repeat(64), FRIEND = 'c'.repeat(64)
  const at = (pk: string, d: string): string => `33331:${pk}:${d}`
  // A maze: its wall across -Z, carried, placed 3 out, so it needs the budget to stand.
  const maze = (pk: string): ShardModel => withConstrain({ ...newShard('Maze'), mode: 'solid', vertices: [], faces: [], author: pk, refs: [['a', at(pk, 'wall')]], parts: [{ ref: 0, at: [0, 0, -360], turn: [0, 0, 0], step: 0 }], objects: { [at(pk, 'wall')]: toPayload(slab('z', -1, 0)) } }, 'off')
  // Four levels of 30, carried under the author's own key: 810,000 placements unbounded.
  const level = (pk: string, name: string, next: string | null): Record<string, unknown> => ({
    ...toPayload({ ...newShard(name), mode: 'solid' }),
    ...(next ? { refs: [['a', at(pk, next)]], parts: Array.from({ length: 30 }, (_, i) => [0, i, 0, 0, 0, 0, 0, 0]) } : {}),
  })
  const heavy = (pk: string): ShardModel => ({
    ...newShard('Heavy'), mode: 'solid', vertices: [], faces: [], author: pk,
    refs: [['a', at(pk, 'b')]], parts: Array.from({ length: 30 }, (_, i) => ({ ref: 0, at: [0, i * 120, 0] as [number, number, number], turn: [0, 0, 0] as [number, number, number], step: 0 })),
    objects: { [at(pk, 'b')]: level(pk, 'b', 'c'), [at(pk, 'c')]: level(pk, 'c', 'd'), [at(pk, 'd')]: level(pk, 'd', 'e'), [at(pk, 'e')]: level(pk, 'e', null) },
  })
  const settleAll = async (): Promise<void> => { for (let n = 0; n < 40; n++) await new Promise((r) => setTimeout(r, 0)) }
  const withWorld = async (items: WallItem[], run: () => Promise<void>): Promise<void> => {
    const world = useShards.getState().worldItems
    useShards.setState({ worldItems: () => items.map((w) => ({ ...w, type: 'shard' as const })) as unknown as ReturnType<typeof world> })
    try { await run() } finally { useShards.setState({ worldItems: world }) }
  }
  const towardWall = (items: WallItem[]): bigint => stepLimit(AT, 'z', -1, 1n << 10n, items).reach
  beforeEach(() => { setLocalAuthor(() => ME); contacts.read = async () => [] })
  afterEach(() => setLocalAuthor(null))

  it('a step that cannot enter a shard\'s region resolves nothing of it', async () => {
    warmWalls(1)
    const far = item(heavy(THEM), { author: THEM, height: 4, at: { x: AT.x + (1n << 20n), y: AT.y, z: AT.z } })
    expect(stepLimit(AT, 'z', 1, 5n, [far]).reach).toBe(5n)
    await settleAll()
    expect(wallBudgetLeft('stranger')).toBe(STRANGER_BUDGET)
  })

  it('five hostile strangers nearer the walker never starve your maze, this WALK, the next, or once they are gone', async () => {
    const hs = [0, 1, 2, 3, 4].map((i) => item(heavy(THEM), { key: `hostile-${i}`, author: THEM }))
    const m = item(maze(ME), { key: 'maze', mine: true, author: ME })
    await withWorld([...hs, m], async () => {
      warmWalls(1, AT)
      await settleAll()
      expect(wallBudgetLeft('stranger')).toBe(0)
      expect(towardWall([...hs, m])).toBe(2n)
      warmWalls(1, AT)
      await settleAll()
      expect(towardWall([...hs, m])).toBe(2n)
    })
    await withWorld([m], async () => {
      warmWalls(1, AT)
      await settleAll()
      expect(towardWall([m])).toBe(2n)
    })
  })

  it("a followed author's maze is built from your share; a stranger's starved one is walkable", async () => {
    const hs = [0, 1, 2, 3, 4].map((i) => item(heavy(THEM), { key: `hostile-${i}`, author: THEM }))
    const friends = item(maze(FRIEND), { key: 'friend', author: FRIEND })
    // Not yet followed: a stranger, after five strangers spent the strangers' share: walkable.
    await withWorld([...hs, friends], async () => {
      warmWalls(1, AT)
      await settleAll()
      expect(towardWall([...hs, friends])).toBe(1n << 10n)
      // Followed: built again from the trusted share, at once.
      setWallFollows([FRIEND])
      await settleAll()
      expect(towardWall([...hs, friends])).toBe(2n)
    })
  })

  it('your own shards beyond the reserved share degrade nearest first, and come back when it does', async () => {
    // Three of your own heavy shards farther off take the whole trusted share (20,000 each); the maze is nearest.
    const own = [1, 2, 3, 4].map((i) => item(heavy(ME), { key: `own-${i}`, mine: true, author: ME, at: { x: AT.x + BigInt(100 * i), y: AT.y, z: AT.z } }))
    const m = item(maze(ME), { key: 'maze', mine: true, author: ME })
    await withWorld([...own, m], async () => {
      warmWalls(1, AT)
      await settleAll()
      expect(wallBudgetLeft('trusted')).toBe(0)
      expect(towardWall([...own, m])).toBe(2n)
    })
    // Nearer ones first: three heavy shards of yours at the walker take the whole share, and a maze of
    // yours 15 units off (its wall 40 units wide, across the walker's path) waits, walkable.
    const wide = (): ShardModel => withConstrain({ ...maze(ME), objects: { [at(ME, 'wall')]: toPayload(slab('z', -1, 0, 20)) } }, 'off')
    const nearer = [1, 2, 3].map((i) => item(heavy(ME), { key: `near-${i}`, mine: true, author: ME }))
    const far = item(wide(), { key: 'far-maze', mine: true, author: ME, at: { ...AT, x: AT.x + 15n } })
    await withWorld([...nearer, far], async () => {
      warmWalls(1, AT)
      await settleAll()
      expect(wallBudgetLeft('trusted')).toBe(0)
      expect(towardWall([...nearer, far])).toBe(1n << 10n)
    })
    // The next WALK, with them gone: built, and it holds.
    await withWorld([far], async () => {
      warmWalls(1, AT)
      await settleAll()
      expect(towardWall([far])).toBe(2n)
    })
  })

  it("a LIVE LINK in your own bag is charged to the stranger whose object it draws (F2)", async () => {
    // Three links in your bag, each drawing a stranger's object grown huge: they cannot spend your share.
    const links = [0, 1, 2].map((i) => item(heavy(THEM), { key: `link-${i}`, mine: true, author: ME }))
    const m = item(maze(ME), { key: 'maze', mine: true, author: ME })
    await withWorld([...links, m], async () => {
      warmWalls(1, AT)
      await settleAll()
      expect(wallBudgetLeft('trusted')).toBeGreaterThanOrEqual(TRUSTED_BUDGET - 1)
      expect(towardWall([...links, m])).toBe(2n)
    })
  })

  it("a stranger's bag of live links to your own object is charged to the stranger (review of #511)", async () => {
    // Three links in a stranger's bag, each drawing your own object grown huge: they cannot spend your share.
    const links = [0, 1, 2].map((i) => item(heavy(ME), { key: `their-link-${i}`, author: THEM }))
    const m = item(maze(ME), { key: 'maze', mine: true, author: ME })
    await withWorld([...links, m], async () => {
      warmWalls(1, AT)
      await settleAll()
      expect(wallBudgetLeft('trusted')).toBeGreaterThanOrEqual(TRUSTED_BUDGET - 1)
      expect(towardWall([...links, m])).toBe(2n)
    })
  })

  it("a shard of yours placing a stranger's object charges that child to the strangers' pool, never your share", async () => {
    // A stranger's huge object, published (fetched by its address, its own table under its author).
    const theirsRef: Ref = ['a', at(THEM, 'b')]
    primeRef(theirsRef, { ...level(THEM, 'b', 'c'), objects: { [at(THEM, 'c')]: level(THEM, 'c', 'd'), [at(THEM, 'd')]: level(THEM, 'd', 'e'), [at(THEM, 'e')]: level(THEM, 'e', null) } })
    // Three shards of yours, each placing it 30 times.
    const placers = [0, 1, 2].map((i) => item(withConstrain({ ...newShard('Placer'), mode: 'solid', vertices: [], faces: [], author: ME, refs: [theirsRef], parts: Array.from({ length: 30 }, (_, k) => ({ ref: 0, at: [0, k * 120, 0] as [number, number, number], turn: [0, 0, 0] as [number, number, number], step: 0 })) }, 'off'), { key: `placer-${i}`, mine: true, author: ME }))
    const m = item(maze(ME), { key: 'maze', mine: true, author: ME })
    await withWorld([...placers, m], async () => {
      warmWalls(1, AT)
      await settleAll()
      // Your share paid only for your own placements (30 each and the maze's one); the strangers' paid for theirs.
      expect(TRUSTED_BUDGET - wallBudgetLeft('trusted')).toBeLessThanOrEqual(3 * 30 + 1)
      expect(towardWall([...placers, m])).toBe(2n)
    })
  })

  it("a shard of yours placing only your own pieces takes nothing from the strangers' pool", async () => {
    const m = item(maze(ME), { key: 'maze', mine: true, author: ME })
    await withWorld([m], async () => {
      warmWalls(1, AT)
      await settleAll()
      expect(wallBudgetLeft('stranger')).toBe(STRANGER_BUDGET)
    })
  })

  it('a share still out when the next WALK starts is never refunded into it', async () => {
    // A shard of yours whose one part comes from a slow relay.
    const slowRef: Ref = ['a', at(ME, 'slow-part')]
    let release: (p: unknown) => void = () => {}
    primeRef(slowRef, new Promise((r) => { release = r }))
    const slow = item(withConstrain({ ...newShard('Slow'), mode: 'solid', vertices: [], faces: [], author: ME, refs: [slowRef], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }] }, 'off'), { key: 'slow', mine: true, author: ME })
    await withWorld([slow], async () => {
      warmWalls(1, AT)
      await settleAll()
      warmWalls(1, AT)
      release(toPayload(slab('z', -1, 3)))
      await settleAll()
      expect(wallBudgetLeft('trusted')).toBeLessThanOrEqual(TRUSTED_BUDGET)
    })
  })

  it('a kind 3 read that failed is asked again at the next WALK', async () => {
    const hs = [0, 1, 2, 3, 4].map((i) => item(heavy(THEM), { key: `hostile-${i}`, author: THEM }))
    const friends = item(maze(FRIEND), { key: 'friend', author: FRIEND })
    contacts.read = async () => { throw new Error('no relay answered') }
    await withWorld([...hs, friends], async () => {
      warmWalls(1, AT)
      await settleAll()
      expect(towardWall([...hs, friends])).toBe(1n << 10n)
      contacts.read = async () => [FRIEND]
      warmWalls(1, AT)
      await settleAll()
      expect(towardWall([...hs, friends])).toBe(2n)
    })
  })

  it('a step never passes a shard whose first build has not landed: it waits, and then the wall holds (Q, Q2)', async () => {
    // Q: twelve mazes of yours in the region, the step into the twelfth right after entering WALK.
    const mazes = Array.from({ length: 12 }, (_, i) => item(maze(ME), { key: `maze-${i}`, mine: true, author: ME, at: { ...AT, x: AT.x + BigInt(i * 1000) } }))
    const walker = { ...AT, x: AT.x + 11_000n }
    await withWorld(mazes, async () => {
      warmWalls(1, AT)
      takeWallWait()
      expect(stepLimit(walker, 'z', -1, 1n << 10n, mazes).reach).toBe(0n)
      expect(takeWallWait()).toBe(true)
      await wallsBuilt()
      expect(stepLimit(walker, 'z', -1, 1n << 10n, mazes).reach).toBe(2n)
      expect(takeWallWait()).toBe(false)
    })
    // Q2: the first step ever to reach a maze, with no WALK entry before it.
    clearWalls()
    const m = item(maze(ME), { key: 'first', mine: true, author: ME })
    expect(stepLimit(AT, 'z', -1, 1n << 10n, [m]).reach).toBe(0n)
    await wallsBuilt()
    expect(stepLimit(AT, 'z', -1, 1n << 10n, [m]).reach).toBe(2n)
  })

  it('a shard whose parts need a relay does not hold the step: its own faces stand meanwhile', async () => {
    const away: Ref = ['a', at(THEM, 'not-carried')]
    const fetched = item(withConstrain({ ...slab('z', -1, 3), author: ME, refs: [away], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }] }, 'all'), { key: 'own-faces', mine: true, author: ME })
    // The first build is from what is in hand, which lands in the task; the relay comes after.
    stepLimit(AT, 'z', -1, 1n << 10n, [fetched])
    await wallsBuilt()
    expect(stepLimit(AT, 'z', -1, 1n << 10n, [fetched]).reach).toBe(2n)
  })

  it('one step among forty mazes stays within the reserved share, and every one of them holds once built', async () => {
    const mazes = Array.from({ length: 40 }, (_, i) => item(maze(ME), { key: `m-${i}`, mine: true, author: ME, at: { ...AT, x: AT.x + BigInt(i * 1000) } }))
    stepLimit(AT, 'z', -1, 1n << 10n, mazes)
    expect(wallBudgetLeft('trusted')).toBeGreaterThanOrEqual(0)
    await wallsBuilt()
    expect(wallBudgetLeft('trusted')).toBeLessThanOrEqual(TRUSTED_BUDGET)
    for (const i of [0, 17, 39]) expect(stepLimit({ ...AT, x: AT.x + BigInt(i * 1000) }, 'z', -1, 1n << 10n, mazes).reach).toBe(2n)
  })

  it('first builds waiting in a pool are settled when the shares come back, even from entries taken away meanwhile', async () => {
    // Six strangers take the strangers' share (five at 4,000) with the sixth waiting; a second step
    // in the same task, over other shards, takes their entries away and makes a stranger's maze wait too.
    const hs = [0, 1, 2, 3, 4, 5].map((i) => item(heavy(THEM), { key: `h-${i}`, author: THEM }))
    const theirs = item(maze(THEM), { key: 'their-maze', author: THEM })
    stepLimit(AT, 'z', -1, 1n << 10n, hs)
    stepLimit(AT, 'z', -1, 1n << 10n, [theirs])
    // Resolved by the shares coming back, well before the wait would be let go.
    const t0 = Date.now()
    await wallsBuilt()
    expect(Date.now() - t0).toBeLessThan(WALL_WAIT_MS / 2)
    // Settled: the strangers' share was spent, so it is walkable, and nothing waits on it any more.
    takeWallWait()
    stepLimit(AT, 'z', -1, 1n << 10n, [theirs])
    expect(takeWallWait()).toBe(false)
  })

  it('a wait for walls is let go after WALL_WAIT_MS, so input never hangs', async () => {
    hang.on = true
    try {
      const m = item(maze(ME), { key: 'never', mine: true, author: ME })
      expect(stepLimit(AT, 'z', -1, 1n << 10n, [m]).reach).toBe(0n)
      const t0 = Date.now()
      await wallsBuilt()
      expect(Date.now() - t0).toBeGreaterThanOrEqual(WALL_WAIT_MS - 20)
      expect(Date.now() - t0).toBeLessThan(WALL_WAIT_MS * 8)
    } finally {
      hang.on = false
    }
  })


  // A shard by `pk` placing `n` different objects of its own, carried, then (when `wall`) the maze's wall.
  const wide = (pk: string, name: string, n: number, wall = false): ShardModel => {
    const objects: Record<string, unknown> = {}
    const refs: Ref[] = []
    for (let i = 0; i < n; i++) { const a = at(pk, `${name}-${i}`); objects[a] = toPayload({ ...newShard(`p${i}`), mode: 'solid' }); refs.push(['a', a]) }
    if (wall) { objects[at(pk, 'wall')] = toPayload(slab('z', -1, 0)); refs.push(['a', at(pk, 'wall')]) }
    return withConstrain({ ...newShard(name), mode: 'solid', vertices: [], faces: [], author: pk, refs, objects,
      parts: refs.map((_, i) => ({ ref: i, at: (wall && i === n ? [0, 0, -360] : [0, 0, 0]) as [number, number, number], turn: [0, 0, 0] as [number, number, number], step: 0 })) }, 'off')
  }

  it("strangers read no more than STRANGER_SHARD_READS a shard and STRANGER_READS a WALK, and your maze stands", async () => {
    const hs = [0, 1, 2, 3, 4, 5].map((i) => item(wide(THEM, `Many${i}`, 300), { key: `many-${i}`, author: THEM }))
    const m = item(maze(ME), { key: 'maze', mine: true, author: ME })
    await withWorld([...hs, m], async () => {
      warmWalls(1, AT)
      await settleAll()
      // Six shards wanting 300 each: 200 each at most, 1,000 between them.
      expect(STRANGER_SHARD_READS).toBe(MAX_MODELS / 5)
      expect(wallReadsLeft('stranger')).toBe(0)
      // The WALK's one bound over both pools counts every read: theirs, and the maze's wall.
      expect(wallReadsLeft()).toBe(TRUSTED_READS + STRANGER_READS - STRANGER_READS - 1)
      expect(towardWall([...hs, m])).toBe(2n)
    })
  })

  it("a placement cut for reads ('objects') is walkable, is not built again when placement budget comes back, and is at the next WALK", async () => {
    // Your shard placing MAX_MODELS different pieces before its wall: the wall is one read too many.
    const crowd = item(wide(ME, 'Crowd', MAX_MODELS, true), { key: 'crowd', mine: true, author: ME })
    const m = item(maze(ME), { key: 'maze', mine: true, author: ME })
    hang.calls.clear()
    await withWorld([crowd], async () => {
      warmWalls(1, AT)
      await settleAll()
      expect(towardWall([crowd])).toBe(1n << 10n)
      expect(hang.calls.get('Crowd')).toBe(1)
    })
    // Another of yours lands and gives its share back: the crowd is not built again for it.
    await withWorld([crowd, m], async () => {
      stepLimit(AT, 'z', -1, 1n << 10n, [crowd, m])
      await settleAll()
      expect(hang.calls.get('Maze')).toBe(1)
      expect(hang.calls.get('Crowd')).toBe(1)
      // The next WALK builds it again, once.
      warmWalls(1, AT)
      await settleAll()
      expect(hang.calls.get('Crowd')).toBe(2)
    })
  })

  it('a resolve that reaches sno-core MAX_NODES is built again at the next WALK, and never spins within one', async () => {
    // 18,000 of your rooms, each placing a stranger's object that places one more of theirs: the
    // strangers' share runs out and its placeholders fill sno-core's node ceiling.
    const xRef: Ref = ['a', at(THEM, 'x')]
    primeRef(xRef, { ...toPayload({ ...newShard('x'), mode: 'solid' }), refs: [['a', at(THEM, 'y')]], parts: [[0, 0, 0, 0, 0, 0, 0, 0]], objects: { [at(THEM, 'y')]: toPayload({ ...newShard('y'), mode: 'solid' }) } })
    const room = { ...toPayload({ ...newShard('room'), mode: 'solid' }), refs: [xRef], parts: [[0, 0, 0, 0, 0, 0, 0, 0]] }
    const rooms = item(withConstrain({ ...newShard('Rooms'), mode: 'solid', vertices: [], faces: [], author: ME, refs: [['a', at(ME, 'room')]], objects: { [at(ME, 'room')]: room },
      parts: Array.from({ length: 18_000 }, (_, i) => ({ ref: 0, at: [0, i % 1000, 0] as [number, number, number], turn: [0, 0, 0] as [number, number, number], step: 0 })) }, 'off'), { key: 'rooms', mine: true, author: ME })
    const m = item(maze(ME), { key: 'maze', mine: true, author: ME })
    hang.calls.clear()
    await withWorld([rooms, m], async () => {
      warmWalls(1, AT)
      await settleAll()
      // Its first build: the quick pass from what is in hand, then the relays for what was not.
      const first = hang.calls.get('Rooms') ?? 0
      expect(first).toBeGreaterThan(0)
      stepLimit(AT, 'z', -1, 1n << 10n, [rooms, m])
      await settleAll()
      expect(hang.calls.get('Rooms')).toBe(first)
      expect(towardWall([rooms, m])).toBe(2n)
      warmWalls(1, AT)
      await settleAll()
      expect(hang.calls.get('Rooms')).toBe(first + 1)
    })
  })

})
