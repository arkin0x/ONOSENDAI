/**
 * doorRooms.test.ts - a door's room reads as a space at any zoom (arkinox,
 * 2026-11-08): the grid on its real faces only, breathing walls on the faces
 * it was cut at, clipped about the viewer while the viewer stands in it, one
 * grid per nest (the walls nearest you), no label, and nothing at all while the Builder is off.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Position, ViewAxes } from '../../lib/space'
import { alignedOrigin } from '../../store/useCyberspace'
import { gridPeriod } from '../Rooms'
import {
  ROOM_GRID_OPACITY, ROOM_WALL_LABEL, ROOM_WALL_LOOK, ROOM_WALL_OPACITY, doorRooms, gridCorner, inRoom, realFaces, roomBoxes, roomGridPool, type RoomSpec,
} from '../DoorRooms'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } as ViewAxes
const FLIPPED: ViewAxes = { right: { axis: 'x', dir: -1 }, up: { axis: 'z', dir: 1 }, out: { axis: 'y', dir: -1 } } as ViewAxes

const C = 1n << 60n
const P = (x: bigint, y = x, z = x): Position => ({ x, y, z })
const room = (key: string, at: Position, height: number, depth = 1): RoomSpec => ({ key, at, height, depth })
/** Boxes for `rooms` seen from `viewer`, the view anchored on the viewer at 2^0. */
const seen = (rooms: RoomSpec[], viewer: Position, axes = AXES) => roomBoxes(rooms, viewer, alignedOrigin(viewer, 0), 0, axes)

describe('a room\'s real and cut faces', () => {
  it('a room that fits is all real faces, no breathing walls, and carries the grid', () => {
    const [b] = seen([room('a', P(C + 2n), 3)], P(C + 20n))
    expect(b.faces).toEqual([])
    expect(realFaces(b.faces)).toEqual([true, true, true, true, true, true])
    expect(b.grid).toBe(true)
  })

  it('a big room seen from outside is cut about the door: its own faces near the door are real, the rest breathe', () => {
    // Door 3 cells above the low corner of a 2^10 room; the viewer just below it, outside.
    const door = P(C + 3n)
    const [b] = seen([room('a', door, 10)], P(C - 5n))
    expect(b.aboutViewer).toBe(false)
    expect(b.faces).toEqual([{ slot: 0, sign: 1 }, { slot: 1, sign: 1 }, { slot: 2, sign: 1 }])
    // Grid on the three low faces (the room's own), none on the three cut ones.
    expect(realFaces(b.faces)).toEqual([false, true, false, true, false, true])
  })

  it('maps cut faces to the render side a flipped axis puts them on', () => {
    const [b] = seen([room('a', P(C + 3n), 10)], P(C - 5n), FLIPPED)
    expect(b.faces).toEqual([{ slot: 0, sign: -1 }, { slot: 1, sign: 1 }, { slot: 2, sign: -1 }])
    expect(realFaces(b.faces)).toEqual([true, false, false, true, true, false])
  })
})

describe('clipped about the viewer while the viewer stands in the room', () => {
  // A 2^40 room; the door near its low corner, the viewer deep inside.
  const door = P(C + 3n)
  const deep = P(C + (1n << 39n))

  it('clips about the viewer, so the box sits around you, not around a door a trillion cells away', () => {
    expect(inRoom(deep, door, 40)).toBe(true)
    const [b] = seen([room('a', door, 40)], deep)
    expect(b.aboutViewer).toBe(true)
    expect(b.centre).toEqual([0, 0, 0])
    expect(b.size).toEqual([25, 25, 25])
    expect(b.faces).toHaveLength(6)
  })

  it('near a real face, that face is the room\'s own and stands still', () => {
    // 4 cells inside the room's top: the top faces are real, the low ones cut.
    const nearTop = P(C + (1n << 40n) - 4n)
    const [b] = seen([room('a', door, 40)], nearTop)
    expect(b.aboutViewer).toBe(true)
    expect(realFaces(b.faces)).toEqual([true, false, true, false, true, false])
    // The box ends at the top face: the viewer's cell is 3 cells below it.
    expect(b.centre[0] + b.size[0] / 2).toBe(3.5)
  })

  it('outside the room it clips about the door again', () => {
    const outside = P(C - 100n)
    expect(inRoom(outside, door, 40)).toBe(false)
    const [b] = roomBoxes([room('a', door, 40)], outside, alignedOrigin(door, 0), 0, AXES)
    expect(b.aboutViewer).toBe(false)
    // Clipped about the door at the room's low corner: the box runs from the
    // corner (door - 3) to 12 cells past the door.
    expect(b.centre[0] - b.size[0] / 2).toBe(-3.5)
    expect(b.centre[0] + b.size[0] / 2).toBe(12.5)
  })
})

describe('the grid holds still on the room', () => {
  it('is measured from the room\'s own corner, within one pitch of the origin', () => {
    for (const axes of [AXES, FLIPPED]) {
      const [b] = seen([room('a', P(C + 2n), 5)], P(C + 9n), axes)
      const corner = b.centre.map((c, i) => c - b.size[i] / 2)
      const p = gridPeriod(5)
      for (let i = 0; i < 3; i++) {
        const k = (corner[i] - b.corner[i]) / p
        expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9)
        expect(Math.abs(b.corner[i])).toBeLessThanOrEqual(p + 0.5)
      }
    }
  })

  it('keeps the same lines as the clipped window slides with the viewer', () => {
    const door = P(C + 3n)
    const a = P(C + (1n << 39n))
    const b = P(C + (1n << 39n) + 7n)
    const [ra] = seen([room('r', door, 40)], a)
    const [rb] = seen([room('r', door, 40)], b)
    // The view moved 7 cells; every line must move with the space, 7 cells too.
    const p = gridPeriod(40)
    for (let i = 0; i < 3; i++) {
      const k = (ra.corner[i] - (rb.corner[i] + 7)) / p
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9)
    }
  })

  it('stays a small float for a room the width of cyberspace', () => {
    const c = gridCorner(P((1n << 84n) + 12345n), alignedOrigin(P((1n << 84n) + 12345n), 0), 84, 0, AXES)
    for (const v of c) expect(Math.abs(v)).toBeLessThanOrEqual(gridPeriod(84) + 0.5)
  })
})

describe('one grid per nest', () => {
  const outer = room('outer', P(C + 3n), 10, 1)
  const inner = room('inner', P(C + 3n), 4, 2)

  it('outside both, only the outer shell carries the grid: the size you would walk into', () => {
    const boxes = seen([outer, inner], P(C - 50n))
    expect(boxes.map((b) => [b.key, b.grid])).toEqual([['outer', true], ['inner', false]])
  })

  it('three deep, from outside, still one grid', () => {
    const boxes = seen([outer, room('mid', P(C + 3n), 7, 2), room('in', P(C + 3n), 3, 3)], P(C - 50n))
    expect(boxes.map((b) => b.grid)).toEqual([true, false, false])
  })

  it('in the outer room but not the inner, both do: the outer is the room around you', () => {
    const boxes = seen([outer, inner], P(C + 30n))
    expect(boxes.map((b) => [b.key, b.grid])).toEqual([['outer', true], ['inner', true]])
  })

  it('in the inner room, only the inner does: the room around you', () => {
    const boxes = seen([outer, inner], P(C + 5n))
    expect(boxes.map((b) => [b.key, b.grid])).toEqual([['outer', false], ['inner', true]])
  })

  it('rooms side by side each keep theirs', () => {
    const boxes = seen([room('a', P(C + 3n), 3), room('b', P(C + 11n), 3)], P(C))
    expect(boxes.map((b) => b.grid)).toEqual([true, true])
  })

  it('from outside, a room keeps its grid when the room around it is clipped about a door far off', () => {
    // A 2^20 room clipped about its door at its low corner; the small room
    // 300 cells along, inside it in space but nowhere near its drawn box.
    const big = room('big', P(C + 3n), 20, 1)
    const small = room('small', P(C + 300n, C + 3n, C + 3n), 4, 2)
    const boxes = seen([big, small], P(C - 50n, C + 3n, C + 3n))
    expect(boxes.map((b) => [b.key, b.grid])).toEqual([['big', true], ['small', true]])
  })

  it('one room drawn twice (a second door being placed in it) is gridded once', () => {
    const boxes = seen([room('a', P(C + 3n), 3), room('placing', P(C + 5n), 3)], P(C))
    expect(boxes.map((b) => b.grid)).toEqual([true, false])
  })
})

describe('quieter than the green box, and no label', () => {
  it('is fainter than the deploy box, its cut faces breathe as frames that cannot wash the view, with no words on them', () => {
    expect(ROOM_GRID_OPACITY).toBeLessThan(0.12)
    expect(ROOM_WALL_LOOK).toBe('frame')
    expect(ROOM_WALL_OPACITY).toBeLessThan(0.95)
    expect(ROOM_WALL_LABEL).toBeNull()
  })
})

describe('only while the Builder is on', () => {
  it('draws nothing with the Builder off, not even a door being placed', () => {
    const placing = { at: P(C), height: 6, depth: 1 }
    expect(doorRooms([], 'a'.repeat(64), false, 0, placing)).toEqual([])
    expect(roomBoxes(doorRooms([], 'a'.repeat(64), false, 0, placing), P(C), alignedOrigin(P(C), 0), 0, AXES)).toEqual([])
    expect(doorRooms([], 'a'.repeat(64), true, 0, placing)).toHaveLength(1)
  })
})

describe('two rooms bigger than the view, both around you', () => {
  it('breathe once: the outer room leaves the faces it shares with the inner one to it', () => {
    // A 2^20 room around a 2^12 one; you deep inside both: both clip to one 25-cell box about you.
    const deep = P(C + 2048n)
    const boxes = seen([room('outer', P(C + 3n), 20, 1), room('inner', P(C + 3n), 12, 2)], deep)
    expect(boxes[0].size).toEqual(boxes[1].size)
    expect(boxes[0].centre).toEqual(boxes[1].centre)
    expect(boxes.map((b) => [b.key, b.faces.length, b.wallFaces.length])).toEqual([['outer', 6, 0], ['inner', 6, 6]])
  })

  it('keeps every breathing face when the boxes differ', () => {
    // Near the inner room's top: its top faces are real, so the outer one still breathes there.
    const nearTop = P(C + 4096n - 4n)
    const [outer, inner] = seen([room('outer', P(C + 3n), 20, 1), room('inner', P(C + 3n), 12, 2)], nearTop)
    expect(outer.wallFaces).toEqual(outer.faces)
    expect(inner.wallFaces).toEqual(inner.faces)
  })
})

describe('the grid material outlives the grid', () => {
  it('a room giving its material back and the next taking one get the same material, never disposed', () => {
    const m = roomGridPool.take()
    const dispose = vi.spyOn(m, 'dispose')
    roomGridPool.give(m)
    const again = roomGridPool.take()
    expect(again).toBe(m)
    roomGridPool.give(again)
    expect(dispose).not.toHaveBeenCalled()
  })

  it('a material mounted again after a give (StrictMode) is not handed to another room', () => {
    const m = roomGridPool.take()
    roomGridPool.give(m)
    roomGridPool.hold(m)
    const other = roomGridPool.take()
    expect(other).not.toBe(m)
    roomGridPool.give(other)
    roomGridPool.give(m)
    roomGridPool.give(m)
    expect([roomGridPool.take(), roomGridPool.take()]).toEqual(expect.arrayContaining([m, other]))
  })
})
