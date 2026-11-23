/**
 * walkBounceFallback.test.ts - BOUNCE in WALK, EXPERIMENTAL (store/useWalk.ts
 * hopsOf): when the one straight hop from the landing before would cost more
 * than a walk segment may, the steer points of the arc go instead, as for any
 * fall, each chained from the one before, starting at the launch. The cost is
 * forced here by making any hop that changes both X and Z far too dear
 * (ported from the independent review of #649).
 */import { provedFor } from '../fixtures/provedHop'
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

vi.mock('cyberspace-core', async (orig) => {
  const mod = await orig<typeof import('cyberspace-core')>()
  return {
    ...mod,
    estimateHopCost: (...a: Parameters<typeof mod.estimateHopCost>) => {
      const est = mod.estimateHopCost(...a)
      const [x1, , z1, x2, , z2] = a as unknown as bigint[]
      // A hop that changes both X and Z: far too dear for the walk's segment budget.
      return x1 !== x2 && z1 !== z2 ? { ...est, lcaX: 80, lcaZ: 80 } : est
    },
  }
})
const posted: Array<{ id: number; mode: string; from: { x: bigint; y: bigint; z: bigint }; to: { x: bigint; y: bigint; z: bigint } }> = []
vi.mock('../../lib/workers', () => ({
  postProof: vi.fn((req: (typeof posted)[number]) => { posted.push(req) }),
  cancelProof: vi.fn(),
  setProofHandler: vi.fn(),
}))
/** The machine's hop ceiling, which sets the walk's segment budget (h <= hopHeight - 3 here). */
const ceiling = vi.hoisted(() => ({ hopHeight: 40 }))
vi.mock('../../lib/calibration', async (orig) => {
  const mod = await orig<typeof import('../../lib/calibration')>()
  return { ...mod, recommendedHopHeight: () => ceiling.hopHeight }
})
vi.mock('../../lib/relay', async (orig) => {
  const mod = await orig<typeof import('../../lib/relay')>()
  // Offline under these overrides too: no live relay is ever asked (src/test/offlineRelay.ts).
  const { offlineRelay } = await import('../../test/offlineRelay')
  return { ...mod, ...offlineRelay, publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []) }
})

import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { fallState, tickFall, useWalk } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useToast } from '../useToast'
import { useWorkshop } from '../useWorkshop'
import { clearWalls } from '../walkWalls'
import { JUMP_SPEED } from '../walkGravity'
import { walkFall } from '../../lib/walkEye'
import { useCalibration } from '../../lib/calibration'
import { withConstrain, type Constrain } from '../../lib/walkConstrain'
import { canonicalQuaternion, type Position, type ViewAxes } from '../../lib/space'

/** Right +X, up +Y, toward the camera +Z: 'away' walks -Z. */
const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }

const worldItemsOriginal = useShards.getState().worldItems

type V3 = [number, number, number]

/** Closed boxes from `lo` to `hi`, in gibsons from the shard's origin, at unit 0 (as walkStep.test.ts builds them). */
function boxes(name: string, c: Constrain, list: Array<[V3, V3]>): ShardModel {
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
    for (const [a, b, cc, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) {
      faces.push([base + a, base + b, base + cc], [base + a, base + cc, base + d])
    }
  }
  return withConstrain({ ...newShard(name), mode: 'solid', vertices, faces }, c)
}

/** The world holds exactly these shards, each with its origin `o` gibsons from `start`. */
function world(start: Position, ...placed: Array<[ShardModel, V3]>): WorldItem[] {
  const plane = useCyberspace.getState().plane as WorldItem['plane']
  const items: WorldItem[] = placed.map(([shard, o], n) => ({
    key: `w${n}-${shard.id}`, type: 'shard', at: { x: start.x + BigInt(o[0]), y: start.y + BigInt(o[1]), z: start.z + BigInt(o[2]) }, plane, height: 84, mine: false, shard,
  }))
  useShards.setState({ worldItems: () => items })
  return items
}

/** `s` with a `bounce` in its payload, as sno-core carries a field it does not know. */
function bouncy(s: ShardModel, bounce: unknown): ShardModel {
  return { ...s, extra: { ...s.extra, bounce } }
}

function at(start: Position, p: Position = useCyberspace.getState().cursor): V3 {
  return [Number(p.x - start.x), Number(p.y - start.y), Number(p.z - start.z)]
}

function done(req: (typeof posted)[number]) {
  return { type: 'done' as const, id: req.id, mode: req.mode as 'hop' | 'sidestep', elapsedMs: 5, ...provedFor(req), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4 }
}

/** Land the newest proof, and wait for the next one when one is due. */
async function land(): Promise<void> {
  const before = posted.length
  await useCyberspace.getState().applyProofMessage(done(posted[posted.length - 1]))
  if (useWalk.getState().queue.length > 0) await vi.waitFor(() => expect(posted.length).toBe(before + 1))
}

let clock = 1_000_000
function frame(ms: number): boolean {
  clock += ms
  return tickFall()
}
/** Frames until the fall is on a bounce's arc (faster than a jump), at most `maxMs`. */
function untilBounce(maxMs = 10_000): void {
  for (let t = 0; t < maxMs && fallState() && fallState()!.v0 <= JUMP_SPEED + 1e-9; t += 16) frame(16)
}

let start: Position

beforeEach(async () => {
  posted.length = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  ceiling.hopHeight = 40
  useWalk.getState().exit()
  useWalk.getState().setGravity(false)
  useShards.setState({ worldItems: worldItemsOriginal })
  useWorkshop.setState({ open: false })
  clearWalls()
  useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode: 'off' }, scaleExp: 0, view: canonicalQuaternion() })
  await useCyberspace.getState().respawn()
  useCyberspace.getState().cancel()
  useCalibration.setState({ cantorMsByHeight: undefined })
  useToast.setState({ toast: null })
  start = { ...useCyberspace.getState().position }
})

afterEach(() => {
  vi.restoreAllMocks()
})

function walk(gravity: boolean): void {
  useWalk.getState().setGravity(gravity)
  useWalk.getState().enter()
  useCyberspace.setState({ screenAxes: AXES })
}

describe('the fallback', () => {
  it('steering two ways in one arc: the direct hop is too dear, so the steer points go, chained from the launch', async () => {
    world(start, [bouncy(boxes('Pad', 'all', [[[-20, -1, -20], [20, 0, 20]]]), 12), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    untilBounce()
    expect(at(start, fallState()!.launch!)).toEqual([0, 0, 0])
    for (let t = 0; t < 2000; t += 16) { frame(16); if (walkFall.offset > 6) break }
    useWalk.getState().press('away')
    for (let t = 0; t < 200; t += 16) frame(16)
    useWalk.getState().press('right')
    // On to the next landing, where the bounce goes on from the new spot.
    for (let t = 0; t < 4000 && fallState() && at(start, fallState()!.launch!)[2] === 0; t += 16) frame(16)
    expect(at(start, fallState()!.launch!)).toEqual([1, 0, -1])
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0))
    for (let i = 0; i < 6 && useWalk.getState().queue.length; i++) await land()
    // The away point, the right point, then down to the landing: three hops, none both X and Z.
    expect(posted).toHaveLength(3)
    expect(posted[0].from).toEqual(start)
    for (let n = 1; n < posted.length; n++) expect(posted[n].from).toEqual(posted[n - 1].to)
    for (const h of posted) expect(h.from.x !== h.to.x && h.from.z !== h.to.z).toBe(false)
    expect(at(start, posted[2].to as Position)).toEqual([1, 0, -1])
    expect(useCyberspace.getState().position).toEqual(posted[2].to)
  })
})
