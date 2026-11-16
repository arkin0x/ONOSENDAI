/**
 * walkEyeWalls.test.ts - eyeReach, the WALK eye pulled back short of the
 * faces that stop a walker: a ceiling over a tall avatar's eye, the floor the
 * walker's point is in, an eye below that floor, a third-person eye behind
 * the avatar with a wall behind it, a wall beside the eye, a glancing plane,
 * a fall between gibsons, and (the rule that matters) that whatever comes
 * back, the line from the walker to the eye crosses nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('../../lib/contacts', () => ({ GENERAL_RELAYS: [], followsOf: async () => [], fetchContacts: async () => [] }))

import { newShard, type ShardModel } from 'sno-core/shards'
import { withConstrain } from '../../lib/walkConstrain'
import type { AxisName, Position } from '../../lib/space'
import { clearWalls, eyeReach, type WallItem } from '../walkWalls'

const AXES: AxisName[] = ['x', 'y', 'z']
const AT: Position = { x: 1n << 60n, y: 3n << 58n, z: 5n << 57n }
const ROOM = 0.15

/** A square slab two ticks thick across `axis`, its near face `near` units out on side `dir`, `half` units each way. */
function slab(axis: AxisName, dir: 1 | -1, near: number, half = 2, unit = 0): ShardModel {
  const i = AXES.indexOf(axis)
  const j = (i + 1) % 3, k = (i + 2) % 3
  const verts: ShardModel['vertices'] = []
  for (const depth of [near * 120, near * 120 + 2]) for (const [a, b] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
    const t = [0, 0, 0]; t[i] = Math.round(depth) * dir; t[j] = a * 120; t[k] = b * 120
    const p = t.map((x) => Math.floor(x / 120)) as [number, number, number]
    const r = t.map((x, n) => x - p[n] * 120) as [number, number, number]
    verts.push(r.some((x) => x !== 0) ? { p, t: r, c: [1, 1, 1] } : { p, c: [1, 1, 1] })
  }
  const q = (a: number, b: number, c: number, e: number): number[][] => [[a, b, c], [a, c, e]]
  const faces = [...q(0, 1, 2, 3), ...q(4, 7, 6, 5), ...q(0, 4, 5, 1), ...q(1, 5, 6, 2), ...q(2, 6, 7, 3), ...q(3, 7, 4, 0)] as Array<[number, number, number]>
  return withConstrain({ ...newShard('Slab'), unit, mode: 'solid', vertices: verts, faces }, 'all')
}

let n = 0
const item = (shard: ShardModel): WallItem => ({ key: `eye-${n++}`, at: { ...AT }, height: 84, plane: 1, shard })

/** Where the eye ends up, gibsons from the walker: the share times the eye. */
function placed(eye: [number, number, number], items: WallItem[], lead: [number, number, number] = [0, 0, 0], up = { axis: 'y' as AxisName, dir: 1 as 1 | -1 }): number[] {
  const k = eyeReach(AT, lead, eye, ROOM, items, up)
  expect(k).toBeGreaterThanOrEqual(0)
  expect(k).toBeLessThanOrEqual(1)
  return eye.map((v) => v * k)
}

afterEach(() => clearWalls())

describe('eyeReach', () => {
  it('leaves the eye where it is with nothing in the way', () => {
    expect(eyeReach(AT, [0, 0, 0], [0, 1.325, 0], ROOM, [])).toBe(1)
    expect(eyeReach(AT, [0, 0, 0], [0, 1.325, 0], ROOM, [item(slab('x', 1, 3))])).toBe(1)
  })

  it('is 1 for an eye at the walker’s point', () => {
    expect(eyeReach(AT, [0, 0, 0], [0, 0, 0], ROOM, [item(slab('y', 1, 0.5))])).toBe(1)
  })

  it('holds a tall avatar’s eye under a ceiling, a near plane’s room and more short of it', () => {
    // The Ship's eye is 1.325 up; a one-gibson tunnel's ceiling is 1 up.
    const [, y] = placed([0, 1.325, 0], [item(slab('y', 1, 1))])
    expect(y).toBeLessThanOrEqual(1 - ROOM + 1e-9)
    expect(y).toBeGreaterThan(0.6)
  })

  it('lets the eye rise from the floor the walker’s point is in', () => {
    // Walking along a floor keeps the walker's point in the floor's plane.
    expect(eyeReach(AT, [0, 0, 0], [0, 0.375, 0], ROOM, [item(slab('y', -1, 0))])).toBe(1)
  })

  it('holds an eye below the walker at the floor it stands in', () => {
    expect(eyeReach(AT, [0, 0, 0], [0, -0.5, 0], ROOM, [item(slab('y', -1, 0))])).toBe(0)
    // Up along another axis (a turned view's gravity): the same floor, seen from +X.
    expect(eyeReach(AT, [0, 0, 0], [-0.5, 0, 0], ROOM, [item(slab('x', -1, 0))], { axis: 'x', dir: 1 })).toBe(0)
  })

  it('pulls a third-person eye behind the avatar in short of a wall behind it', () => {
    // An eye 3 gibsons behind and a little up; a wall 1 gibson behind.
    const eye: [number, number, number] = [0, 0.5, 3]
    expect(eyeReach(AT, [0, 0, 0], eye, ROOM, [])).toBe(1)
    const at = placed(eye, [item(slab('z', 1, 1))])
    expect(at[2]).toBeLessThanOrEqual(1 - ROOM + 1e-9)
    expect(at[2]).toBeGreaterThan(0.5)
  })

  it('steps the eye back from a wall beside it', () => {
    // An eye 0.45 to the side, a wall 0.5 to that side: 0.05 away, inside the near plane's room.
    const at = placed([0.45, 0, 0], [item(slab('x', 1, 0.5))])
    expect(0.5 - at[0]).toBeGreaterThanOrEqual(ROOM - 1e-9)
    // A wall 0.1 beside the whole line up to the eye: back down to the walker.
    const up = placed([0, 1, 0], [item(slab('x', 1, 0.1))])
    expect(up[1]).toBeLessThan(ROOM)
    // A short wall beside the walker that the eye rises clear of: it stays.
    expect(eyeReach(AT, [0, 0, 0], [0, 1, 0], ROOM, [item(slab('x', 1, 0.1, 0.25))])).toBe(1)
  })

  it('keeps the near plane’s room square to a face the line meets at a slant', () => {
    const at = placed([1, 1, 0], [item(slab('y', 1, 0.5))])
    expect(0.5 - at[1]).toBeGreaterThanOrEqual(ROOM - 1e-9)
  })

  it('asks from a fall’s height between gibsons', () => {
    // Half a gibson up in a fall, a ceiling 1 up: an eye 0.375 above the fall's point meets it.
    const at = placed([0, 0.375, 0], [item(slab('y', 1, 1))], [0, 0.5, 0])
    expect(0.5 + at[1]).toBeLessThanOrEqual(1 - ROOM + 1e-9)
  })

  it('scales with the shard’s unit', () => {
    // Unit 2: the slab's near face is 4 gibsons up.
    expect(eyeReach(AT, [0, 0, 0], [0, 3, 0], ROOM, [item(slab('y', 1, 1, 2, 2))])).toBe(1)
    const [, y] = placed([0, 6, 0], [item(slab('y', 1, 1, 2, 2))])
    expect(y).toBeLessThanOrEqual(4 - ROOM + 1e-9)
  })

  it('never leaves the line from the walker to the eye crossing a face', () => {
    // Pseudo-random rooms and eyes, fixed seed: the eye it gives, asked again
    // with no room at all, is reached whole (nothing crosses its line).
    let seed = 7
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let trial = 0; trial < 120; trial++) {
      clearWalls()
      const items: WallItem[] = []
      for (let w = 0; w < 4; w++) {
        const axis = AXES[Math.floor(rnd() * 3)]
        items.push(item(slab(axis, rnd() < 0.5 ? 1 : -1, Math.round((0.1 + rnd() * 2) * 120) / 120, 0.5 + rnd() * 2)))
      }
      const eye: [number, number, number] = [(rnd() - 0.5) * 6, (rnd() - 0.3) * 6, (rnd() - 0.5) * 6]
      const k = eyeReach(AT, [0, 0, 0], eye, ROOM, items)
      const got = eye.map((v) => v * k) as [number, number, number]
      expect(eyeReach(AT, [0, 0, 0], got, 0, items)).toBe(1)
    }
  })
})
