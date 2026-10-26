/**
 * walkStepWalk.test.ts - the step-up in the walk store: a flight of Maze Kit
 * stairs, walked with one key at one press per gibson, is ONE open segment
 * and ONE hop on the chain, straight from the foot to the head (the same
 * work per axis as its steps would cost, in fewer events); a riser of 3 is a
 * WALL; a stair without collision is walked through at the same height; and
 * a press up or down still turns, closing the segment as before.
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

const posted: Array<{ id: number; mode: string; from: { x: bigint; y: bigint; z: bigint }; to: { x: bigint; y: bigint; z: bigint } }> = []
vi.mock('../../lib/workers', () => ({
  postProof: vi.fn((req: (typeof posted)[number]) => { posted.push(req) }),
  cancelProof: vi.fn(),
  setProofHandler: vi.fn(),
}))
vi.mock('../../lib/calibration', async (orig) => {
  const mod = await orig<typeof import('../../lib/calibration')>()
  return { ...mod, recommendedHopHeight: () => 40 }
})
vi.mock('../../lib/relay', async (orig) => {
  const mod = await orig<typeof import('../../lib/relay')>()
  // Offline under these overrides too: no live relay is ever asked (src/test/offlineRelay.ts).
  const { offlineRelay } = await import('../../test/offlineRelay')
  return { ...mod, ...offlineRelay, publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []) }
})

import { newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { useWalk } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { clearWalls, wallsBuilt } from '../walkWalls'
import { fallState, tickFall } from '../useWalk'
import { useCalibration } from '../../lib/calibration'
import { withConstrain } from '../../lib/walkConstrain'
import type { Position, ViewAxes } from '../../lib/space'

/** Right +X, up +Y, toward the camera +Z: 'away' walks -Z, the way the grand stair climbs. */
const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }
const worldItemsOriginal = useShards.getState().worldItems

/** A slab across `axis`, its near face `near` gibsons out on side `dir`, `half` gibsons each way, two ticks thick. */
function slab(axis: 'x' | 'y' | 'z', dir: 1 | -1, near: number, half: number): ShardModel {
  const i = ['x', 'y', 'z'].indexOf(axis), j = (i + 1) % 3, k = (i + 2) % 3
  const verts: ShardModel['vertices'] = []
  for (const depth of [near * 120, near * 120 + 2]) for (const [a, b] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
    const t = [0, 0, 0]; t[i] = depth * dir; t[j] = a * 120; t[k] = b * 120
    const p = t.map((x) => Math.floor(x / 120)) as [number, number, number]
    const r = t.map((x, n) => x - p[n] * 120) as [number, number, number]
    verts.push(r.some((x) => x !== 0) ? { p, t: r, c: [1, 1, 1] } : { p, c: [1, 1, 1] })
  }
  const q = (a: number, b: number, c: number, e: number): number[][] => [[a, b, c], [a, c, e]]
  const faces = [...q(0, 1, 2, 3), ...q(4, 7, 6, 5), ...q(0, 4, 5, 1), ...q(1, 5, 6, 2), ...q(2, 6, 7, 3), ...q(3, 7, 4, 0)] as Array<[number, number, number]>
  return withConstrain({ ...newShard('Slab'), mode: 'solid', vertices: verts, faces }, 'all')
}

/** A shard of yours carrying `piece` and placing it once: built only when its walls resolve. */
function carrying(piece: ShardModel): ShardModel {
  const me = useCyberspace.getState().identity.pubkey
  const address = `33331:${me}:piece`
  return withConstrain({ ...newShard('Carrier'), mode: 'solid', vertices: [], faces: [], author: me, refs: [['a', address]], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }], objects: { [address]: toPayload(piece) } }, 'off')
}

function world(at: Position, shard: ShardModel): void {
  const items: WorldItem[] = [{ key: `w-${shard.id}`, type: 'shard', at, plane: useCyberspace.getState().plane as WorldItem['plane'], height: 84, mine: true, shard }]
  useShards.setState({ worldItems: () => items })
}

const moved = (start: Position, p: Position = useCyberspace.getState().cursor): [number, number, number] =>
  [Number(p.x - start.x), Number(p.y - start.y), Number(p.z - start.z)]

describe('WALK waits for walls on their way (round-6 review of #503)', () => {
  let start: Position
  beforeEach(async () => {
    useWalk.getState().exit()
    useShards.setState({ worldItems: worldItemsOriginal })
    clearWalls()
    useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode: 'off' }, scaleExp: 0 })
    await useCyberspace.getState().respawn()
    useCyberspace.getState().cancel()
    useCalibration.setState({ cantorMsByHeight: undefined })
    start = { ...useCyberspace.getState().position }
  })

  it('held presses into a wall still being built never pass it: they wait, then stop a gibson short', async () => {
    // A wall 3 ahead, carried: on its way when WALK begins.
    world(start, carrying(slab('z', -1, 3, 2)))
    useWalk.getState().enter()
    useCyberspace.setState({ screenAxes: AXES })
    // A held key: ten presses at once, before anything has had a chance to land.
    for (let k = 0; k < 10; k++) useWalk.getState().press('away')
    await wallsBuilt()
    await new Promise((r) => setTimeout(r, 0))
    for (let k = 0; k < 10; k++) useWalk.getState().press('away')
    // Two steps, then the wall: never through it.
    expect(moved(start)[2]).toBe(-2)
  })

  it('a fall onto a floor still being built lands on it', async () => {
    // Gravity on, the floor 5 below, carried.
    world(start, carrying(slab('y', -1, 5, 3)))
    useWalk.getState().setGravity(true)
    useWalk.getState().enter()
    useCyberspace.setState({ screenAxes: AXES })
    await wallsBuilt()
    await new Promise((r) => setTimeout(r, 0))
    // The fall's clock, a frame at a time (as walkGravity.test.ts runs it).
    let clock = 1_000_000
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    for (let t = 0; t < 60_000 && fallState(); t += 16) { clock += 16; tickFall() }
    vi.restoreAllMocks()
    // It fell onto the floor, not through it.
    expect(moved(start)[1]).toBeGreaterThanOrEqual(-5)
    expect(moved(start)[1]).toBeLessThan(0)
  })

  it('a floor in your plane under a block still being built: once it stands, you fall away from its underside (#497)', async () => {
    // A plate at your height of the carrier's own, and a block carried, its underside at your height: floors only.
    const me = useCyberspace.getState().identity.pubkey
    const address = `33331:${me}:block`
    const plate = [[-3, 0, -3], [3, 0, -3], [3, 0, 3], [-3, 0, 3]].map((p) => ({ p: p as [number, number, number], c: [1, 1, 1] as [number, number, number] }))
    /** The carrier, its block `x` ticks to the side. */
    const carrier = (x: number): ShardModel => withConstrain({ ...newShard('Carrier'), mode: 'solid', vertices: plate, faces: [[0, 1, 2], [0, 2, 3]], author: me, refs: [['a', address]], parts: [{ ref: 0, at: [x, 0, 0], turn: [0, 0, 0], step: 0 }], objects: { [address]: toPayload(slab('y', 1, 0, 2)) } }, 'all')
    for (const [x, falls] of [[2400, false], [0, true]] as const) {
      // The control first: the block 20 to the side, so the plate, once built, holds you.
      clearWalls()
      world(start, carrier(x))
      useWalk.getState().setGravity(true)
      useWalk.getState().enter()
      await wallsBuilt()
      await new Promise((r) => setTimeout(r, 0))
      expect(useWalk.getState().falling).toBe(falls)
      useWalk.getState().exit()
      useWalk.getState().setGravity(false)
    }
  })

  it('a press waiting for walls is never made in a new WALK', async () => {
    world(start, carrying(slab('z', -1, 3, 2)))
    useWalk.getState().enter()
    useCyberspace.setState({ screenAxes: AXES })
    useWalk.getState().press('away')
    // WALK ends and begins again before the walls land: the old press is let go.
    useWalk.getState().exit()
    clearWalls()
    useWalk.getState().enter()
    useCyberspace.setState({ screenAxes: AXES })
    await wallsBuilt()
    await new Promise((r) => setTimeout(r, 0))
    expect(moved(start)).toEqual([0, 0, 0])
  })

})
