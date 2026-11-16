/**
 * input.test.ts - DRONE RUN's controls (game/droneRun/input.ts): keys to a
 * RunInput, edges cleared once read, held keys, the wheel and Q cycling the
 * guns, the pointer lock and its fallback to a drag, the phone's stick math
 * (dead zone, analog magnitude), the LOOK stick's turn rate (dead zone,
 * curve, top rate, directions), both sticks floating (every touch starts at
 * nothing, measured from where it landed, the ring drawn there and back on
 * lift), the aim while the rail charges, sprint (Shift and the pad's
 * sources) and every finger by its pointer id.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  attachDesktop, keyAction, lookBy, lookRateNow, lookState, lookStickRate, noteWeapons, padFiring, pointer, readInput, releaseAll, resetInput, ringAt, setFire, setInputPaused, setLookRate, setSprint, stickVector, tickLook,
  TouchTracker, MOUSE_RAD_PER_PX, DRAG_RAD_PER_PX, STICK_DEAD, TOUCH_RAD_PER_PX, PITCH_LIMIT, LOOK_DEAD, LOOK_CURVE, LOOK_MAX_YAW, LOOK_MAX_PITCH, AIM_SCALE, RING_MARGIN, aimingNow,
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
    expect(keyAction('ShiftLeft')).toEqual({ kind: 'sprint' })
    expect(keyAction('ShiftRight')).toEqual({ kind: 'sprint' })
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

  it('a trackpad swipe (many small wheel events) changes the gun once; the next swipe changes it again', () => {
    const clock = { t: 10_000 }
    const h = host('grant', clock)
    noteWeapons(3, 0)
    for (let i = 0; i < 40; i++) { clock.t += 16; h.el.fire('wheel', { deltaY: 8, deltaMode: 0 }) }
    expect(readInput().select).toBe(1)
    expect(readInput().select).toBeNull()
    clock.t += 500
    for (let i = 0; i < 40; i++) { clock.t += 16; h.el.fire('wheel', { deltaY: 8, deltaMode: 0 }) }
    expect(readInput().select).toBe(2)
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

  it('Shift held sprints, with either Shift; let go, it stops; a card or blur lets go', () => {
    const h = host()
    expect(readInput().sprint).toBe(false)
    key(h, 'keydown', 'ShiftLeft', { key: 'Shift' })
    key(h, 'keydown', 'KeyW')
    const a = readInput()
    expect(a.sprint).toBe(true)
    expect(a.move.fwd).toBe(1)
    key(h, 'keydown', 'ShiftRight', { key: 'Shift' })
    key(h, 'keyup', 'ShiftLeft', { key: 'Shift' })
    expect(readInput().sprint).toBe(true)
    key(h, 'keyup', 'ShiftRight', { key: 'Shift' })
    expect(readInput().sprint).toBe(false)
    key(h, 'keydown', 'ShiftLeft', { key: 'Shift' })
    setInputPaused(true)
    expect(readInput().sprint).toBe(false)
    setInputPaused(false)
    key(h, 'keydown', 'ShiftLeft', { key: 'Shift' })
    h.win.fire('blur', {})
    expect(readInput().sprint).toBe(false)
    h.detach()
  })

  it('sprint sources by name: one finger lifting leaves another\'s', () => {
    setSprint('pad:sprint:1', true)
    setSprint('pad:sprint:2', true)
    setSprint('pad:sprint:1', false)
    expect(readInput().sprint).toBe(true)
    setSprint('pad:sprint:2', false)
    expect(readInput().sprint).toBe(false)
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

  it('the left half floats the stick from where the thumb lands, the right half looks, each finger by its id', () => {
    const t = new TouchTracker(() => ({ cx: 80, cy: 700, radius: 60 }))
    // Landing well away from the stick's resting centre moves nothing: the stick starts where the thumb is.
    expect(t.down(7, 80, 640, 375)).toBe('stick')
    expect(readInput().move).toEqual({ fwd: 0, strafe: 0 })
    t.move(7, 80, 580)
    expect(readInput().move.fwd).toBeCloseTo(1)
    // A second finger on the left is not a second stick.
    expect(t.down(8, 100, 600, 375)).toBeNull()
    // Look with another finger while moving.
    expect(t.down(9, 300, 400, 375)).toBe('look')
    t.move(9, 330, 380)
    expect(lookState.yaw).toBeCloseTo(-30 * TOUCH_RAD_PER_PX)
    expect(lookState.pitch).toBeCloseTo(20 * TOUCH_RAD_PER_PX)
    // The knob is drawn at the rim, not past it.
    t.move(7, 80, 440)
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
    t.move(1, 200, 700)
    const m = readInput().move
    expect(Math.hypot(m.fwd, m.strafe)).toBeCloseTo(1)
    expect(m.fwd).toBeCloseTo(Math.SQRT1_2)
    t.up(1)
    h.detach()
  })
})

describe('the LOOK stick\'s turn rate', () => {
  const R = 60
  it('nothing inside the dead zone', () => {
    expect(lookStickRate(0, 0, R)).toEqual({ yaw: 0, pitch: 0, mag: 0 })
    expect(lookStickRate(LOOK_DEAD * R - 0.1, 0, R).mag).toBe(0)
    expect(lookStickRate(0, LOOK_DEAD * R - 0.1, R).mag).toBe(0)
  })

  it('the top rate at the rim and past it: 180 degrees a second across, less up and down', () => {
    expect(LOOK_MAX_YAW).toBeCloseTo(Math.PI)
    expect(LOOK_MAX_PITCH).toBeLessThan(LOOK_MAX_YAW)
    expect(lookStickRate(R, 0, R).yaw).toBeCloseTo(-LOOK_MAX_YAW)
    expect(lookStickRate(4 * R, 0, R).yaw).toBeCloseTo(-LOOK_MAX_YAW)
    expect(lookStickRate(0, -R, R).pitch).toBeCloseTo(LOOK_MAX_PITCH)
    expect(lookStickRate(0, -R, R).yaw).toBeCloseTo(0)
  })

  it('a gentle curve: a small push turns much slower than its share of the reach', () => {
    const half = (LOOK_DEAD + (1 - LOOK_DEAD) / 2) * R
    const r = lookStickRate(half, 0, R)
    expect(r.mag).toBeCloseTo(Math.pow(0.5, LOOK_CURVE))
    expect(r.mag).toBeLessThan(0.35)
    // Rising all the way: further out is always faster.
    let prev = 0
    for (let x = LOOK_DEAD * R + 1; x <= R; x += 3) { const m = lookStickRate(x, 0, R).mag; expect(m).toBeGreaterThan(prev); prev = m }
  })

  it('stick right turns the view right and up looks up, as the drag and the mouse do (lookBy)', () => {
    const right = lookStickRate(R, 0, R)
    resetInput(0, 0)
    lookBy(10, 0, 0.01)
    expect(Math.sign(right.yaw)).toBe(Math.sign(lookState.yaw))
    const up = lookStickRate(0, -R, R)
    resetInput(0, 0)
    lookBy(0, -10, 0.01)
    expect(Math.sign(up.pitch)).toBe(Math.sign(lookState.pitch))
    expect(lookStickRate(-R, 0, R).yaw).toBeGreaterThan(0)
    expect(lookStickRate(0, R, R).pitch).toBeLessThan(0)
  })

  it('tickLook turns the view by the rate over the frame; nothing while paused; the pitch stays within its limit', () => {
    setLookRate(-1, 0.5)
    tickLook(0.05)
    expect(lookState.yaw).toBeCloseTo(-0.05)
    expect(lookState.pitch).toBeCloseTo(0.025)
    // A long frame (a tab coming back) turns no more than a tenth of a second's worth.
    tickLook(5)
    expect(lookState.yaw).toBeCloseTo(-0.15)
    setInputPaused(true)
    tickLook(0.05)
    expect(lookState.yaw).toBeCloseTo(-0.15)
    setInputPaused(false)
    setLookRate(0, 100)
    tickLook(0.1)
    expect(lookState.pitch).toBe(PITCH_LIMIT)
    releaseAll()
    const y = lookState.yaw
    tickLook(0.1)
    expect(lookState.yaw).toBe(y)
  })
})

describe('the phone\'s fingers: floating MOVE and LOOK sticks, the look drag', () => {
  const W = 375, H = 812
  const MOVE = { cx: 80, cy: 728, radius: 60 }
  const LOOK = { cx: 295, cy: 728, radius: 60 }
  const tracker = () => new TouchTracker(() => MOVE, { look: () => LOOK })

  it('LOOK: a touch anywhere on the right starts at no turn; the rate grows with the distance from where it landed', () => {
    for (const [x, y] of [[LOOK.cx + 50, LOOK.cy], [W - 30, 200], [W / 2 + 10, 500], [300, H - 10]]) {
      resetInput(0, 0)
      const t = tracker()
      expect(t.down(1, x, y, W, H)).toBe('lookstick')
      expect(lookRateNow()).toEqual({ yaw: 0, pitch: 0 })
      tickLook(0.1)
      expect(lookState.yaw).toBe(0)
      // Inside the dead zone, still nothing.
      t.move(1, x - LOOK_DEAD * LOOK.radius + 0.5, y)
      expect(lookRateNow().yaw).toBe(0)
      // Farther from the landing point is faster, along the curve, wherever the stick's resting place is.
      let prev = 0
      for (const d of [10, 20, 30, 45, 60]) {
        t.move(1, x - d, y)
        const r = lookRateNow().yaw
        expect(r).toBeCloseTo(lookStickRate(-d, 0, LOOK.radius).yaw)
        expect(r).toBeGreaterThan(prev)
        prev = r
      }
      t.up(1)
      expect(lookRateNow()).toEqual({ yaw: 0, pitch: 0 })
    }
  })

  it('the ring is drawn where the thumb lands (kept on screen and on its half), and goes back on lift', () => {
    const t = tracker()
    expect(t.ring).toBeNull()
    expect(t.lookRing).toBeNull()
    t.down(1, 100, 500, W, H)
    t.down(2, 260, 420, W, H)
    expect(t.ring).toEqual({ x: 100, y: 500 })
    expect(t.lookRing).toEqual({ x: 260, y: 420 })
    // The ring stays with the landing point while the finger moves (the knob moves).
    t.move(2, 290, 420)
    expect(t.lookRing).toEqual({ x: 260, y: 420 })
    expect(t.lookKnob).toEqual({ dx: 30, dy: 0 })
    t.up(1)
    t.up(2)
    expect(t.ring).toBeNull()
    expect(t.lookRing).toBeNull()
    expect(t.lookKnob).toEqual({ dx: 0, dy: 0 })
    // Near the edge: the ring is moved in to stay whole on screen, but the turn still starts at nothing and the knob in its middle.
    t.down(3, W - 5, H - 5, W, H)
    const ring = t.lookRing!
    expect(ring.x).toBe(W - LOOK.radius - RING_MARGIN)
    expect(ring.y).toBe(H - LOOK.radius - RING_MARGIN)
    expect(lookRateNow()).toEqual({ yaw: 0, pitch: 0 })
    expect(t.lookKnob).toEqual({ dx: 0, dy: 0 })
    // Just right of the middle: the ring stays on the right half.
    t.up(3)
    t.down(4, W / 2 + 2, 400, W, H)
    expect(t.lookRing!.x - LOOK.radius).toBeGreaterThanOrEqual(W / 2)
    // MOVE's ring stays on the left half.
    t.down(5, W / 2 - 2, 400, W, H)
    expect(t.ring!.x + MOVE.radius).toBeLessThanOrEqual(W / 2)
    expect(t.ring!.x - MOVE.radius).toBeGreaterThanOrEqual(0)
    expect(readInput().move).toEqual({ fwd: 0, strafe: 0 })
  })

  it('ringAt keeps a ring whole on screen and on its half', () => {
    expect(ringAt(10, 10, 50, 'left', 400, 300)).toEqual({ x: 50 + RING_MARGIN, y: 50 + RING_MARGIN })
    expect(ringAt(190, 150, 50, 'left', 400, 300)).toEqual({ x: 150, y: 150 })
    expect(ringAt(210, 290, 50, 'right', 400, 300)).toEqual({ x: 250, y: 300 - 50 - RING_MARGIN })
    expect(ringAt(300, 150, 50, 'right', 400, 300)).toEqual({ x: 300, y: 150 })
  })

  it('a second finger on the right drags the look while LOOK is held; a third is ignored', () => {
    const t = tracker()
    expect(t.down(1, LOOK.cx, LOOK.cy, W, H)).toBe('lookstick')
    expect(t.down(2, 250, 300, W, H)).toBe('look')
    expect(t.down(3, 260, 320, W, H)).toBeNull()
    expect(t.holding).toEqual({ stick: null, lookStick: 1, look: 2 })
    t.move(1, LOOK.cx + 40, LOOK.cy)
    tickLook(0.1)
    expect(lookState.yaw).toBeCloseTo(lookStickRate(40, 0, 60).yaw * 0.1)
    // The drag adds its own turn on top.
    const y = lookState.yaw
    t.move(2, 260, 300)
    expect(lookState.yaw).toBeCloseTo(y - 10 * TOUCH_RAD_PER_PX)
    // Lifting the stick stops the turning; the drag keeps working.
    t.up(1)
    const y2 = lookState.yaw
    tickLook(0.1)
    expect(lookState.yaw).toBe(y2)
    t.move(2, 270, 300)
    expect(lookState.yaw).toBeCloseTo(y2 - 10 * TOUCH_RAD_PER_PX)
  })

  it('a finger keeps its stick wherever it slides, until it lifts', () => {
    const t = tracker()
    t.down(1, MOVE.cx, MOVE.cy, W, H)
    t.down(2, LOOK.cx, LOOK.cy, W, H)
    // The MOVE finger slides over to the right half, the LOOK finger to the left: each keeps its own.
    t.move(1, 300, MOVE.cy)
    t.move(2, 20, LOOK.cy)
    expect(readInput().move.strafe).toBeCloseTo(1)
    expect(t.holding).toEqual({ stick: 1, lookStick: 2, look: null })
    tickLook(0.1)
    expect(lookState.yaw).toBeGreaterThan(0)
    t.clear()
    expect(t.holding).toEqual({ stick: null, lookStick: null, look: null })
    expect(t.ring).toBeNull()
    expect(readInput().move).toEqual({ fwd: 0, strafe: 0 })
    const y = lookState.yaw
    tickLook(0.1)
    expect(lookState.yaw).toBe(y)
  })

  it('without a LOOK stick on screen (a desktop touch screen) the right half drags as before', () => {
    const t = new TouchTracker(() => MOVE)
    expect(t.down(1, LOOK.cx, LOOK.cy, W, H)).toBe('look')
  })
})

describe('aim: the MOVE stick aims while the rail charges', () => {
  const W = 375, H = 812
  const MOVE = { cx: 80, cy: 728, radius: 60 }
  const LOOK = { cx: 295, cy: 728, radius: 60 }
  const tracker = () => new TouchTracker(() => MOVE, { look: () => LOOK })

  it('the MOVE stick turns the view at the finer rate, from where it lands; the steps read no movement', () => {
    const t = tracker()
    t.setAim(true)
    expect(aimingNow()).toBe(true)
    expect(t.down(1, 120, 600, W, H)).toBe('stick')
    expect(lookRateNow()).toEqual({ yaw: 0, pitch: 0 })
    t.move(1, 160, 560)
    const r = lookRateNow()
    const want = lookStickRate(40, -40, MOVE.radius, AIM_SCALE)
    expect(r.yaw).toBeCloseTo(want.yaw)
    expect(r.pitch).toBeCloseTo(want.pitch)
    expect(r.yaw).toBeLessThan(0)
    expect(r.pitch).toBeGreaterThan(0)
    // Finer than LOOK at the same push.
    expect(Math.abs(r.yaw)).toBeCloseTo(Math.abs(lookStickRate(40, -40, MOVE.radius).yaw) * AIM_SCALE)
    expect(readInput().move).toEqual({ fwd: 0, strafe: 0 })
    tickLook(0.1)
    expect(lookState.yaw).toBeCloseTo(want.yaw * 0.1)
    // Even the keys move nothing while it aims.
    t.up(1)
    expect(lookRateNow()).toEqual({ yaw: 0, pitch: 0 })
    t.setAim(false)
    expect(aimingNow()).toBe(false)
  })

  it('a finger held through the switch re-centres where it is, both ways, so neither the aim nor the run jumps', () => {
    const t = tracker()
    t.down(1, MOVE.cx, MOVE.cy, W, H)
    t.move(1, MOVE.cx, MOVE.cy - 60)
    expect(readInput().move.fwd).toBeCloseTo(1)
    t.setAim(true)
    expect(readInput().move).toEqual({ fwd: 0, strafe: 0 })
    expect(lookRateNow()).toEqual({ yaw: 0, pitch: 0 })
    expect(t.knob).toEqual({ dx: 0, dy: 0 })
    expect(t.ring).toEqual({ x: MOVE.cx, y: MOVE.cy - 60 })
    // A small nudge from there aims a little, not a full push up.
    t.move(1, MOVE.cx + 20, MOVE.cy - 60)
    expect(lookRateNow().yaw).toBeCloseTo(lookStickRate(20, 0, MOVE.radius, AIM_SCALE).yaw)
    expect(lookRateNow().pitch).toBeCloseTo(0)
    t.setAim(false)
    expect(lookRateNow()).toEqual({ yaw: 0, pitch: 0 })
    expect(readInput().move).toEqual({ fwd: 0, strafe: 0 })
    t.move(1, MOVE.cx + 20, MOVE.cy - 120)
    expect(readInput().move.fwd).toBeCloseTo(1)
  })

  it('the LOOK stick rests: its finger turns nothing and new touches on the right are not taken; back after, from where it is', () => {
    const t = tracker()
    t.down(2, LOOK.cx, LOOK.cy, W, H)
    t.move(2, LOOK.cx + 60, LOOK.cy)
    expect(lookRateNow().yaw).toBeLessThan(0)
    t.setAim(true)
    expect(lookRateNow()).toEqual({ yaw: 0, pitch: 0 })
    t.move(2, LOOK.cx + 90, LOOK.cy - 30)
    expect(lookRateNow()).toEqual({ yaw: 0, pitch: 0 })
    expect(t.down(3, 250, 300, W, H)).toBeNull()
    // The aim drives, and the resting LOOK finger lifting does not stop it.
    t.down(1, 100, 600, W, H)
    t.move(1, 140, 600)
    const aim = lookRateNow().yaw
    expect(aim).toBeLessThan(0)
    expect(t.down(4, 300, 300, W, H)).toBeNull()
    // Aim off: the LOOK finger still down is re-centred where it is now, so it starts at no turn.
    t.setAim(false)
    expect(lookRateNow()).toEqual({ yaw: 0, pitch: 0 })
    t.move(2, LOOK.cx + 90 + 30, LOOK.cy - 30)
    expect(lookRateNow().yaw).toBeCloseTo(lookStickRate(30, 0, LOOK.radius).yaw)
    t.clear()
  })

  it('the LOOK finger lifting under the aim leaves the aim turning', () => {
    const t = tracker()
    t.down(2, LOOK.cx, LOOK.cy, W, H)
    t.setAim(true)
    t.down(1, 100, 600, W, H)
    t.move(1, 140, 600)
    const aim = lookRateNow().yaw
    t.up(2)
    expect(lookRateNow().yaw).toBe(aim)
    t.clear()
    expect(lookRateNow()).toEqual({ yaw: 0, pitch: 0 })
  })

  it('FIRE\'s pad fingers are known by name (the HUD reads them for the aim); letting go of everything ends the aim', () => {
    expect(padFiring()).toBe(false)
    setFire('mouse', true)
    expect(padFiring()).toBe(false)
    setFire('pad:fire:4', true)
    expect(padFiring()).toBe(true)
    const t = tracker()
    t.setAim(true)
    releaseAll()
    expect(padFiring()).toBe(false)
    expect(aimingNow()).toBe(false)
  })
})
