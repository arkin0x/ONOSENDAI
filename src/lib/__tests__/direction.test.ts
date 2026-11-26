/**
 * direction.test.ts: which way a thing is from the view, as an arrow and
 * plain words ("Up and to the left · 466 pm"), worked from the camera three
 * really uses (lib/viewPose).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { directionOf } from '../direction'
import { directionFromView, forgetViewPose, recordViewPose, toCameraFrame } from '../viewPose'

afterEach(() => forgetViewPose())

describe('direction words', () => {
  it('says ahead, behind, left, right, above and below in plain words, with the arrow turned that way', () => {
    expect(directionOf([0, 0, -5])).toEqual({ deg: 0, words: 'Ahead' })
    expect(directionOf([0, 0, 5])).toEqual({ deg: 180, words: 'Behind you' })
    expect(directionOf([5, 0, -1]).words).toBe('To the right')
    expect(directionOf([5, 0, -1]).deg).toBe(90)
    expect(directionOf([-5, 0, -1]).words).toBe('To the left')
    expect(directionOf([-5, 0, -1]).deg).toBe(270)
    expect(directionOf([0, 5, -1]).words).toBe('Above')
    expect(directionOf([0, -5, -1]).words).toBe('Below')
    expect(directionOf([-3, 3, -1]).words).toBe('Up and to the left')
    expect(directionOf([-3, 3, -1]).deg).toBe(315)
    expect(directionOf([3, -3, -1]).words).toBe('Down and to the right')
    expect(directionOf([3, 0, 6]).words).toBe('Behind you to the right')
    expect(directionOf([0, 0, 0]).words).toBe('right here')
  })

  it('never uses an em dash or a tacked-on comma', () => {
    for (const v of [[1, 1, 1], [-1, -1, 1], [1, 0, 1], [0, 1, 1], [0, -1, 2]] as Array<[number, number, number]>) {
      expect(directionOf(v).words).not.toMatch(/[—,]/)
    }
  })
})

describe('the view’s pose', () => {
  it('turns a world offset into the camera’s frame exactly as three does', () => {
    const camera = new PerspectiveCamera()
    camera.position.set(3, 4, 5)
    camera.lookAt(-2, 1, 0)
    camera.updateMatrixWorld()
    const q = camera.quaternion
    for (const v of [[1, 2, 3], [-4, 0.5, 2], [0, 0, -1]] as Array<[number, number, number]>) {
      const want = new Vector3(...v).applyQuaternion(q.clone().invert())
      const got = toCameraFrame(v, [q.x, q.y, q.z, q.w])
      expect(got[0]).toBeCloseTo(want.x, 9)
      expect(got[1]).toBeCloseTo(want.y, 9)
      expect(got[2]).toBeCloseTo(want.z, 9)
    }
  })

  it('knows nothing before a frame, then says which way a point is from the camera', () => {
    expect(directionFromView([1, 0, 0])).toBeNull()
    const camera = new PerspectiveCamera()
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    recordViewPose(camera.position, camera.quaternion)
    expect(directionFromView([0, 0, 0])!.words).toBe('Ahead')
    expect(directionFromView([-20, 0, 9])!.words).toBe('To the left')
    expect(directionFromView([0, 0, 30])!.words).toBe('Behind you')
  })
})
