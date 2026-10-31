/**
 * walkStepWalk.test.ts - the step-up in the walk store: a flight of Maze Kit
 * stairs, walked with one key at one press per gibson, is ONE open segment
 * and ONE hop on the chain, straight from the foot to the head (the same
 * work per axis as its steps would cost, in fewer events); a riser of 3 is a
 * WALL; a stair without collision is walked through at the same height; and
 * a press up or down still turns, closing the segment as before.
 */
import { provedFor } from '../fixtures/provedHop'
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

import { fromPayload, newShard, type ShardModel, type ShardPayload } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { useWalk } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useToast } from '../useToast'
import { clearWalls } from '../walkWalls'
import { useCalibration } from '../../lib/calibration'
import { withConstrain, type Constrain } from '../../lib/walkConstrain'
import type { Position, ViewAxes } from '../../lib/space'
import hallStairs from '../fixtures/maze-kit-basilica-hall-stairs.json'

/** Right +X, up +Y, toward the camera +Z: 'away' walks -Z, the way the grand stair climbs. */
const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }

const worldItemsOriginal = useShards.getState().worldItems

/** The world holds exactly `shard`, its origin `o` gibsons from the walker. */
function world(start: Position, shard: ShardModel, o: [number, number, number]): void {
  const at = { x: start.x + BigInt(o[0]), y: start.y + BigInt(o[1]), z: start.z + BigInt(o[2]) }
  const items: WorldItem[] = [{ key: `w-${shard.id}`, type: 'shard', at, plane: useCyberspace.getState().plane as WorldItem['plane'], height: 84, mine: false, shard }]
  useShards.setState({ worldItems: () => items })
}

const stair = (c: Constrain = 'all'): ShardModel => withConstrain(fromPayload(hallStairs as unknown as ShardPayload, 'x')!, c)

/** The walker's offset from where it started. */
function moved(start: Position, p: Position = useCyberspace.getState().cursor): [number, number, number] {
  return [Number(p.x - start.x), Number(p.y - start.y), Number(p.z - start.z)]
}

function done(req: (typeof posted)[number]) {
  return { type: 'done' as const, id: req.id, mode: req.mode as 'hop' | 'sidestep', elapsedMs: 5, ...provedFor(req), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4 }
}

describe('WALK up a stair', () => {
  let start: Position
  beforeEach(async () => {
    posted.length = 0
    useWalk.getState().exit()
    useShards.setState({ worldItems: worldItemsOriginal })
    clearWalls()
    useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode: 'off' }, scaleExp: 0 })
    await useCyberspace.getState().respawn()
    useCyberspace.getState().cancel()
    useCalibration.setState({ cantorMsByHeight: undefined })
    useToast.setState({ toast: null })
    start = { ...useCyberspace.getState().position }
  })

  it('the grand stair: one key, one press per gibson, one segment, one hop', async () => {
    // The walker at the stair's foot doorway: x 0, standing on the floor (y -8) at z 8.
    world(start, stair(), [0, 7, -8])
    useWalk.getState().enter()
    useCyberspace.setState({ screenAxes: AXES })
    for (let k = 1; k <= 16; k++) {
      useWalk.getState().press('away')
      // Every press is one gibson along, and the walk is one open segment still.
      expect(moved(start)[2]).toBe(-k)
      expect(useWalk.getState().queue).toHaveLength(0)
    }
    // At the head of the flight, 16 up, standing on the top landing.
    expect(moved(start)).toEqual([0, 16, -16])
    expect(useToast.getState().toast).toBeNull()
    const end = useWalk.getState().open!.end
    expect(useWalk.getState().open).toMatchObject({ axis: 'z', dir: -1, from: start })

    useWalk.getState().settle()
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    // One straight hop from the foot to the head.
    expect(posted[0].from).toEqual(start)
    expect(posted[0].to).toEqual(end)
    await useCyberspace.getState().applyProofMessage(done(posted[0]))
    expect(useCyberspace.getState().position).toEqual(end)
    // spawn, then ONE hop for the whole flight
    expect(useCyberspace.getState().events).toHaveLength(2)
  })

  it('and down again: the same one segment, settling onto every tread', async () => {
    // The walker at the head: standing on the top landing (y 8) at z -8.
    world(start, stair(), [0, -9, 8])
    useWalk.getState().enter()
    useCyberspace.setState({ screenAxes: AXES })
    for (let k = 0; k < 16; k++) useWalk.getState().press('toward')
    expect(moved(start)).toEqual([0, -16, 16])
    expect(useWalk.getState().queue).toHaveLength(0)
    expect(useWalk.getState().open).toMatchObject({ axis: 'z', dir: 1, from: start })
  })

  it('a press up turns, and closes the segment, as before', () => {
    world(start, stair(), [0, 7, -8])
    useWalk.getState().enter()
    useCyberspace.setState({ screenAxes: AXES })
    for (let k = 0; k < 4; k++) useWalk.getState().press('away')
    useWalk.getState().press('up')
    expect(useWalk.getState().queue).toHaveLength(1)
    expect(useWalk.getState().open).toMatchObject({ axis: 'y', dir: 1 })
  })

  it('a riser of 3 is a WALL: the press does not go', () => {
    const block: ShardModel = withConstrain({
      ...newShard('Block'),
      mode: 'solid',
      // A block 3 high across the way, its near face 1 ahead, standing on a floor 1 below the walker.
      vertices: [[-4, -1, -12], [4, -1, -12], [4, 2, -12], [-4, 2, -12], [-4, -1, -1], [4, -1, -1], [4, 2, -1], [-4, 2, -1], [4, -1, 4], [-4, -1, 4]].map((p) => ({ p: p as [number, number, number], c: [1, 1, 1] as [number, number, number] })),
      // The block's six sides, and the floor's top (y -1) under the walker.
      faces: [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [3, 2, 6], [3, 6, 7], [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2], [4, 5, 8], [4, 8, 9]],
    }, 'all')
    world(start, block, [0, 0, 0])
    useWalk.getState().enter()
    useCyberspace.setState({ screenAxes: AXES })
    useWalk.getState().press('away')
    expect(moved(start)).toEqual([0, 0, 0])
    expect(useWalk.getState().open).toBeNull()
    expect(useToast.getState().toast).toMatchObject({ label: 'WALL', meta: 'Block' })
  })

  it('a stair without collision is walked through, at the same height, as before', () => {
    world(start, stair('off'), [0, 7, -8])
    useWalk.getState().enter()
    useCyberspace.setState({ screenAxes: AXES })
    for (let k = 0; k < 16; k++) useWalk.getState().press('away')
    expect(moved(start)).toEqual([0, 0, -16])
    expect(useToast.getState().toast).toBeNull()
  })
})
