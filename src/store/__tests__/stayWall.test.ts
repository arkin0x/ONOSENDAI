/**
 * stayWall.test.ts - STAY IN THIS CHUNK's wall (lib/terrain/chunkWall.ts
 * stayHull) as WALK's walls read it (store/walkWalls.ts): every way out of
 * the chunk is held at its edge (all six faces, a step of one gibson or a
 * long one, a diagonal), every step inside it goes, with gravity on and off
 * (walkStep, the stepped WALK) and in fluid WALK (faceDistance, what its
 * glide stops at). The hull is open, so it is never a solid you stand in.
 * And the blocks' walls carry it only while the lock is on in TERRAIN
 * (store/useTerrain.ts publishWalls).
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

import type { AxisName, Position } from '../../lib/space'
import { clearWalls, faceDistance, stepLimit, wallItems, type WallItem } from '../walkWalls'
import { standing, walkStep } from '../walkStep'
import { planWalkMove, type Stepper } from '../../lib/walkSlide'
import { CHUNK_SIDE, STAY_WALL_NAME, stayHull, stayWallItem } from '../../lib/terrain/chunkWall'
import { solidsOf, wallsOf } from '../../lib/walkConstrain'
import { chunkKey, chunkOf } from '../../lib/terrain/coords'
import { TerrainWorld } from '../../lib/terrain/world'
import { setTerrainSession, useTerrain, type TerrainSession } from '../useTerrain'
import { resetStay, setLock } from '../../terrain/stayLock'

/** A chunk well inside the axes: its low corner. */
const BASE = chunkOf((1n << 50n) + (7n << 5n), (1n << 50n) + (3n << 5n), (1n << 50n) + (11n << 5n), 0)
const KEY = chunkKey(BASE)
const at = (x: number, y: number, z: number): Position => ({ x: BASE.x + BigInt(x), y: BASE.y + BigInt(y), z: BASE.z + BigInt(z) })
const AXES: AxisName[] = ['x', 'y', 'z']
const DOWN = { axis: 'y', dir: -1 } as const

let wall: WallItem
beforeEach(() => {
  clearWalls()
  wall = stayWallItem(BASE, KEY)
})

describe('the hull', () => {
  it('is open: six faces, none sharing an edge, so no solid encloses the walker', () => {
    const s = stayHull()
    expect(s.name).toBe(STAY_WALL_NAME)
    expect(s.faces).toHaveLength(12)
    expect(solidsOf(wallsOf(s)).count).toBe(0)
  })
})

describe('the lock holds every way out', () => {
  it('on each of the six faces, a step out is not taken, and a step back in goes', () => {
    for (const axis of AXES) for (const dir of [1, -1] as const) {
      const edge = dir < 0 ? 0 : CHUNK_SIDE - 1
      const p = at(16, 16, 16)
      p[axis] = BASE[axis] + BigInt(edge)
      expect(stepLimit(p, axis, dir, 1n, [wall])).toMatchObject({ reach: 0n, by: wall })
      expect(stepLimit(p, axis, -dir as 1 | -1, 1n, [wall]).reach).toBe(1n)
    }
  })

  it('a long step stops on the chunk\'s last gibson; steps inside go their full way', () => {
    expect(stepLimit(at(16, 16, 16), 'x', 1, 100n, [wall]).reach).toBe(15n)
    expect(stepLimit(at(16, 16, 16), 'z', -1, 100n, [wall]).reach).toBe(16n)
    for (const axis of AXES) for (const dir of [1, -1] as const) expect(stepLimit(at(10, 10, 10), axis, dir, 1n, [wall]).reach).toBe(1n)
  })

  it('gravity off: a press at the edge does not step, on the ground or in the air', () => {
    const corner = at(0, 9, 31)
    expect(walkStep(corner, 'x', -1, 1n, [wall]).to).toEqual(corner)
    expect(walkStep(corner, 'z', 1, 1n, [wall]).to).toEqual(corner)
    expect(walkStep(corner, 'x', 1, 1n, [wall]).to).toEqual(at(1, 9, 31))
    expect(walkStep(at(5, 31, 5), 'y', 1, 1n, [wall]).to).toEqual(at(5, 31, 5))
  })

  it('gravity on: the chunk\'s floor holds you, and a press at a side face does not step', () => {
    const floor = at(4, 0, 4)
    expect(standing(floor, [wall], true, DOWN)).toBe(true)
    expect(walkStep(floor, 'y', -1, 1n, [wall], true, DOWN).to).toEqual(floor)
    const side = at(0, 0, 4)
    expect(walkStep(side, 'x', -1, 1n, [wall], true, DOWN).to).toEqual(side)
    expect(walkStep(side, 'x', 1, 1n, [wall], true, DOWN).to).toEqual(at(1, 0, 4))
  })

  it('a diagonal press: held at a corner, along the edge it slides on this side, inside it goes both ways at once', () => {
    // As WALK walks a press (store/useWalk.ts stepperFor): each straight piece is a walkStep.
    const step: Stepper<WallItem> = (p, axis, dir, n) => { const s = walkStep(p, axis, dir, n, [wall]); return { to: s.to, by: s.by } }
    const out = { main: { axis: 'x', dir: -1 }, side: { axis: 'z', dir: -1 }, lean: null } as const
    const corner = at(0, 9, 0)
    expect(planWalkMove(corner, out, 1n, step)).toMatchObject({ to: corner, kind: 'held' })
    // On the low x face, a diagonal out through it: never across; at most the slide along the face, still in the chunk.
    const edge = planWalkMove(at(0, 9, 5), out, 1n, step)
    expect(edge.to.x).toBe(BASE.x)
    expect(edge.kind).not.toBe('diagonal')
    expect(planWalkMove(at(5, 9, 5), out, 1n, step)).toMatchObject({ to: at(4, 9, 4), kind: 'diagonal' })
    // Gravity on, standing on the chunk's floor: the same at the corner.
    const floorCorner = at(0, 0, 0)
    const stepG: Stepper<WallItem> = (p, axis, dir, n) => { const s = walkStep(p, axis, dir, n, [wall], true, DOWN); return { to: s.to, by: s.by } }
    expect(planWalkMove(floorCorner, out, 1n, stepG, { stands: (p) => standing(p, [wall], true, DOWN), down: DOWN }).to).toEqual(floorCorner)
  })

  it('fluid WALK: the glide meets the face half a gibson from the last gibson, and nothing from inside', () => {
    const d = faceDistance(at(31, 8, 8), 'x', 1, [wall])
    expect(d).not.toBeNull()
    expect(d!).toBeCloseTo(0.5, 6)
    expect(faceDistance(at(0, 8, 8), 'z', -1, [wall], 1n)).toBeNull()
    expect(faceDistance(at(8, 8, 0), 'z', -1, [wall])!).toBeCloseTo(0.5, 6)
    expect(faceDistance(at(16, 16, 16), 'x', 1, [wall], 1n)).toBeNull()
  })

  it('reaches no walker outside the chunk\'s region', () => {
    // Two chunks over, the region test skips it before anything is measured.
    const away = { ...at(16, 16, 16), x: BASE.x + 80n }
    expect(stepLimit(away, 'x', -1, 1n, [wall]).reach).toBe(1n)
  })
})

describe('WALK\'s walls carry the lock only while it is on in TERRAIN', () => {
  it('joins the blocks\' walls for the field\'s owner, and leaves them when let go or out of TERRAIN', () => {
    resetStay()
    const world = new TerrainWorld(BASE, { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } })
    // A field by hand: what closing it reads too (TERRAIN coming on asks the field to follow you, store/useTerrain.ts follow).
    setTerrainSession({ owner: 'me', plane: 0, world, pending: new Map(), layers: new Map(), db: null } as unknown as TerrainSession)
    useTerrain.setState({ active: true })
    try {
      expect(wallItems(0).some((w) => w.key === `stay:${KEY}`)).toBe(false)
      setLock('me', KEY)
      const items = wallItems(0)
      expect(items.filter((w) => w.key === `stay:${KEY}`)).toHaveLength(1)
      // The same list while nothing changed (WALK asks many times a frame).
      expect(wallItems(0)).toBe(items)
      // Someone else's lock is not this field's.
      setLock('me', null)
      setLock('them', KEY)
      expect(wallItems(0).some((w) => w.key === `stay:${KEY}`)).toBe(false)
      setLock('me', KEY)
      useTerrain.setState({ active: false })
      expect(wallItems(0).some((w) => w.key === `stay:${KEY}`)).toBe(false)
    } finally {
      useTerrain.setState({ active: false })
      setTerrainSession(null)
      resetStay()
    }
  })
})
