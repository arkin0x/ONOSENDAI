/**
 * targetPoint.test.ts: where an avatar's marker (the YOU circle, a target's,
 * anyone present's) points. On the centre of the cell the avatar is drawn in,
 * not its low corner (arkinox, 2026-11-02: the YOU circle hung on the corner
 * of its gibson in VIEW mode).
 */
import { createElement } from 'react'
import { PerspectiveCamera } from 'three'
import { describe, expect, it, vi } from 'vitest'

/** The projector's frame, caught so a test can run it against a real camera. */
const frames: Array<(state: unknown) => void> = []
vi.mock('@react-three/fiber', () => ({ useFrame: (cb: (state: unknown) => void) => { frames.push(cb) }, useThree: () => undefined }))

import { placeCentre, pointCentre, type Position, type ViewAxes } from '../../lib/space'
import { targetScreens } from '../../lib/targets'
import { alignedOrigin, useCyberspace } from '../../store/useCyberspace'
import { mount } from '../../test/elementRoot'
import { TargetProjector, targetPoint } from '../TargetProjector'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
/** Adding zero folds the -0 a flipped axis makes of a zero offset. */
const plain = (v: number[]) => v.map((n) => n + 0)
const me: Position = { x: (1n << 60n) + 12345n, y: (1n << 59n) + 777n, z: (1n << 58n) + 3n }

describe('an avatar marker', () => {
  it('at 2^0 sits on the centre of its gibson, half a gibson in from the corner it used to hang on', () => {
    const origin = alignedOrigin(me, 0)
    expect(plain(targetPoint({ at: me }, origin, 0, AXES))).toEqual([0, 0, 0])
    // What it was: the raw coordinate less half a cell, the gibson's low corner.
    expect(pointCentre(me, origin, 0, AXES)).toEqual([-0.5, -0.5, 0.5])
  })

  it('is where the scene draws the avatar at every zoom below the continuous range (placeCentre)', () => {
    const someone: Position = { x: me.x + 37n, y: me.y - 5n, z: me.z + 1000n }
    for (const scaleExp of [0, 1, 3, 10, 33, 79]) {
      const origin = alignedOrigin(me, scaleExp)
      expect(targetPoint({ at: someone }, origin, scaleExp, AXES)).toEqual(placeCentre(someone, origin, scaleExp, AXES))
    }
  })

  it('agrees with the continuous point from 2^80 up, where everything places continuously', () => {
    for (const scaleExp of [80, 84]) {
      const origin = alignedOrigin(me, scaleExp)
      expect(targetPoint({ at: me }, origin, scaleExp, AXES)).toEqual(pointCentre(me, origin, scaleExp, AXES))
    }
  })

  it('leaves a thing with an extent (Earth) at the continuous point its sphere is drawn about', () => {
    const earth: Position = { x: 1n << 84n, y: 1n << 84n, z: 1n << 84n }
    for (const scaleExp of [0, 40, 60]) {
      const origin = alignedOrigin(me, scaleExp)
      expect(targetPoint({ at: earth, radius: 1n << 55n }, origin, scaleExp, AXES)).toEqual(pointCentre(earth, origin, scaleExp, AXES))
    }
  })
})

describe('the projector', () => {
  it('puts YOU on the centre of your gibson on screen, where the camera looking at that centre points', async () => {
    useCyberspace.setState({ anchor: { ...me }, scaleExp: 0 })
    frames.length = 0
    const m = await mount(createElement(TargetProjector, { axes: AXES, targets: [{ id: 'you', label: 'YOU', color: '#f00', at: { ...me } }] }))
    // A camera off at an angle, looking at the gibson's centre, render [0, 0, 0].
    const camera = new PerspectiveCamera(50, 1, 0.1, 6000)
    camera.position.set(7, 5, 11)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    for (const frame of frames) frame({ camera, size: { width: 600, height: 600 } })
    const s = targetScreens.you
    expect(s.onScreen).toBe(true)
    expect(Math.abs(s.x)).toBeLessThan(1e-6)
    expect(Math.abs(s.y)).toBeLessThan(1e-6)
    await m.unmount()
  })
})

