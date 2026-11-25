/**
 * avatarEyeMarker.test.ts - SET EYE on a shape with no vertices, the default
 * icosahedron (arkinox, 2026-11-25: "the 'what you see' doesn't change when I
 * move my eye"; "i switched to a different avatar using the default
 * icosahedron, and i am clipping under the floor").
 *
 * A shape with no vertices is drawn as the icosahedron, one gibson across on
 * the bench, its lowest point on its origin. Its eye used to be the
 * icosahedron's 0.875 in WALK and WHAT YOU SEE whatever SET EYE said, while
 * the bench showed AUTO at 0, 0, 0 (the floor) and TRY WALK was greyed out.
 *
 * - AUTO on an empty shape is the icosahedron's eye, 0.875 gibsons up, on the
 *   bench, in its label and in WALK alike;
 * - a CHOSEN eye on an empty shape moves the camera WALK and WHAT YOU SEE
 *   look from (walkEyeLocal), measured on the icosahedron, at any unit, and
 *   shrunk with the icosahedron at the top of the ladder;
 * - a custom avatar's eye is unchanged, and so is no avatar at all.
 */
import { describe, expect, it } from 'vitest'
import { newShard, type ShardModel } from 'sno-core/shards'
import { MARKER_EYE, autoEye, benchEye, eyeChosen, eyeLabel, eyeOf, markerShapeEye, usedBenchEye, walkEyeLocal, withEye, wornEye } from '../avatarEye'
import { useWorkshop } from '../../store/useWorkshop'

const empty = (unit = 0): ShardModel => ({ ...newShard('Empty'), unit })

/** A column of points from `bottom` to `top` ticks on Y. */
function column(bottom: number, top: number): ShardModel {
  const v = (y: number): ShardModel['vertices'][number] => {
    const p = Math.floor(y / 120)
    const t = y - p * 120
    return t === 0 ? { p: [0, p, 0], c: [1, 1, 1] } : { p: [0, p, 0], t: [0, t, 0], c: [1, 1, 1] }
  }
  return { ...newShard('Column'), vertices: [v(bottom), v(top)] }
}

describe('AUTO on a shape with no vertices', () => {
  it('is the icosahedron’s eye, 0.875 gibsons up, never the floor', () => {
    // The spec's automatic eye of an empty payload is its origin (DECK-0003 §1.17): kept as the reader's.
    expect(autoEye(empty())).toEqual([0, 0, 0])
    expect(eyeOf(empty())).toEqual([0, 0, 0])
    // What WALK, the bench and its label use: the icosahedron's, 105 ticks at unit 0.
    expect(markerShapeEye(empty())).toEqual([0, 105, 0])
    expect(wornEye(empty())).toEqual([0, 105, 0])
    expect(benchEye(empty())).toEqual([0, 105, 0])
    expect(usedBenchEye(empty())).toEqual([0, 105, 0])
    expect(eyeLabel(empty())).toBe('0, 0.88, 0')
    expect(eyeChosen(empty())).toBe(false)
    expect(walkEyeLocal(empty(), 0, 1)).toEqual([0, MARKER_EYE, 0])
  })

  it('is the icosahedron’s 0.875 at every unit, never rounded onto the floor by a big unit’s grid', () => {
    for (const unit of [0, 1, 5, 7, 8, 10, 20, 84]) {
      expect(walkEyeLocal(empty(unit), 0, 1)).toEqual([0, MARKER_EYE, 0])
      expect(eyeLabel(empty(unit))).toBe('0, 0.88, 0')
    }
  })
})

describe('a CHOSEN eye on a shape with no vertices', () => {
  it('moves the camera: the top of the icosahedron is one gibson up', () => {
    const top = withEye(empty(), [0, 120, 0])
    expect(eyeChosen(top)).toBe(true)
    expect(walkEyeLocal(top, 0, 1)).toEqual([0, 1, 0])
    expect(eyeLabel(top)).toBe('0, 1, 0')
    // Every place it is moved to is where WALK looks from, on every axis, +Z toward the viewer.
    expect(walkEyeLocal(withEye(empty(), [12, 60, -24]), 0, 1)).toEqual([0.1, 0.5, -0.2])
    // ORIGIN, chosen: the feet, on purpose.
    expect(walkEyeLocal(withEye(empty(), [0, 0, 0]), 0, 1)).toEqual([0, 0, 0])
  })

  it('stays on the icosahedron as the view zooms out: one cell across at any zoom, shrunk at the top of the ladder', () => {
    const top = withEye(empty(), [0, 120, 0])
    expect(walkEyeLocal(top, 5, 1)).toEqual([0, 1, 0])
    expect(walkEyeLocal(top, 82, 0.25)).toEqual([0, 0.25, 0])
  })

  it('is measured in the shape’s own unit', () => {
    expect(walkEyeLocal(withEye(empty(1), [0, 60, 0]), 0, 1)).toEqual([0, 1, 0])
  })

  it('is where the bench shows it, at a big unit too: never a place the bench does not draw', () => {
    for (const unit of [0, 3, 8, 9, 12]) {
      const s = withEye(empty(unit), [0, 120, 0])
      const shown = usedBenchEye(s)
      const k = 2 ** unit / 120
      expect(walkEyeLocal(s, 0, 1)[1]).toBeCloseTo(Math.min(4, shown[1] * k), 12)
    }
  })

  it('is kept within the avatar size limit, as a custom avatar’s is', () => {
    const far = walkEyeLocal(withEye(empty(), [0, 1200, 0]), 0, 1)
    expect(far).toEqual([0, 4, 0])
  })
})

describe('what stays as it was', () => {
  it('no avatar at all: the icosahedron’s 0.875', () => {
    expect(walkEyeLocal(null, 0, 1)).toEqual([0, 0.875, 0])
    expect(walkEyeLocal(null, 82, 0.25)).toEqual([0, 0.875 * 0.25, 0])
  })

  it('a custom avatar: its own eye or its automatic one, at its scale', () => {
    const ship = withEye(column(0, 360), [4, 336, -32])
    expect(walkEyeLocal(ship, 0, 1)[1]).toBeCloseTo(2.8, 12)
    expect(benchEye(ship)).toEqual([4, 336, 32])
    const auto = column(0, 360)
    expect(walkEyeLocal(auto, 0, 1)[1]).toBeCloseTo((360 - 45) / 120, 12)
    expect(benchEye(auto)).toEqual(autoEye(auto))
    // Zoomed out to the marker: the icosahedron's eye, as before.
    expect(walkEyeLocal(column(0, 120), 3, 1)).toEqual([0, 0.875, 0])
  })
})

describe('SET EYE on the bench, an empty shape', () => {
  it('starts from the icosahedron’s eye and every move changes what WALK looks from', () => {
    const id = useWorkshop.getState().importShard({ ...newShard('Empty eye') })
    useWorkshop.getState().select(id)
    const at = (): number => walkEyeLocal(useWorkshop.getState().current(), 0, 1)[1]
    expect(at()).toBeCloseTo(0.875, 12)
    // One step up on the snap's grid from 0.875 lands on the next grid line above.
    expect(useWorkshop.getState().moveEye(1, useWorkshop.getState().step())).toBe(true)
    const up = at()
    expect(up).toBeGreaterThan(0.875)
    expect(useWorkshop.getState().moveEye(1, useWorkshop.getState().step())).toBe(true)
    expect(at()).toBeGreaterThan(up)
    expect(useWorkshop.getState().setEye([0, 120, 0])).toBe(true)
    expect(at()).toBe(1)
    // AUTO again: back on the icosahedron's eye.
    useWorkshop.getState().setEye(undefined)
    expect(at()).toBeCloseTo(0.875, 12)
  })
})
