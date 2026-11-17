/**
 * walkEyeRig.test.ts - the rig's eye: turned with the body's heading about up
 * only, never tipped by a look up or down, kept when the look is straight
 * down, and the icosahedron's 0.875 over its origin for no avatar.
 */
import { describe, expect, it, vi } from 'vitest'

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

import { Vector3 } from 'three'
import { newShard, type ShardModel } from 'sno-core/shards'
import { WalkEyeRig, type EyeFrame } from '../walkEyeRig'
import { WALL_AXES } from '../../store/walkWalls'
import { canonicalQuaternion, rotateView, viewAxes } from '../../lib/space'

/** A column 0 to 2 units tall, with an eye written one unit forward (wire -Z, the nose) and one up. */
const tall: ShardModel = { ...newShard('Tall'), vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [0, 2, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }], faces: [[0, 1, 2]], extra: { eye: [0, 120, -120] } }

const frame = (shard: ShardModel | null, forward: { x: number; y: number; z: number }): EyeFrame => ({
  shard, scaleExp: 0, axes: WALL_AXES, plane: 1, cursor: { x: 0n, y: 0n, z: 0n }, lead: [0, 0, 0], forward, up: { axis: 'y', dir: 1 }, walls: false, now: 0,
})

describe('WalkEyeRig', () => {
  it('gives the icosahedron its 0.875 over its origin, its lowest point (0.375 over its centre)', () => {
    const v = new WalkEyeRig().offset(frame(null, { x: 0, y: 0, z: -1 }), new Vector3())
    expect(v.toArray()).toEqual([0, 0.875, 0])
  })

  it('turns the eye with the heading, about up only', () => {
    const rig = new WalkEyeRig()
    // Looking down render -Z: the nose's way, so the eye is one forward and one up.
    const a = rig.offset(frame(tall, { x: 0, y: 0, z: -1 }), new Vector3())
    expect(a.distanceTo(new Vector3(0, 1, -1))).toBeLessThan(1e-9)
    // Looking along +X and down: the eye swings to +X, and stays one up.
    const b = rig.offset(frame(tall, { x: 0.6, y: -0.8, z: 0 }), new Vector3())
    expect(b.distanceTo(new Vector3(1, 1, 0))).toBeLessThan(1e-9)
  })

  it('under a world the compass has turned, the eye is still up on your screen and turns about your up (DECK-0003 §1.18)', () => {
    // A quarter turn: render +Y is no longer cyberspace +Y.
    const axes = viewAxes(rotateView(canonicalQuaternion(), 'up'))
    expect(axes.up.axis).not.toBe('y')
    const rig = new WalkEyeRig()
    const f = (forward: { x: number; y: number; z: number }): EyeFrame => ({ ...frame(tall, forward), axes, up: { axis: axes.up.axis, dir: axes.up.dir } })
    expect(rig.offset(f({ x: 0, y: 0, z: -1 }), new Vector3()).distanceTo(new Vector3(0, 1, -1))).toBeLessThan(1e-9)
    expect(rig.offset(f({ x: 0.6, y: -0.8, z: 0 }), new Vector3()).distanceTo(new Vector3(1, 1, 0))).toBeLessThan(1e-9)
  })

  it('keeps the heading it had when the look is straight down', () => {
    const rig = new WalkEyeRig()
    rig.offset(frame(tall, { x: 1, y: 0, z: 0 }), new Vector3())
    const v = rig.offset(frame(tall, { x: 0, y: -1, z: 0 }), new Vector3())
    expect(v.distanceTo(new Vector3(1, 1, 0))).toBeLessThan(1e-9)
  })
})
