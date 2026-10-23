/**
 * walkConstrain.test.ts - a shard set to constrain WALK holds the walker
 * (DECK-0003 §1.12): ALL refuses a step across any face, OPAQUE lets a
 * see-through wall be crossed, OFF is the walk as it always was, HOP is never
 * held, a long step stops on the last gibson short of the face, and an
 * object placed by reference holds by its own setting. Also: the workshop
 * sets it undoably, and a deploy or EDIT writes it into what is hidden.
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

vi.mock('../../lib/workers', () => ({
  postProof: vi.fn(),
  cancelProof: vi.fn(),
  setProofHandler: vi.fn(),
}))
vi.mock('../../lib/calibration', async (orig) => {
  const mod = await orig<typeof import('../../lib/calibration')>()
  return { ...mod, recommendedHopHeight: () => 20 }
})
vi.mock('../../lib/relay', async (orig) => {
  const mod = await orig<typeof import('../../lib/relay')>()
  return { ...mod, publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []) }
})

import { newShard, toPayload, type Ref, type ShardModel, type ShardPayload } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { useWalk } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { useToast } from '../useToast'
import { clearWalls } from '../walkWalls'
import { moveDirection } from '../../lib/moves'
import { primeRef } from '../../lib/parts'
import { constrainOf, withConstrain, type Constrain } from '../../lib/walkConstrain'
import type { AxisName, Position } from '../../lib/space'

/** Which axis and way 'right' steps in this view. */
function rightward(): { axis: AxisName; dir: 1 | -1 } {
  const s = useCyberspace.getState()
  const d = moveDirection(s.screenAxes ?? s.axes(), 'right')
  return { axis: d.axis, dir: d.dir > 0 ? 1 : -1 }
}

/**
 * A square wall across the 'right' way, `at` gibsons from the walker, two
 * gibsons on a side. Model axes are cyberspace axes (sno-core ticks), at unit 0.
 */
function wallAcross(at: number, extra: Partial<ShardModel> = {}, c: Constrain = 'all'): ShardModel {
  const { axis, dir } = rightward()
  const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  const j = (i + 1) % 3, k = (i + 2) % 3
  const corner = (a: number, b: number): [number, number, number] => {
    const p: [number, number, number] = [0, 0, 0]
    p[i] = at * dir; p[j] = a; p[k] = b
    return p
  }
  const s: ShardModel = {
    ...newShard('Wall'),
    mode: 'solid',
    vertices: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].map((p) => ({ p, c: [1, 1, 1] as [number, number, number] })),
    faces: [[0, 1, 2], [0, 2, 3]],
    ...extra,
  }
  return withConstrain(s, c)
}

/** The world holds exactly these shards, standing where the walker started. */
function world(start: Position, ...shards: ShardModel[]): void {
  const items: WorldItem[] = shards.map((shard, n) => ({ key: `w${n}-${shard.id}`, type: 'shard', at: { ...start }, plane: useCyberspace.getState().plane as WorldItem['plane'], height: 40, mine: false, shard }))
  useShards.setState({ worldItems: () => items })
}

/** How far the walker's view is from where it started, along 'right'. */
function along(start: Position): number {
  const { axis, dir } = rightward()
  return Number(useCyberspace.getState().cursor[axis] - start[axis]) * dir
}

const worldItemsOriginal = useShards.getState().worldItems

describe('WALK and a shard that constrains it', () => {
  let start: Position
  beforeEach(async () => {
    useWalk.getState().exit()
    useShards.setState({ worldItems: worldItemsOriginal })
    clearWalls()
    useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode: 'off' }, scaleExp: 0 })
    await useCyberspace.getState().respawn()
    useCyberspace.getState().cancel()
    useToast.setState({ toast: null })
    start = { ...useCyberspace.getState().position }
  })

  it('ALL: a step across the wall is refused; you stand a gibson short of it', () => {
    world(start, wallAcross(3, {}, 'all'))
    useWalk.getState().enter()
    for (let n = 0; n < 5; n++) useWalk.getState().press('right')
    expect(along(start)).toBe(2)
    expect(useToast.getState().toast?.label).toBe('WALL')
    // The way back is free.
    useWalk.getState().press('left')
    expect(along(start)).toBe(1)
  })

  it('OPAQUE: a see-through wall is crossed, a solid opaque one is not', () => {
    world(start, wallAcross(3, { opacity: 50 }, 'opaque'))
    useWalk.getState().enter()
    for (let n = 0; n < 5; n++) useWalk.getState().press('right')
    expect(along(start)).toBe(5)

    useWalk.getState().exit()
    world(start, wallAcross(3, { mode: 'lines' }, 'opaque'))
    useCyberspace.setState({ cursor: { ...useCyberspace.getState().position } })
    useWalk.getState().enter()
    for (let n = 0; n < 5; n++) useWalk.getState().press('right')
    expect(along(start)).toBe(5)

    useWalk.getState().exit()
    world(start, wallAcross(3, {}, 'opaque'))
    useWalk.getState().enter()
    for (let n = 0; n < 5; n++) useWalk.getState().press('right')
    expect(along(start)).toBe(2)
  })

  it('OFF: the walk is as it always was', () => {
    world(start, wallAcross(3, {}, 'off'))
    useWalk.getState().enter()
    for (let n = 0; n < 5; n++) useWalk.getState().press('right')
    expect(along(start)).toBe(5)
    expect(useToast.getState().toast).toBeNull()
  })

  it('a long step stops on the last gibson short of the face, and one with no room does not go', () => {
    world(start, wallAcross(3, {}, 'all'))
    useCyberspace.setState({ scaleExp: 3 })
    useWalk.getState().enter()
    useWalk.getState().press('right')
    expect(along(start)).toBe(2)
    useWalk.getState().press('right')
    expect(along(start)).toBe(2)
  })

  it('HOP is never held: the cursor goes through', () => {
    world(start, wallAcross(3, {}, 'all'))
    const s = useCyberspace.getState()
    const dir = moveDirection(s.screenAxes ?? s.axes(), 'right')
    for (let n = 0; n < 5; n++) useCyberspace.getState().moveCursor(dir)
    expect(useCyberspace.getState().walking).toBe(false)
    expect(along(start)).toBe(5)
  })

  it('a wall placed by reference holds by its own setting, not its parent\'s', async () => {
    const ref: Ref = ['a', `33331:${'b'.repeat(64)}:walk-wall`]
    const room = (c: Constrain): ShardModel => withConstrain({ ...newShard('Room'), mode: 'solid', vertices: [], faces: [], refs: [ref], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }] }, c)

    // The part is ALL, its parent off: held.
    primeRef(ref, toPayload(wallAcross(3, {}, 'all')))
    world(start, room('off'))
    useWalk.getState().enter()
    useWalk.getState().press('right')
    // Its parts resolve in the background, as the scene's do.
    await new Promise((r) => setTimeout(r, 0))
    for (let n = 0; n < 4; n++) useWalk.getState().press('right')
    expect(along(start)).toBe(2)

    // The part is off, its parent ALL: through it, as far as a second part
    // set to ALL further on, which proves the parts did resolve.
    useWalk.getState().exit()
    clearWalls()
    const ref2: Ref = ['a', `33331:${'b'.repeat(64)}:walk-water`]
    const ref3: Ref = ['a', `33331:${'b'.repeat(64)}:walk-far-wall`]
    primeRef(ref2, toPayload(wallAcross(3, { opacity: 40 }, 'off')))
    primeRef(ref3, toPayload(wallAcross(6, {}, 'all')))
    const both = withConstrain({ ...newShard('Pool'), mode: 'solid', vertices: [], faces: [], refs: [ref2, ref3], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }, { ref: 1, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }] }, 'all')
    world(start, both)
    useCyberspace.setState({ cursor: { ...useCyberspace.getState().position } })
    useWalk.getState().enter()
    await new Promise((r) => setTimeout(r, 0))
    for (let n = 0; n < 8; n++) useWalk.getState().press('right')
    expect(along(start)).toBe(5)
  })

  it('a held key shows one WALL chip, not one a press', () => {
    world(start, wallAcross(1, {}, 'all'))
    useWalk.getState().enter()
    useWalk.getState().press('right')
    const first = useToast.getState().toast
    expect(first?.label).toBe('WALL')
    useWalk.getState().press('right')
    useWalk.getState().press('right')
    expect(useToast.getState().toast).toBe(first)
  })
})

describe('setting it', () => {
  beforeEach(() => {
    const s: ShardModel = { ...newShard('Wall'), mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 1, 0], c: [1, 1, 1] }], faces: [[0, 1, 2]] }
    useWorkshop.setState({ shards: [s], currentId: s.id, past: [], future: [], selection: [], partSel: [] })
    useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null, worldItems: worldItemsOriginal })
    useCyberspace.setState({ live: false })
  })

  it('the workshop sets it, undoably, and OFF writes nothing', () => {
    const w = useWorkshop.getState()
    w.setConstrain('opaque')
    expect(constrainOf(useWorkshop.getState().current()!)).toBe('opaque')
    expect(toPayload(useWorkshop.getState().current()!)).toHaveProperty('constrain', 'opaque')
    useWorkshop.getState().undo()
    expect(useWorkshop.getState().current()).not.toHaveProperty('extra')
    // The same setting again is no edit, so no empty undo step.
    const past = useWorkshop.getState().past.length
    useWorkshop.getState().setConstrain('off')
    expect(useWorkshop.getState().past.length).toBe(past)
  })

  it('a deploy starts at the shard\'s own setting and writes the chosen one; the bench keeps its own', async () => {
    useWorkshop.getState().setConstrain('all')
    const bench = useWorkshop.getState().current()!
    useShards.getState().startDeployShard(bench.id)
    expect(useShards.getState().deployConstrain).toBe('all')
    useShards.getState().setDeployConstrain('opaque')
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('done')
    const wire = JSON.parse(useShards.getState().mine[0].inner.content) as ShardPayload & { constrain?: string }
    expect(wire.constrain).toBe('opaque')
    expect(constrainOf(useWorkshop.getState().current()!)).toBe('all')
  })

  it('an untouched deploy is untouched', async () => {
    const bench = useWorkshop.getState().current()!
    useShards.getState().startDeployShard(bench.id)
    await useShards.getState().deploy()
    expect(useShards.getState().mine[0].shard).toBe(bench)
    expect(JSON.parse(useShards.getState().mine[0].inner.content)).not.toHaveProperty('constrain')
  })

  it('EDIT changes that placement only: another placement of the same shard keeps its own', async () => {
    const bench = useWorkshop.getState().current()!
    useShards.getState().startDeployShard(bench.id)
    await useShards.getState().deploy()
    // A second placement a few gibsons away (the same shard at the same point
    // in the same second would be the same event).
    const c = useCyberspace.getState().cursor
    useCyberspace.setState({ cursor: { ...c, x: c.x + 5n } })
    useShards.getState().startDeployShard(bench.id)
    await useShards.getState().deploy()
    expect(useShards.getState().mine).toHaveLength(2)
    const [a, b] = useShards.getState().mine.map((d) => d.eventId)
    useShards.getState().startEditShard(a)
    useShards.getState().setDeployConstrain('all')
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('done')
    const rows = useShards.getState().mine
    const other = rows.find((d) => d.eventId === b)!
    const moved = rows.find((d) => d.eventId !== b)!
    expect(constrainOf(moved.shard!)).toBe('all')
    expect(constrainOf(other.shard!)).toBe('off')
    expect(JSON.parse(other.inner.content)).not.toHaveProperty('constrain')
    // The bench model is untouched too.
    expect(constrainOf(useWorkshop.getState().current()!)).toBe('off')
  })

  it('EDIT starts at the hidden shard\'s setting and writes the new one', async () => {
    const bench = useWorkshop.getState().current()!
    useShards.getState().startDeployShard(bench.id)
    await useShards.getState().deploy()
    const id = useShards.getState().mine[0].eventId
    useShards.getState().startEditShard(id)
    expect(useShards.getState().deployConstrain).toBe('off')
    useShards.getState().setDeployConstrain('all')
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('done')
    const moved = useShards.getState().mine.find((d) => d.eventId !== id) ?? useShards.getState().mine[0]
    expect(JSON.parse(moved.inner.content)).toHaveProperty('constrain', 'all')
    expect(constrainOf(moved.shard!)).toBe('all')
  })
})
