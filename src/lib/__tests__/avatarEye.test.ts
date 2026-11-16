/**
 * avatarEye.test.ts - where WALK's camera sits on an avatar: the `eye` field
 * read (and every malformed value read as absent), the automatic eye in exact
 * integers, the icosahedron's 0.375, the eye drawn at the avatar's scale and
 * within its size limit, and the body turned about up only.
 */
import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { fromPayload, newShard, type ShardModel } from 'sno-core/shards'
import { MARKER_EYE, autoEye, eyeChosen, eyeOf, readEye, walkEyeLocal, yawOnly } from '../avatarEye'
import { MAX_AVATAR_RADIUS, avatarFromEvent } from '../avatar'

/** arkinox's Ship, his kind 11333 avatar (0000045c...): built 0.8 to 1.4 gibsons above its origin. */
const SHIP = {"v":2,"name":"Ship","unit":0,"extent":8,"mode":"solid","vertices":[[0,1,0],[-1,1,0],[0,1,-2],[0,1,1],[-1,1,0],[0,1,0],[0,1,0],[0,0,0],[-1,0,0],[1,0,0],[-1,1,0],[-1,1,1],[-1,1,0],[0,1,1],[0,1,0],[0,1,0],[0,1,1],[-1,1,1]],"ticks":[[48,0,0],[72,0,0],[0,0,96],-1,[72,24,72],[48,24,72],[0,48,0],[0,96,0],[0,96,72],[0,96,72],[48,0,96],[96,0,0],[72,24,96],[24,0,0],[72,0,96],[48,24,96],[48,0,24],[72,0,24]],"colors":[64,64,64,251,59,59,64,251,59,59,249,249,249,249,249,249,238,238],"faces":[[9,0,5],[4,1,8],[2,0,7],[1,2,7],[2,6,0],[1,6,2],[6,1,3],[3,0,6],[3,7,0],[3,1,7],[3,0,9],[3,8,1],[4,3,1],[5,0,3],[4,8,3],[5,3,9],[15,14,13],[11,10,12],[17,12,10],[12,17,11],[10,11,17],[15,13,16],[14,15,16],[14,16,13]],"opacity":95}

function ship(extra: Record<string, unknown> = {}): ShardModel {
  const m = fromPayload({ ...SHIP, ...extra }, 'avatar:test')
  if (!m) throw new Error('the Ship did not read')
  return m
}

/** A column of points from `bottom` to `top` ticks on Y, at a unit. */
function column(bottom: number, top: number, unit = 0): ShardModel {
  const v = (y: number): ShardModel['vertices'][number] => {
    const p = Math.floor(y / 120)
    const t = y - p * 120
    return t === 0 ? { p: [0, p, 0], c: [1, 1, 1] } : { p: [0, p, 0], t: [0, t, 0], c: [1, 1, 1] }
  }
  return { ...newShard('Column'), unit, vertices: [v(bottom), v(top)] }
}

describe('readEye', () => {
  it('reads three whole numbers of ticks', () => {
    expect(readEye([0, 159, 0])).toEqual([0, 159, 0])
    expect(readEye([-7680, 7680, 12])).toEqual([-7680, 7680, 12])
    expect(readEye([0, 0, 0])).toEqual([0, 0, 0])
    expect(Object.is(readEye([-0, 5, 0])![0], 0)).toBe(true)
  })

  it('reads every malformed value as absent, never throwing', () => {
    for (const bad of [null, undefined, 5, '0,159,0', {}, [], [0, 1], [0, 1, 2, 3], [0, 1.5, 0], [0, '1', 0], [0, null, 0], [0, 7681, 0], [-7681, 0, 0], [0, NaN, 0], [0, Infinity, 0], [true, 0, 0]]) {
      expect(readEye(bad)).toBeUndefined()
    }
  })
})

describe('the automatic eye', () => {
  it('puts the Ship’s eye one eighth of its height below its top: 159 ticks, 1.325 gibsons', () => {
    // Top 168, bottom 96: 168 - floor(72 / 8) = 159.
    expect(autoEye(ship())).toEqual([0, 159, 0])
    expect(eyeOf(ship())).toEqual([0, 159, 0])
    expect(eyeChosen(ship())).toBe(false)
  })

  it('is exact integer arithmetic, rounding the eighth down', () => {
    // A height of 10 ticks: floor(10 / 8) = 1 below the top.
    expect(autoEye(column(0, 10))).toEqual([0, 9, 0])
    // Below the origin entirely: -240 to -120, eye at -120 - 15.
    expect(autoEye(column(-240, -120))).toEqual([0, -135, 0])
    // Centred: -120 to 120, eye at 120 - 30 = 90 (XOR's stella octangula is this shape at unit 0).
    expect(autoEye(column(-120, 120))).toEqual([0, 90, 0])
  })

  it('stays at the origin for an avatar with no vertices of its own', () => {
    expect(autoEye({ vertices: [] })).toEqual([0, 0, 0])
  })

  it('uses a written eye, [0, 0, 0] included, and falls back on a malformed one', () => {
    expect(eyeOf(ship({ eye: [0, 0, 0] }))).toEqual([0, 0, 0])
    expect(eyeChosen(ship({ eye: [0, 0, 0] }))).toBe(true)
    expect(eyeOf(ship({ eye: [10, -400, 3] }))).toEqual([10, -400, 3])
    expect(eyeOf(ship({ eye: [0, 1.5, 0] }))).toEqual([0, 159, 0])
    expect(eyeChosen(ship({ eye: 'up' }))).toBe(false)
  })
})

describe('walkEyeLocal', () => {
  it('gives the icosahedron its eye 0.375 cells above its centre', () => {
    expect(MARKER_EYE).toBe(0.375)
    expect(walkEyeLocal(null, 0, 1)).toEqual([0, 0.375, 0])
    // Shrunk at the top of the ladder with the marker.
    expect(walkEyeLocal(null, 82, 0.25)).toEqual([0, 0.375 * 0.25, 0])
    // An avatar with no vertices of its own is drawn as the icosahedron.
    expect(walkEyeLocal({ ...newShard('Empty') }, 0, 1)).toEqual([0, 0.375, 0])
  })

  it('draws the Ship’s eye at its scale: 1.325 gibsons up at 2^0', () => {
    const e = walkEyeLocal(ship(), 0, 1)
    expect(e[0]).toBe(0)
    expect(e[1]).toBeCloseTo(1.325, 12)
    expect(e[2]).toBe(0)
  })

  it('uses the icosahedron’s eye once a custom avatar is drawn as it, zoomed far out', () => {
    // The Ship reaches 1.4 gibsons: at 2^2 that is 0.35 cells, under the marker's half cell.
    expect(walkEyeLocal(ship(), 2, 1)).toEqual([0, 0.375, 0])
    // At 2^1 it is still its mesh, at half size.
    expect(walkEyeLocal(ship(), 1, 1)[1]).toBeCloseTo(1.325 / 2, 12)
  })

  it('keeps the payload frame: +Z toward the viewer is render +Z', () => {
    const e = walkEyeLocal(ship({ eye: [0, 0, -120] }), 0, 1)
    expect(e[2]).toBeCloseTo(-1, 12)
  })

  it('scales with unit and with the shrink a big avatar is drawn at', () => {
    // Unit 1: a tick is twice as far.
    expect(walkEyeLocal(column(0, 120, 1), 0, 1)[1]).toBeCloseTo(2 * (105 / 120), 12)
    // 8 gibsons tall is shrunk to 4: the eye comes down with it.
    const tall = column(0, 960)
    expect(walkEyeLocal(tall, 0, 1)[1]).toBeCloseTo((840 / 120) * 0.5, 12)
  })

  it('keeps an eye far off the avatar within the size limit', () => {
    const e = walkEyeLocal(ship({ eye: [0, 7680, -7680] }), 0, 1)
    expect(e[1]).toBe(MAX_AVATAR_RADIUS)
    expect(e[2]).toBe(-MAX_AVATAR_RADIUS)
  })
})

describe('yawOnly', () => {
  const nose = (q: Quaternion): Vector3 => new Vector3(0, 0, -1).applyQuaternion(q)
  const top = (q: Quaternion): Vector3 => new Vector3(0, 1, 0).applyQuaternion(q)

  it('keeps the heading and drops the look up or down', () => {
    for (const pitch of [-1.4, -0.6, 0, 0.5, 1.3]) {
      const cam = new Quaternion().setFromEuler(new Euler(pitch, 0.8, 0, 'YXZ'))
      const body = yawOnly(cam, new Quaternion())
      expect(top(body).y).toBeCloseTo(1, 12)
      const want = new Vector3(0, 0, -1).applyQuaternion(new Quaternion().setFromEuler(new Euler(0, 0.8, 0)))
      expect(nose(body).distanceTo(want)).toBeLessThan(1e-9)
    }
  })

  it('takes the heading from the camera’s up when looking straight down', () => {
    const cam = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0.3, 0, 'YXZ'))
    const body = yawOnly(cam, new Quaternion())
    const want = new Vector3(0, 0, -1).applyQuaternion(new Quaternion().setFromEuler(new Euler(0, 0.3, 0)))
    expect(nose(body).distanceTo(want)).toBeLessThan(1e-6)
  })
})

describe('an avatar event’s eye', () => {
  const base = { name: 'Tri', unit: 0, mode: 'solid', vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] }
  const read = (payload: Record<string, unknown>): ShardModel => avatarFromEvent({ kind: 11333, pubkey: 'ab'.repeat(32), content: JSON.stringify(payload), tags: [] })!

  it('keeps a version 2 eye as written', () => {
    expect(read({ ...base, v: 2, colors: [1, 1, 1], eye: [0, 10, 120] }).extra?.eye).toEqual([0, 10, 120])
  })

  it('puts a version 1 eye into the version 2 frame, as its vertices are', () => {
    const m = read({ ...base, v: 1, colors: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], eye: [0, 10, 120] })
    expect(m.extra?.eye).toEqual([0, 10, -120])
    expect(eyeOf(m)).toEqual([0, 10, -120])
  })
})

describe('the size limit', () => {
  it('brings a far eye inside it as a whole, keeping its direction', () => {
    const e = walkEyeLocal(ship({ eye: [7680, 120, 0] }), 0, 1)
    expect(e[0]).toBeCloseTo(MAX_AVATAR_RADIUS, 12)
    expect(e[1]).toBeCloseTo(MAX_AVATAR_RADIUS / 64, 12)
  })
})
