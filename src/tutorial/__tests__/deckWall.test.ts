/**
 * deckWall.test.ts - the low wall round the finish deck's far edge and sides
 * (owner, 2026-11-14), walked with the real WALK code under GRAVITY
 * (store/useWalk.ts, its bounce (E) and its presses in the air (B)) over the
 * shards the stager really seals, opened from the covering bag as discovery
 * opens them.
 *
 * Before the wall, a forward hold through the trampoline's bounce carried the
 * walker over the deck: about 0.9 s held came down in the chest's cell, about
 * 1.2 s past the deck onto the catch floor, 2 s or more past the floor's end,
 * falling for good. Now every one of those holds, held from a standstill on
 * the trampoline and held as a run onto it, comes down on the deck: the
 * presses in the air meet the wall and the arc drops onto the deck. The wall
 * blocks WALK on the deck too, it takes no taps (so the chest is tapped
 * through it), and it stays inside the covering bag's region.
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
  // Offline: no live relay is ever asked (src/test/offlineRelay.ts).
  const { offlineRelay } = await import('../../test/offlineRelay')
  return { ...mod, ...offlineRelay, publish: vi.fn(), publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []) }
})

import { generateSecretKey } from 'nostr-tools/pure'
import { regionKeyAt } from '../../lib/shardCrypto'
import { unbag } from '../../lib/hidden'
import { useCalibration } from '../../lib/calibration'
import { canonicalQuaternion, type Position, type ViewAxes } from '../../lib/space'
import { walkFacing } from '../../lib/walkEye'
import { useCyberspace } from '../../store/useCyberspace'
import { useShards, type WorldItem } from '../../store/useShards'
import { useWorkshop } from '../../store/useWorkshop'
import { WALK_HOLD_MS } from '../../store/walkHold'
import { JUMP_SPEED } from '../../store/walkGravity'
import { fallState, tickFall, useWalk } from '../../store/useWalk'
import { clearWalls, warmWalls, wallsBuilt } from '../../store/walkWalls'
import { walkStep } from '../../store/walkStep'
import { setGuideBags, passesTaps } from '../guideBags'
import { passTapsOf } from '../director'
import { buildStage, type KeyAt, type Stage } from '../stage'
import { COURSE, DECK_ZONE, FINISH_CHEST, WALL_RISE, courseToWorld, onDeck } from '../course'
import { inRegion, regionBase, type TutorialLayout } from '../layout'

const keyAt: KeyAt = async (at, h) => { const rk = regionKeyAt(at, h, 20); return { key: rk.key, lookupId: rk.lookupId } }

let clock = 1_000_000
let start: Position

/** A layout facing `fwd` and `side` around `spawn`, in its height-12 cover, as tutorial/layout.ts lays one out. */
function layoutFacing(spawn: Position, fwd: 1 | -1, side: 1 | -1): TutorialLayout {
  const own = regionBase(spawn, 3)
  return { plane: useCyberspace.getState().plane as TutorialLayout['plane'], spawn, frame: { fwd, side, boxBase: { x: own.x, y: own.y, z: own.z + BigInt(fwd) * 8n } }, cover: { height: 12, base: regionBase(spawn, 12) } }
}

/** The covering bag's shards, opened as discovery opens them, as the world WALK meets. */
async function stagedWorld(layout: TutorialLayout): Promise<{ stage: Stage; items: WorldItem[] }> {
  const stage = await buildStage(generateSecretKey(), 'a'.repeat(64), layout, keyAt)
  const rk = regionKeyAt(layout.cover.base, layout.cover.height, 20)
  const found = await unbag(stage.bags[0], rk.key, undefined, { at: regionBase(layout.cover.base, layout.cover.height), plane: layout.plane }, layout.cover.height)
  const items: WorldItem[] = found
    .filter((h) => h.type === 'shard' && h.shard && h.eventId !== stage.ids.blueBox)
    .map((h) => ({ key: h.eventId, type: 'shard', at: h.at, plane: h.plane, height: h.height, mine: false, shard: h.shard! }))
  return { stage, items }
}

/** Away from the camera along the course's forward: the camera looks along it, as the tutorial's view does. */
function axesFor(layout: TutorialLayout): ViewAxes {
  return { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: (-layout.frame.fwd) as 1 | -1 } }
}

/** Stand the walker at course point `p` with GRAVITY on, in WALK, the screen's away along the course. */
async function standAt(layout: TutorialLayout, items: WorldItem[], p: [number, number, number]): Promise<void> {
  useShards.setState({ worldItems: () => items })
  const at = courseToWorld(layout.frame, p)
  useCyberspace.setState({ position: { ...at }, cursor: { ...at }, anchor: { ...at }, screenAxes: axesFor(layout) })
  // The walls built before the first step, as a walker who has stood there a moment has them.
  warmWalls(useCyberspace.getState().plane, at)
  await wallsBuilt()
  useWalk.getState().setGravity(true)
  useWalk.getState().enter()
  expect(useCyberspace.getState().walking).toBe(true)
}

/**
 * Hold FORWARD for `ms` as walkHold.ts does (one press at once, then one
 * every WALK_HOLD_MS), from when `until` first holds, in 16 ms frames, then
 * let the fall play out. Where the walker ends: the cursor, which the walk
 * moves at once while its proofs catch up (none land here: the walk was
 * stood on the course by hand, so its chain is not there, and where it goes
 * is the walk's to say, not the proofs').
 */
async function holdForward(ms: number, until: (t: number) => boolean = () => true): Promise<Position> {
  let t = 0
  let begun: number | null = null
  let nextPress = 0
  for (; t < 20_000; t += 16) {
    if (begun === null && until(t)) { begun = t; nextPress = t }
    if (begun !== null && t - begun <= ms && t >= nextPress) {
      useWalk.getState().press('away')
      nextPress += WALK_HOLD_MS
    }
    clock += 16
    tickFall()
    if (begun !== null && t - begun > ms && !fallState()) break
  }
  return useCyberspace.getState().cursor
}

/** A world point as a course point, for the messages. */
function coursePoint(layout: TutorialLayout, p: Position): string {
  const o = courseToWorld(layout.frame, [0, 0, 0])
  const x = Number(p.x - o.x) * layout.frame.side
  const z = Number(p.z - o.z) * layout.frame.fwd
  return `(x ${x}, y ${Number(p.y - o.y)}, z ${z})`
}

beforeEach(async () => {
  posted.length = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  walkFacing.valid = false
  useWalk.getState().exit()
  useWalk.getState().setGravity(false)
  useWorkshop.setState({ open: false })
  clearWalls()
  useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode: 'off' }, scaleExp: 0, view: canonicalQuaternion() })
  await useCyberspace.getState().respawn()
  useCyberspace.getState().cancel()
  useCalibration.setState({ cantorMsByHeight: undefined })
  start = { ...useCyberspace.getState().position }
})

afterEach(() => {
  useWalk.getState().exit()
  vi.restoreAllMocks()
})

const HOLDS = [900, 1200, 2000, 3000]

describe.each([[1, 1], [1, -1], [-1, 1], [-1, -1]] as const)('the finish deck\'s wall, the course facing fwd %i side %i', (fwd, side) => {
  // The trampoline's near cell and middle (its cells are z 24 to 26). Not its far cell: held forward from the
  // bounce's first frame there, the walker leaves the pad before it has risen and runs in under the deck, whose
  // underside stops the rise (ceiling at stand y 8), and on below it to the floor: under the deck, not over it,
  // so no wall at its far edge can catch it (reported with this change, not part of it).
  it.each(HOLDS.flatMap((ms) => [24, 25].map((z) => [ms, z])))('a forward hold of %i ms through the bounce, from a standstill on the trampoline at z %i, comes down on the deck', async (ms, z) => {
    const layout = layoutFacing(start, fwd, side)
    const { items } = await stagedWorld(layout)
    // On the trampoline (stand y 2), a jump in place lands on it and it bounces; the hold begins with the bounce.
    await standAt(layout, items, [0, 2, z])
    useWalk.getState().press('up')
    const end = await holdForward(ms, () => (fallState()?.v0 ?? 0) > JUMP_SPEED + 1e-9)
    expect(onDeck(layout.frame, end), `came down at ${coursePoint(layout, end)}`).toBe(true)
  })

  it.each(HOLDS)('a forward hold of %i ms run from the square before the trampoline, stepping up onto it, comes down on the deck', async (ms) => {
    const layout = layoutFacing(start, fwd, side)
    const { items } = await stagedWorld(layout)
    // The trampoline's square's near edge (stand y 1); the hold walks onto the trampoline and its step up launches.
    await standAt(layout, items, [0, 1, 22])
    const end = await holdForward(ms + 300)
    expect(onDeck(layout.frame, end), `came down at ${coursePoint(layout, end)}`).toBe(true)
  })
})

describe('the wall itself', () => {
  it('walls a walker on the deck in on the far side and both sides, not the near edge, and stands inside the covering region', async () => {
    const layout = layoutFacing(start, 1, 1)
    const { stage, items } = await stagedWorld(layout)
    useShards.setState({ worldItems: () => items })
    const walls = items.map((w) => ({ key: w.key, at: w.at, height: w.height, plane: w.plane, shard: w.shard!, author: '', mine: false }))
    const step = (p: [number, number, number], axis: 'x' | 'z', dir: 1 | -1): Position => {
      const worldDir = (axis === 'z' ? layout.frame.fwd : layout.frame.side) * dir as 1 | -1
      return walkStep(courseToWorld(layout.frame, p), axis, worldDir, 1n, walls, true).to
    }
    // Every height the wall stands over the deck (stand y 10 to 14): the far edge and the sides hold.
    for (let y = DECK_ZONE.y[0]; y < 9 + WALL_RISE; y++) {
      expect(step([0, y, 34], 'z', 1), `far edge at y ${y}`).toEqual(courseToWorld(layout.frame, [0, y, 34]))
      expect(step([3, y, 31], 'x', 1), `side at y ${y}`).toEqual(courseToWorld(layout.frame, [3, y, 31]))
      expect(step([-3, y, 31], 'x', -1), `other side at y ${y}`).toEqual(courseToWorld(layout.frame, [-3, y, 31]))
    }
    // The near edge is open: the bounce comes in over it.
    expect(step([0, 12, 28], 'z', -1)).toEqual(courseToWorld(layout.frame, [0, 12, 27]))
    // Every wall piece is in the covering bag's region (spec §7.6).
    const wallIds = new Set(stage.ids.walls)
    expect(wallIds.size).toBe(COURSE.filter((p) => p.piece.startsWith('wall-')).length)
    for (const w of items.filter((i) => wallIds.has(i.key))) expect(inRegion(w.at, layout.cover.base, layout.cover.height)).toBe(true)
    // And all of each wall, not only its origin: every cell it covers, x -4 to 4, z 28 to 35, from the deck to its top.
    for (const x of [-4, 4]) for (const z of [28, 35]) for (const y of [9, 9 + WALL_RISE]) {
      expect(inRegion(courseToWorld(layout.frame, [x, y, z]), layout.cover.base, layout.cover.height), `x ${x} y ${y} z ${z}`).toBe(true)
    }
    // The finish chest sits on the deck, inside the walls.
    expect(onDeck(layout.frame, courseToWorld(layout.frame, FINISH_CHEST))).toBe(true)
  })

  it('takes no taps, so the finish chest before it is tapped through it, as the blue box is', async () => {
    const layout = layoutFacing(start, 1, 1)
    const { stage } = await stagedWorld(layout)
    setGuideBags(stage.bags, { passTaps: passTapsOf(stage) })
    expect(stage.ids.walls.length).toBeGreaterThan(0)
    for (const id of stage.ids.walls) expect(passesTaps(id)).toBe(true)
    expect(passesTaps(stage.ids.blueBox)).toBe(true)
    expect(passesTaps(stage.ids.finishChest)).toBe(false)
    setGuideBags(null)
  })
})
