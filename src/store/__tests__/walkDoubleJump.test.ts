/**
 * walkDoubleJump.test.ts - the higher jump and the double jump in WALK
 * under GRAVITY (arkinox's play test of 2026-11-10; store/useWalk.ts (F),
 * store/walkGravity.ts, store/walkHold.ts):
 *
 * - a jump rises JUMP_HEIGHT, 5 (it was 3), at the same gravity;
 * - a double jump never lowers the arc (review of #654): a quick double tap
 *   is never worse than one tap;
 * - JUMP pressed fresh in the air (Space, R or the pad's JUMP) rises
 *   DOUBLE_JUMP_HEIGHT, 3, above where it was pressed, once per time in the
 *   air: a landing gives it back, a bounce's landing included;
 * - JUMP held never double jumps by itself; Down held does not block it;
 * - just before a bounce's landing a press is that bounce's Up, as before;
 * - it publishes nothing of its own: in place nothing, onto a ledge one hop;
 * - the reachable heights: a jump onto a ledge 5 up, not 6; a double jump
 *   from the top of a jump onto one 7 up, not 8.
 */
import { provedFor } from '../fixtures/provedHop'
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
import { BOUNCE_BOOST_MS, fallState, tickFall, useWalk } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { clearWalls } from '../walkWalls'
import { holding } from '../walkHold'
import { DOUBLE_JUMP_HEIGHT, DOUBLE_JUMP_SPEED, JUMP_HANG_S, JUMP_HEIGHT, JUMP_SPEED, WALK_GRAVITY } from '../walkGravity'
import { walkFall } from '../../lib/walkEye'
import { useCalibration } from '../../lib/calibration'
import { withConstrain, type Constrain } from '../../lib/walkConstrain'
import { canonicalQuaternion, type Position, type ViewAxes } from '../../lib/space'
import { walkKeyDown, walkKeyUp, walkKeysReleased } from '../../hooks/useKeyboard'
import { padHold, walkPad } from '../../hud/TouchControls'

/** Right +X, up +Y, toward the camera +Z: 'away' walks -Z. Level, as GRAVITY keeps the keys. */
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

/** `s` with a `bounce` in its payload. */
function bouncy(s: ShardModel, bounce: unknown): ShardModel {
  return { ...s, extra: { ...s.extra, bounce } }
}

/** A floor under the walker, its top 1 below. */
const FLOOR: [V3, V3] = [[-10, -1, -10], [10, 0, 10]]
/** A ledge whose top is 1 under the walker, ending half a gibson behind it (-Z). */
const LEDGE: [V3, V3] = [[-10, -1, -0.5], [10, 0, 10]]
/** A floor `drop` further down than LEDGE, running on past its edge. */
const lowFloor = (drop: number): [V3, V3] => [[-10, -drop - 1, -20], [10, -drop, 10]]
/** The floor, and a ledge from 1 ahead that you stand on `h` up. */
const ledgeUp = (h: number): Array<[V3, V3]> => [FLOOR, [[-10, 0, -10], [10, h, -0.5]]]

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

/** The clock the fall runs on, and the hold's timers with it. */
let clock = 1_000_000
function frame(ms: number): boolean {
  clock += ms
  vi.advanceTimersByTime(ms)
  return tickFall()
}
function fallOut(maxMs = 120_000): void {
  for (let t = 0; t < maxMs && fallState(); t += 16) frame(16)
}
/** The eye's height over `start` now: the cursor's, plus the arc's offset from it. */
function eye(start: Position): number {
  return Number(useCyberspace.getState().cursor.y - start.y) + (walkFall.active ? walkFall.offset : 0)
}
/** The highest the eye goes over `ms` of 16 ms frames. */
function peakOver(start: Position, ms: number): number {
  let peak = -Infinity
  for (let t = 0; t < ms; t += 16) { frame(16); if (fallState()) peak = Math.max(peak, eye(start)) }
  return peak
}

const key = (code: string) => ({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, preventDefault: () => {} })
/** A tap of `code`: down and up. */
function tap(code: string): void {
  walkKeyDown(key(code))
  walkKeyUp(code)
}

/** When a jump in place comes back down, in ms: about 775. */
const LANDS_MS = JUMP_HANG_S * 1000

let start: Position

beforeEach(async () => {
  posted.length = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  ceiling.hopHeight = 40
  walkKeysReleased()
  useWalk.getState().exit()
  useWalk.getState().setGravity(false)
  useShards.setState({ worldItems: worldItemsOriginal })
  useWorkshop.setState({ open: false })
  clearWalls()
  useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode: 'off' }, scaleExp: 0, view: canonicalQuaternion() })
  await useCyberspace.getState().respawn()
  useCyberspace.getState().cancel()
  useCalibration.setState({ cantorMsByHeight: undefined })
  start = { ...useCyberspace.getState().position }
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

afterEach(() => {
  walkKeysReleased()
  useWalk.getState().exit()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Into WALK under gravity, the level keys on screen. */
function walk(): void {
  useWalk.getState().setGravity(true)
  useWalk.getState().enter()
  useCyberspace.setState({ screenAxes: AXES })
}

describe('the jump: 5 now, at the same gravity', () => {
  it('rises to about 5 and comes back down where it left, publishing nothing', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk()
    tap('Space')
    expect(fallState()!.v0).toBeCloseTo(JUMP_SPEED, 9)
    const peak = peakOver(start, 2000)
    expect(JUMP_HEIGHT).toBe(5)
    expect(Math.abs(peak - 5)).toBeLessThan(1)
    expect(peak).toBeLessThanOrEqual(5)
    expect(fallState()).toBeNull()
    expect(useCyberspace.getState().cursor).toEqual(start)
    expect(posted).toHaveLength(0)
  })
})

describe('the double jump', () => {
  it('Space again in the air: 3 above where it was pressed, at DOUBLE_JUMP_SPEED, once; in place it publishes nothing', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk()
    tap('Space')
    // Just past the top of the jump, coming down from 5.
    frame(400)
    const pressedAt = eye(start)
    expect(pressedAt).toBeGreaterThan(4.9)
    tap('Space')
    const f = fallState()!
    expect(f.doubled).toBe(true)
    // The speed now is DOUBLE_JUMP_SPEED, set and not added: 20 up, from about 0 at the top.
    const t = (clock - f.t0) / 1000
    expect(f.v0 - WALK_GRAVITY * t).toBeCloseTo(DOUBLE_JUMP_SPEED, 6)
    // The eye goes on from where it was: no jump of its own.
    expect(eye(start)).toBeCloseTo(pressedAt, 9)
    // A third press: nothing, the double jump is spent.
    const { v0, t0 } = f
    frame(16)
    tap('Space')
    expect(fallState()!.v0).toBe(v0)
    expect(fallState()!.t0).toBe(t0)
    const peak = Math.max(eye(start), peakOver(start, 3000))
    expect(DOUBLE_JUMP_HEIGHT).toBe(3)
    expect(peak - pressedAt).toBeGreaterThan(2.9)
    expect(peak - pressedAt).toBeLessThanOrEqual(3 + 1e-9)
    // Down again where it left: nothing made.
    expect(fallState()).toBeNull()
    expect(useCyberspace.getState().cursor).toEqual(start)
    expect(useWalk.getState()).toMatchObject({ queue: [], open: null, behind: 0 })
    expect(posted).toHaveLength(0)
  })

  it('never lowers the arc: a double tap just off the floor keeps the jump\'s speed and goes as high as one tap (review of #654)', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk()
    tap('Space')
    const single = fallState()!
    const { v0: v1, t0: t1 } = single
    // 16 ms in, still rising at about 24.8, faster than a double jump's 20.
    frame(16)
    const speedNow = v1 - WALK_GRAVITY * ((clock - t1) / 1000)
    expect(speedNow).toBeGreaterThan(DOUBLE_JUMP_SPEED)
    const pressedAt = eye(start)
    tap('Space')
    const f = fallState()!
    expect(f.doubled).toBe(true)
    // The speed now is the jump's own, not 20: nothing lost.
    expect(f.v0 - WALK_GRAVITY * ((clock - f.t0) / 1000)).toBeCloseTo(speedNow, 6)
    expect(eye(start)).toBeCloseTo(pressedAt, 9)
    const peak = Math.max(eye(start), peakOver(start, 2000))
    // As high as the single jump (5), where a speed set to 20 would have stopped at about 3.4.
    expect(peak).toBeGreaterThan(4.99)
    expect(peak).toBeLessThanOrEqual(5 + 1e-9)
    expect(useCyberspace.getState().cursor).toEqual(start)
    expect(posted).toHaveLength(0)
  })

  it('a double tap a little later, rising slower than 20: the double jump takes over and goes higher', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk()
    tap('Space')
    // 160 ms in: about 2.9 up, rising at about 15.
    frame(160)
    const pressedAt = eye(start)
    tap('Space')
    const f = fallState()!
    expect(f.v0 - WALK_GRAVITY * ((clock - f.t0) / 1000)).toBeCloseTo(DOUBLE_JUMP_SPEED, 6)
    const peak = Math.max(eye(start), peakOver(start, 2000))
    expect(peak - pressedAt).toBeGreaterThan(2.9)
    expect(peak).toBeGreaterThan(5)
  })

  it('a landing gives it back: the next jump has its own', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk()
    tap('Space')
    frame(100)
    tap('Space')
    expect(fallState()!.doubled).toBe(true)
    fallOut()
    expect(fallState()).toBeNull()
    tap('Space')
    expect(fallState()!.doubled).toBe(false)
    frame(100)
    tap('Space')
    expect(fallState()!.doubled).toBe(true)
    fallOut()
    expect(posted).toHaveLength(0)
  })

  it('on a plain fall too, off a ledge: the step-off and the landing are the only hops, as without it', async () => {
    world(start, [boxes('Ledge', 'all', [LEDGE, lowFloor(20)]), [0, -1, 0]])
    walk()
    useWalk.getState().press('away')
    const off = { ...start, z: start.z - 1n }
    expect(useWalk.getState().falling).toBe(true)
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ from: start, to: off })
    frame(200)
    const pressedAt = eye(start)
    tap('Space')
    expect(fallState()!.doubled).toBe(true)
    const peak = Math.max(eye(start), peakOver(start, 400))
    expect(peak - pressedAt).toBeGreaterThan(2.9)
    expect(peak - pressedAt).toBeLessThanOrEqual(3 + 1e-9)
    fallOut()
    const landing = { ...off, y: start.y - 20n }
    expect(useCyberspace.getState().cursor).toEqual(landing)
    await land()
    await vi.waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1]).toMatchObject({ from: off, to: landing })
    await land()
    expect(posted).toHaveLength(2)
  })

  it('JUMP held never double jumps: the beats in the air do nothing, and only a new press does', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk()
    walkKeyDown(key('Space'))
    const t0 = fallState()!.t0
    // Held through the whole rise and most of the fall: a beat every 110 ms (WALK_HOLD_MS).
    for (let t = 0; t < LANDS_MS - 50; t += 16) frame(16)
    expect(holding()).toBe(true)
    expect(fallState()).not.toBeNull()
    expect(fallState()!.doubled).toBe(false)
    expect(fallState()!.t0).toBe(t0)
    expect(fallState()!.v0).toBeCloseTo(JUMP_SPEED, 9)
    walkKeyUp('Space')
    // Let go and pressed again, still in the air: now it double jumps.
    walkKeyDown(key('Space'))
    expect(fallState()!.doubled).toBe(true)
    walkKeyUp('Space')
    fallOut()
    expect(posted).toHaveLength(0)
  })

  it('Down held does not block it, though on the floor JUMP and DOWN cancel', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk()
    tap('Space')
    frame(100)
    walkKeyDown(key('KeyC'))
    tap('Space')
    expect(fallState()!.doubled).toBe(true)
    fallOut()
    // Down still held, on the floor: JUMP is cancelled by it, as before.
    tap('Space')
    expect(fallState()).toBeNull()
    walkKeyUp('KeyC')
  })

  it('R and the pad\'s JUMP double jump too', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk()
    tap('KeyR')
    frame(100)
    tap('KeyR')
    expect(fallState()!.doubled).toBe(true)
    fallOut()
    const jump = walkPad(true, () => () => {}).find((b) => b.cell === 'jump')!
    expect(jump.title).toBe('Jump (Space or R). Press again in the air to double jump.')
    const pointer = { preventDefault: () => {}, stopPropagation: () => {}, clientX: 0 } as unknown as React.PointerEvent
    const h = padHold(jump)
    h.onPointerDown(pointer)
    h.onPointerUp()
    expect(fallState()!.doubled).toBe(false)
    frame(100)
    h.onPointerDown(pointer)
    h.onPointerUp()
    expect(fallState()!.doubled).toBe(true)
    fallOut()
    expect(posted).toHaveLength(0)
  })

  it('a bounce\'s landing gives it back: every arc of a bounce has its own, and bouncing in place still makes nothing', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk()
    tap('Space')
    frame(100)
    tap('Space')
    expect(fallState()!.doubled).toBe(true)
    // On until the pad launches the next arc (faster than any jump).
    for (let t = 0; t < 5000 && fallState()!.v0 <= JUMP_SPEED + 1e-9; t += 16) frame(16)
    expect(fallState()!.v0).toBeCloseTo(Math.sqrt(2 * WALK_GRAVITY * 8), 6)
    expect(fallState()!.doubled).toBe(false)
    frame(200)
    const pressedAt = eye(start)
    tap('Space')
    expect(fallState()!.doubled).toBe(true)
    expect(Math.max(eye(start), peakOver(start, 400)) - pressedAt).toBeGreaterThan(2.9)
    for (let t = 0; t < 10_000; t += 16) frame(16)
    expect(useWalk.getState().falling).toBe(true)
    expect(useCyberspace.getState().cursor).toEqual(start)
    expect(posted).toHaveLength(0)
  })

  it('just before a bounce\'s landing a press is the bounce\'s Up, as it was: it adds JUMP_HEIGHT and is no double jump', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk()
    tap('Space')
    frame(LANDS_MS - BOUNCE_BOOST_MS + 50)
    tap('Space')
    expect(fallState()!.doubled).toBe(false)
    for (let t = 0; t < 2000 && fallState()!.v0 <= JUMP_SPEED + 1e-9; t += 16) frame(16)
    expect(fallState()!.v0).toBeCloseTo(Math.sqrt(2 * WALK_GRAVITY * (8 + JUMP_HEIGHT)), 6)
  })
})

describe('how high you reach now', () => {
  /** Jump, then step on just past the top of the arc; with `double`, double jump at the jump's top first. */
  function reach(h: number, double: boolean): V3 {
    world(start, [boxes('Ledge', 'all', ledgeUp(h)), [0, -1, 0]])
    walk()
    tap('Space')
    frame(400)
    if (double) { tap('Space'); expect(fallState()!.doubled).toBe(true); frame(310) }
    useWalk.getState().press('away')
    return at(start)
  }

  it('a jump reaches a ledge 5 up, one hop onto it', async () => {
    expect(reach(5, false)).toEqual([0, 5, -1])
    fallOut()
    expect(at(start)).toEqual([0, 5, -1])
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ from: start, to: { ...start, y: start.y + 5n, z: start.z - 1n } })
  })

  it('a jump does not reach one 6 up', () => {
    // Held by the ledge's face: no step, and the cursor stays where the arc's hop starts.
    expect(reach(6, false)).toEqual([0, 0, 0])
    expect(fallState()!.waypoints).toHaveLength(0)
    fallOut()
    expect(at(start)).toEqual([0, 0, 0])
    expect(posted).toHaveLength(0)
  })

  it('a double jump from the top of a jump reaches a ledge 7 up, one hop onto it, nothing more', async () => {
    expect(reach(7, true)).toEqual([0, 7, -1])
    fallOut()
    expect(at(start)).toEqual([0, 7, -1])
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ from: start, to: { ...start, y: start.y + 7n, z: start.z - 1n } })
    await land()
    expect(posted).toHaveLength(1)
  })

  it('a double jump does not reach one 8 up', () => {
    expect(reach(8, true)).toEqual([0, 0, 0])
    expect(fallState()!.waypoints).toHaveLength(0)
    fallOut()
    expect(at(start)).toEqual([0, 0, 0])
    expect(posted).toHaveLength(0)
  })
})
