/**
 * walkKeys.test.ts - WALK's first-person keys: W forward, S back, A and D
 * sideways, Space or R up, C or F down; nothing with a modifier, no Ctrl.
 * Space and C go along the view's up, R and F along the camera's
 * (verticalAlong, arkinox 2026-11-24).
 */
import { describe, expect, it } from 'vitest'
import { Euler, Matrix4, Vector3, type Quaternion } from 'three'
import { JUMP_FOLLOWS_VIEW, verticalAlong, viewVerticalKey, walkHeldDir, walkMove, type WalkKeyEvent } from '../walkKeys'
import { canonicalQuaternion, claimScreenAxes, levelScreenAxes, rotateView, viewAxes, type AxisDirection, type ViewAxes } from '../space'
import { upOf, viewDown } from '../walkDown'
import { moveDirection } from '../moves'

const key = (code: string, more: Partial<WalkKeyEvent> = {}): WalkKeyEvent => ({
  code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...more,
})

describe('walkMove', () => {
  it('maps WASD first-person style', () => {
    expect(walkMove(key('KeyW'))).toBe('away')
    expect(walkMove(key('KeyS'))).toBe('toward')
    expect(walkMove(key('KeyA'))).toBe('left')
    expect(walkMove(key('KeyD'))).toBe('right')
  })

  it('puts up on Space and R, down on C and F', () => {
    expect(walkMove(key('Space'))).toBe('up')
    expect(walkMove(key('KeyR'))).toBe('up')
    expect(walkMove(key('KeyC'))).toBe('down')
    expect(walkMove(key('KeyF'))).toBe('down')
  })

  it('has no Ctrl binding', () => {
    expect(walkMove(key('ControlLeft', { ctrlKey: true }))).toBeNull()
    expect(walkMove(key('ControlRight', { ctrlKey: true }))).toBeNull()
  })

  it('leaves every key with a modifier to the browser or the view', () => {
    expect(walkMove(key('KeyW', { ctrlKey: true }))).toBeNull()
    expect(walkMove(key('KeyC', { ctrlKey: true }))).toBeNull()
    expect(walkMove(key('KeyW', { shiftKey: true }))).toBeNull()
    expect(walkMove(key('KeyD', { metaKey: true }))).toBeNull()
    expect(walkMove(key('KeyR', { altKey: true }))).toBeNull()
  })

  it('has nothing for keys that are not WALK\'s', () => {
    expect(walkMove(key('KeyX'))).toBeNull()
    expect(walkMove(key('KeyQ'))).toBeNull()
    expect(walkMove(key('KeyE'))).toBeNull()
  })
})

describe('walkHeldDir: what each WALK key holds (store/walkHold.ts combines them)', () => {
  it('W and S forward and back, A and D the sides, up and down the vertical', () => {
    expect(walkHeldDir('away')).toEqual({ fwd: 1, strafe: 0, vert: 0 })
    expect(walkHeldDir('toward')).toEqual({ fwd: -1, strafe: 0, vert: 0 })
    expect(walkHeldDir('right')).toEqual({ fwd: 0, strafe: 1, vert: 0 })
    expect(walkHeldDir('left')).toEqual({ fwd: 0, strafe: -1, vert: 0 })
    expect(walkHeldDir('up')).toEqual({ fwd: 0, strafe: 0, vert: 1 })
    expect(walkHeldDir('down')).toEqual({ fwd: 0, strafe: 0, vert: -1 })
  })
})

/**
 * Space and C go up and down as you see the world, R and F by where you
 * look (arkinox, 2026-11-24: "jump (space) should always go up relative to
 * the view, and down (c) should always go down. but R/F should continue to
 * be relative, like the WASD"). Every one of the 24 compass views (so every
 * gravity direction, rolls included), with the camera level, pitched up,
 * pitched down, rolled and turned in it, as the scene's ScreenAxes reads it.
 */
describe('verticalAlong: Space and C by the view, R and F by the camera', () => {
  /** Every view the compass can reach: 90-degree turns from the canonical one. */
  function allViews(): Quaternion[] {
    const seen: Quaternion[] = [canonicalQuaternion()]
    const same = (a: Quaternion, b: Quaternion): boolean => Math.abs(a.dot(b)) > 1 - 1e-6
    for (let i = 0; i < seen.length; i++) {
      for (const d of ['left', 'right', 'up', 'down'] as const) {
        const q = rotateView(seen[i], d)
        if (!seen.some((s) => same(s, q))) seen.push(q)
      }
    }
    return seen
  }

  /** The camera's basis in the scene's local frame, turned `yaw`, pitched `pitch` (up positive) and rolled `roll`, in degrees. */
  function camera(pitch: number, yaw = 0, roll = 0): { right: Vector3; up: Vector3; out: Vector3 } {
    const r = Math.PI / 180
    const m = new Matrix4().makeRotationFromEuler(new Euler(pitch * r, yaw * r, roll * r, 'YXZ'))
    const right = new Vector3(), up = new Vector3(), out = new Vector3()
    m.extractBasis(right, up, out)
    return { right, up, out }
  }

  const LOOKS: Array<[string, number, number, number]> = [
    ['level', 0, 0, 0],
    ['pitched up 30', 30, 0, 0],
    ['pitched up 60', 60, 0, 0],
    ['pitched up 89', 89, 0, 0],
    ['pitched down 30', -30, 0, 0],
    ['pitched down 60', -60, 0, 0],
    ['pitched down 89', -89, 0, 0],
    ['rolled 30', 0, 0, 30],
    ['rolled -60', 0, 0, -60],
    ['turned 135 and pitched up 70', 70, 135, 0],
    ['turned -40, pitched down 50, rolled 20', -50, -40, 20],
  ]

  const flip = (d: AxisDirection): AxisDirection => ({ axis: d.axis, dir: d.dir === 1 ? -1 : 1 })

  it('the switch is on: Space and C follow the view', () => {
    expect(JUMP_FOLLOWS_VIEW).toBe(true)
  })

  it('only Space and C are the view\'s keys; R and F are the camera\'s', () => {
    expect(viewVerticalKey('Space')).toBe(true)
    expect(viewVerticalKey('KeyC')).toBe(true)
    expect(viewVerticalKey('KeyR')).toBe(false)
    expect(viewVerticalKey('KeyF')).toBe(false)
    expect(viewVerticalKey('KeyW')).toBe(false)
    expect(walkHeldDir('up', true)).toEqual({ fwd: 0, strafe: 0, vert: 1, view: true })
    expect(walkHeldDir('down', true)).toEqual({ fwd: 0, strafe: 0, vert: -1, view: true })
    expect(walkHeldDir('up').view).toBeUndefined()
  })

  it('gravity off, in every view and every look: Space is the view\'s up, C its down, R and F the camera\'s snapped up and down, as before', () => {
    const views = allViews()
    expect(views).toHaveLength(24)
    const ups = new Set<string>()
    for (const view of views) {
      const local = viewAxes(view)
      const down = viewDown(view)
      ups.add(`${upOf(down).axis}${upOf(down).dir}`)
      // The up gravity goes by is the view's up exactly.
      expect(upOf(down)).toEqual(local.up)
      for (const [, pitch, yaw, roll] of LOOKS) {
        const c = camera(pitch, yaw, roll)
        const screen = claimScreenAxes(c.right, c.up, c.out, local)
        expect(verticalAlong('up', true, screen, down)).toEqual(local.up)
        expect(verticalAlong('down', true, screen, down)).toEqual(flip(local.up))
        expect(verticalAlong('up', false, screen, down)).toEqual(moveDirection(screen, 'up'))
        expect(verticalAlong('down', false, screen, down)).toEqual(moveDirection(screen, 'down'))
      }
    }
    // Every gravity direction is covered.
    expect(ups.size).toBe(6)
  })

  it('the canonical view, worked by hand: level, R and Space agree; past 45 degrees R tips behind or ahead and Space stays up', () => {
    const view = canonicalQuaternion()
    const local = viewAxes(view)
    const down = viewDown(view)
    const at = (pitch: number, roll = 0): ViewAxes => { const c = camera(pitch, 0, roll); return claimScreenAxes(c.right, c.up, c.out, local) }
    // Level: both +Y.
    expect(verticalAlong('up', true, at(0), down)).toEqual({ axis: 'y', dir: 1 })
    expect(verticalAlong('up', false, at(0), down)).toEqual({ axis: 'y', dir: 1 })
    // Looking up 60 degrees: the camera's up leans back, toward -Z (the view looks along +Z); Space is still +Y.
    expect(verticalAlong('up', false, at(60), down)).toEqual({ axis: 'z', dir: -1 })
    expect(verticalAlong('up', true, at(60), down)).toEqual({ axis: 'y', dir: 1 })
    expect(verticalAlong('down', true, at(60), down)).toEqual({ axis: 'y', dir: -1 })
    // Looking down 60 degrees: the camera's up leans forward, toward +Z; Space is still +Y, C -Y.
    expect(verticalAlong('up', false, at(-60), down)).toEqual({ axis: 'z', dir: 1 })
    expect(verticalAlong('up', true, at(-60), down)).toEqual({ axis: 'y', dir: 1 })
    expect(verticalAlong('down', true, at(-60), down)).toEqual({ axis: 'y', dir: -1 })
    // Rolled 60 degrees right: the camera's up leans left (-X); Space is still +Y.
    expect(verticalAlong('up', false, at(0, -60), down)).toEqual({ axis: 'x', dir: 1 })
    expect(verticalAlong('up', false, at(0, 60), down)).toEqual({ axis: 'x', dir: -1 })
    expect(verticalAlong('up', true, at(0, 60), down)).toEqual({ axis: 'y', dir: 1 })
  })

  it('under GRAVITY the keys are level across gravity, so Space and R both mean the same up: nothing changes there', () => {
    for (const view of allViews()) {
      const local = viewAxes(view)
      const down = viewDown(view)
      for (const [, pitch, yaw, roll] of LOOKS) {
        const c = camera(pitch, yaw, roll)
        const screen = levelScreenAxes(c.right, c.up, c.out, local, down)
        expect(verticalAlong('up', false, screen, down)).toEqual(upOf(down))
        expect(verticalAlong('up', true, screen, down)).toEqual(upOf(down))
      }
    }
  })
})
