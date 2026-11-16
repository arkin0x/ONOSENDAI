/**
 * input.test.ts - DRONE RUN's controls (game/droneRun/input.ts): keys to a
 * RunInput, edges cleared once read, held keys, the wheel and Q cycling the
 * guns, the pointer lock and its fallback to a drag, the phone's stick math
 * (dead zone, analog magnitude) and its fingers by pointer id.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  attachDesktop, keyAction, lookState, noteWeapons, pointer, readInput, resetInput, setInputPaused, stickVector,
  TouchTracker, MOUSE_RAD_PER_PX, DRAG_RAD_PER_PX, STICK_DEAD, TOUCH_RAD_PER_PX, PITCH_LIMIT,
} from '../../input'

type Fn = (e: unknown) => void
/** An event target that records its listeners, so a test can send it events. */
function target(): { add: (t: string, f: Fn) => void; fire: (t: string, e: Record<string, unknown>) => void; addEventListener: (t: string, f: Fn) => void; removeEventListener: (t: string, f: Fn) => void; count: () => number } {
  const map = new Map<string, Set<Fn>>()
  const t = {
    add: (type: string, f: Fn) => { if (!map.has(type)) map.set(type, new Set()); map.get(type)!.add(f) },
    fire: (type: string, e: Record<string, unknown>) => { for (const f of [...(map.get(type) ?? [])]) f({ preventDefault: () => {}, type, ...e }) },
    addEventListener: (type: string, f: Fn) => t.add(type, f),
    removeEventListener: (type: string, f: Fn) => { map.get(type)?.delete(f) },
    count: () => [...map.values()].reduce((n, s) => n + s.size, 0),
  }
  return t
}

function host(lock: 'grant' | 'refuse' | 'throw' | 'none' | 'cooldown' = 'grant', clock: { t: number; refuse?: boolean } = { t: 10_000 }) {
  const win = target()
  const doc = Object.assign(target(), { pointerLockElement: null as unknown, exitPointerLock: () => { doc.pointerLockElement = null; doc.fire('pointerlockchange', {}) } })
  const el = Object.assign(target(), {
    setPointerCapture: () => {},
    requestPointerLock: lock === 'none' ? undefined : () => {
      if (lock === 'throw') throw new Error('no')
      if (lock === 'cooldown' && clock.refuse) { doc.fire('pointerlockerror', {}); return Promise.reject(new Error('too soon')) }
      if (lock === 'refuse') { doc.fire('pointerlockerror', {}); return Promise.reject(new Error('refused')) }
      doc.pointerLockElement = el
      doc.fire('pointerlockchange', {})
      return Promise.resolve()
    },
  })
  const detach = attachDesktop({ el: el as never, win: win as never, doc: doc as never, now: () => clock.t })
  return { win, doc, el, detach }
}

const key = (h: ReturnType<typeof host>, type: 'keydown' | 'keyup', code: string, extra: Record<string, unknown> = {}): void =>
  h.win.fire(type, { code, key: code, target: null, repeat: false, ...extra })
const mouse = (code: { button?: number; x?: number; y?: number; mx?: number; my?: number; id?: number } = {}) =>
  ({ pointerType: 'mouse', button: code.button ?? 0, clientX: code.x ?? 0, clientY: code.y ?? 0, movementX: code.mx ?? 0, movementY: code.my ?? 0, pointerId: code.id ?? 1 })

beforeEach(() => { resetInput(0, 0) })

describe('the key map', () => {
  it('maps the game keys and leaves the rest alone', () => {
    expect(keyAction('KeyW')).toEqual({ kind: 'move', dir: { fwd: 1, strafe: 0 } })
    expect(keyAction('ArrowLeft')).toEqual({ kind: 'move', dir: { fwd: 0, strafe: -1 } })
    expect(keyAction('Space')).toEqual({ kind: 'jump' })
    expect(keyAction('Digit3')).toEqual({ kind: 'select', index: 2 })
    expect(keyAction('KeyQ')).toEqual({ kind: 'cycle', by: 1 })
    expect(keyAction('KeyR')).toEqual({ kind: 'reload' })
    expect(keyAction('KeyM')).toEqual({ kind: 'mute' })
    expect(keyAction('KeyE')).toBeNull()
    expect(keyAction('Escape')).toBeNull()
  })
})

describe('keys to a RunInput', () => {
  it('held keys move while held; opposite keys cancel; a diagonal stays inside the unit circle', () => {
    const h = host()
    key(h, 'keydown', 'KeyW')
    expect(readInput().move).toEqual({ fwd: 1, strafe: 0 })
    expect(readInput().move).toEqual({ fwd: 1, strafe: 0 })
    key(h, 'keydown', 'KeyD')
    const m = readInput().move
    expect(m.fwd).toBeCloseTo(Math.SQRT1_2)
    expect(m.strafe).toBeCloseTo(Math.SQRT1_2)
    key(h, 'keydown', 'KeyS')
    expect(readInput().move).toEqual({ fwd: 0, strafe: 1 })
    key(h, 'keyup', 'KeyW'); key(h, 'keyup', 'KeyS'); key(h, 'keyup', 'KeyD')
    expect(readInput().move).toEqual({ fwd: 0, strafe: 0 })
    h.detach()
  })

  it('edges are read once and cleared: jump, reload, select', () => {
    const h = host()
    key(h, 'keydown', 'Space')
    key(h, 'keydown', 'KeyR')
    key(h, 'keydown', 'Digit2')
    const a = readInput()
    expect([a.jump, a.reload, a.select]).toEqual([true, true, 1])
    const b = readInput()
    expect([b.jump, b.reload, b.select]).toEqual([false, false, null])
    // A key's own repeat is not a new press.
    key(h, 'keydown', 'Space', { repeat: true })
    expect(readInput().jump).toBe(false)
    h.detach()
  })

  it('Q and the wheel cycle from the gun in hand, round the ends', () => {
    const h = host()
    noteWeapons(3, 2)
    key(h, 'keydown', 'KeyQ')
    expect(readInput().select).toBe(0)
    h.el.fire('wheel', { deltaY: 100 })
    expect(readInput().select).toBe(1)
    h.el.fire('wheel', { deltaY: -100 })
    h.el.fire('wheel', { deltaY: -100 })
    expect(readInput().select).toBe(2)
    // Twice between two steps: two guns on.
    key(h, 'keydown', 'KeyQ'); key(h, 'keyup', 'KeyQ'); key(h, 'keydown', 'KeyQ')
    expect(readInput().select).toBe(1)
    h.detach()
  })

  it('keys with Cmd, Ctrl or Alt are the browser\'s; Meta lets go of everything', () => {
    const h = host()
    key(h, 'keydown', 'KeyW')
    key(h, 'keydown', 'KeyR', { ctrlKey: true })
    expect(readInput().reload).toBe(false)
    key(h, 'keydown', 'Meta', { key: 'Meta' })
    expect(readInput().move).toEqual({ fwd: 0, strafe: 0 })
    h.detach()
  })

  it('a card up pauses: nothing moves, fires or presses; the window losing focus lets go', () => {
    const h = host()
    key(h, 'keydown', 'KeyW')
    setInputPaused(true)
    key(h, 'keydown', 'Space')
    const a = readInput()
    expect(a.move).toEqual({ fwd: 0, strafe: 0 })
    expect(a.jump).toBe(false)
    setInputPaused(false)
    key(h, 'keydown', 'KeyA')
    h.win.fire('blur', {})
    expect(readInput().move).toEqual({ fwd: 0, strafe: 0 })
    h.detach()
  })

  it('unwires every listener it added', () => {
    const h = host()
    h.detach()
    expect(h.win.count() + h.doc.count() + h.el.count()).toBe(0)
  })
})

describe('the mouse: pointer lock, or a drag where it is refused', () => {
  it('the first press locks and does not fire; locked, the mouse looks and the button fires', () => {
    const h = host('grant')
    h.el.fire('pointerdown', mouse())
    expect(pointer.locked).toBe(true)
    expect(readInput().fire).toBe(false)
    h.win.fire('pointermove', mouse({ mx: 100, my: -50 }))
    expect(lookState.yaw).toBeCloseTo(-100 * MOUSE_RAD_PER_PX)
    expect(lookState.pitch).toBeCloseTo(50 * MOUSE_RAD_PER_PX)
    h.el.fire('pointerdown', mouse())
    expect(readInput().fire).toBe(true)
    h.win.fire('pointerup', mouse())
    expect(readInput().fire).toBe(false)
    // Esc: the browser lets the lock go; the fire stops with it.
    h.el.fire('pointerdown', mouse())
    h.doc.exitPointerLock()
    expect(pointer.locked).toBe(false)
    expect(readInput().fire).toBe(false)
    h.detach()
  })

  it('refused twice, a press fires and a drag looks', () => {
    const h = host('refuse')
    h.el.fire('pointerdown', mouse())
    h.win.fire('pointerup', mouse())
    h.el.fire('pointerdown', mouse())
    h.win.fire('pointerup', mouse())
    expect(pointer.locked).toBe(false)
    h.el.fire('pointerdown', mouse({ x: 10, y: 10 }))
    expect(readInput().fire).toBe(true)
    h.win.fire('pointermove', mouse({ x: 30, y: 0 }))
    expect(lookState.yaw).toBeCloseTo(-20 * DRAG_RAD_PER_PX)
    expect(lookState.pitch).toBeCloseTo(10 * DRAG_RAD_PER_PX)
    h.win.fire('pointerup', mouse())
    expect(readInput().fire).toBe(false)
    h.detach()
  })

  it('the browser\'s pause after Esc is not a refusal: the lock is asked for again later', async () => {
    const clock = { t: 0, refuse: false }
    const h = host('cooldown', clock)
    h.el.fire('pointerdown', mouse())
    expect(pointer.locked).toBe(true)
    h.doc.exitPointerLock()
    // Clicks inside the pause are refused by the browser, both ways at once (an error event and a rejected promise).
    clock.t = 500
    clock.refuse = true
    for (let i = 0; i < 3; i++) { h.el.fire('pointerdown', mouse()); h.win.fire('pointerup', mouse()); await Promise.resolve(); await Promise.resolve() }
    expect(readInput().fire).toBe(false)
    clock.t = 5_000
    clock.refuse = false
    h.el.fire('pointerdown', mouse())
    expect(pointer.locked).toBe(true)
    h.detach()
  })

  it('no lock on offer (or it throws): a drag from the first press', () => {
    for (const lock of ['none', 'throw'] as const) {
      resetInput(0, 0)
      const h = host(lock)
      h.el.fire('pointerdown', mouse({ x: 0, y: 0 }))
      if (lock === 'throw') { h.win.fire('pointerup', mouse()); h.el.fire('pointerdown', mouse({ x: 0, y: 0 })); h.win.fire('pointerup', mouse()); h.el.fire('pointerdown', mouse({ x: 0, y: 0 })) }
      expect(readInput().fire).toBe(true)
      h.win.fire('pointermove', mouse({ x: -40, y: 0 }))
      expect(lookState.yaw).toBeCloseTo(40 * DRAG_RAD_PER_PX)
      h.detach()
    }
  })

  it('the look never goes past straight up or down', () => {
    const h = host('grant')
    h.el.fire('pointerdown', mouse())
    h.win.fire('pointermove', mouse({ my: -100000 }))
    expect(lookState.pitch).toBe(PITCH_LIMIT)
    h.win.fire('pointermove', mouse({ my: 100000 }))
    expect(lookState.pitch).toBe(-PITCH_LIMIT)
    h.detach()
  })

  it('touches are left to the phone\'s controls', () => {
    const h = host('grant')
    h.el.fire('pointerdown', { ...mouse(), pointerType: 'touch' })
    expect(pointer.locked).toBe(false)
    expect(readInput().fire).toBe(false)
    h.detach()
  })
})

describe('the phone\'s stick', () => {
  it('nothing inside the dead zone; analog past it; full at the rim and beyond', () => {
    expect(stickVector(0, 0, 60)).toEqual({ fwd: 0, strafe: 0, mag: 0 })
    expect(stickVector(STICK_DEAD * 60 - 0.1, 0, 60).mag).toBe(0)
    const half = stickVector(0, -(STICK_DEAD + (1 - STICK_DEAD) / 2) * 60, 60)
    expect(half.mag).toBeCloseTo(0.5)
    expect(half.fwd).toBeCloseTo(0.5)
    expect(half.strafe).toBeCloseTo(0)
    expect(stickVector(60, 0, 60)).toMatchObject({ strafe: 1, mag: 1 })
    const out = stickVector(-300, 300, 60)
    expect(out.mag).toBe(1)
    expect(out.strafe).toBeCloseTo(-Math.SQRT1_2)
    expect(out.fwd).toBeCloseTo(-Math.SQRT1_2)
  })

  it('the left half drives the stick from its centre, the right half looks, each finger by its id', () => {
    const t = new TouchTracker(() => ({ cx: 80, cy: 700, radius: 60 }))
    expect(t.down(7, 80, 640, 375)).toBe('stick')
    expect(readInput().move.fwd).toBeCloseTo(1)
    // A second finger on the left is not a second stick.
    expect(t.down(8, 100, 600, 375)).toBeNull()
    // Look with another finger while moving.
    expect(t.down(9, 300, 400, 375)).toBe('look')
    t.move(9, 330, 380)
    expect(lookState.yaw).toBeCloseTo(-30 * TOUCH_RAD_PER_PX)
    expect(lookState.pitch).toBeCloseTo(20 * TOUCH_RAD_PER_PX)
    // The knob is drawn at the rim, not past it.
    t.move(7, 80, 500)
    expect(t.knob).toEqual({ dx: 0, dy: -60 })
    expect(readInput().move.fwd).toBeCloseTo(1)
    // The look finger lifting leaves the stick held.
    t.up(9)
    expect(readInput().move.fwd).toBeCloseTo(1)
    t.up(7)
    expect(readInput().move).toEqual({ fwd: 0, strafe: 0 })
    expect(t.knob).toEqual({ dx: 0, dy: 0 })
    // The left is free again.
    expect(t.down(8, 100, 600, 375)).toBe('stick')
    t.clear()
    expect(readInput().move).toEqual({ fwd: 0, strafe: 0 })
  })

  it('the stick and the keys add, and stay inside the unit circle', () => {
    const h = host()
    const t = new TouchTracker(() => ({ cx: 80, cy: 700, radius: 60 }))
    key(h, 'keydown', 'KeyW')
    t.down(1, 140, 700, 375)
    const m = readInput().move
    expect(Math.hypot(m.fwd, m.strafe)).toBeCloseTo(1)
    expect(m.fwd).toBeCloseTo(Math.SQRT1_2)
    t.up(1)
    h.detach()
  })
})
