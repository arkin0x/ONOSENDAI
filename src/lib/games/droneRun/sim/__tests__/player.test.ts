/**
 * player.test.ts - the first-person body (sim/player.ts): fluid WALK's run,
 * sliding along walls, WALK's stair rule (a riser of 2 is climbed, 3 is
 * not; a drop of 2 is settled, deeper is fallen), the jump of 5 and the
 * double jump of exactly 3 more, and walls that hold at full speed.
 */

import { describe, expect, it } from 'vitest'
import { makeBody, placeBody, regionBounds, stepPlayer, type Body } from '../player'
import { FLUID_MAX_SPEED } from '../fluid'
import { STEP_S } from '../run'
import type { Solids } from '../solids'
import { GROUND, boxes, input, variant } from './helpers'
import type { RunInput, Vec3 } from '../../types'

const spec = variant().spec.player
const bounds = regionBounds()

function at(s: Solids, p: Vec3): Body {
  const b = makeBody(p)
  placeBody(b, spec, s, bounds)
  return b
}

function run(s: Solids, b: Body, steps: number, inp: RunInput | ((i: number, b: Body) => RunInput), each?: (b: Body, i: number) => void): void {
  for (let i = 0; i < steps; i++) {
    stepPlayer(b, spec, s, bounds, typeof inp === 'function' ? inp(i, b) : inp, STEP_S)
    each?.(b, i)
  }
}

const fwd = (yaw = 0): RunInput => input({ move: { fwd: 1, strafe: 0 }, yaw })

describe('player body', () => {
  const flat = boxes(GROUND)

  it('walks: reaches fluid WALK speed in about 0.2 s and stops in about 0.15 s', () => {
    const b = at(flat, [128, 64, 200])
    expect(b.grounded).toBe(true)
    run(flat, b, 14, fwd())
    expect(Math.hypot(b.vel[0], b.vel[2])).toBeCloseTo(FLUID_MAX_SPEED, 6)
    run(flat, b, 46, fwd())
    // One second: full speed for 0.8 s plus the ramp.
    expect(Math.abs(200 - b.pos[2] - (FLUID_MAX_SPEED - (FLUID_MAX_SPEED * FLUID_MAX_SPEED) / (2 * 45)))).toBeLessThan(0.15)
    expect(b.pos[1]).toBe(64)
    run(flat, b, 10, input())
    expect(Math.hypot(b.vel[0], b.vel[2])).toBe(0)
  })

  it('the spec hand (spec 11.3, DECK-0002 9.4): facing -Z right is -X, facing +Z right is +X, and yaw pi/2 turns left toward +X', () => {
    const b = at(flat, [128, 64, 200])
    run(flat, b, 30, fwd(Math.PI / 2))
    expect(b.pos[0]).toBeGreaterThan(130)
    expect(b.pos[2]).toBeCloseTo(200, 6)
    // Facing -Z (yaw 0), strafe +1 (right) goes to -X.
    const c = at(flat, [128, 64, 200])
    run(flat, c, 30, input({ move: { fwd: 0, strafe: 1 } }))
    expect(c.pos[0]).toBeLessThan(126)
    // Facing +Z (yaw pi), right is +X.
    const d = at(flat, [128, 64, 200])
    run(flat, d, 30, input({ move: { fwd: 0, strafe: 1 }, yaw: Math.PI }))
    expect(d.pos[0]).toBeGreaterThan(130)
    run(flat, d, 30, input({ move: { fwd: 1, strafe: 0 }, yaw: Math.PI }))
    expect(d.pos[2]).toBeGreaterThan(202)
  })

  it('slides along a wall: speed along it kept, never into it', () => {
    const s = boxes(GROUND, [[130, 64, 100], [131, 72, 220]])
    const b = at(s, [128, 64, 200])
    // Heading 45 degrees left of -Z (yaw pi/4): toward +X and -Z.
    run(s, b, 120, fwd(Math.PI / 4), (bb) => expect(bb.pos[0]).toBeLessThanOrEqual(130 - spec.radius + 1e-9))
    expect(b.pos[0]).toBeGreaterThan(129.5)
    // Along the wall at about cos 45 of full speed.
    expect(-b.vel[2]).toBeGreaterThan(FLUID_MAX_SPEED * 0.6)
    expect(200 - b.pos[2]).toBeGreaterThan(9)
  })

  it('climbs a riser of 2 without jumping, but not one of 3', () => {
    const two = boxes(GROUND, [[110, 64, 180], [146, 66, 195]])
    const b = at(two, [128, 64, 200])
    run(two, b, 90, fwd())
    expect(b.pos[1]).toBeCloseTo(66, 9)
    expect(b.pos[2]).toBeLessThan(195)
    const three = boxes(GROUND, [[110, 64, 180], [146, 67, 195]])
    const c = at(three, [128, 64, 200])
    run(three, c, 90, fwd())
    expect(c.pos[1]).toBe(64)
    expect(c.pos[2]).toBeGreaterThanOrEqual(195 + spec.radius - 1e-9)
  })

  it('settles down a drop of 2 without falling, and falls off a deeper ledge', () => {
    const s = boxes(GROUND, [[110, 64, 196], [146, 66, 230]], [[110, 64, 150], [146, 69, 175]])
    const b = at(s, [128, 66, 210])
    expect(b.pos[1]).toBe(66)
    let airborne = 0
    run(s, b, 150, fwd(), (bb) => { if (!bb.grounded) airborne++ })
    expect(airborne).toBe(0)
    expect(b.pos[1]).toBe(64)
    // Now from the 5-high block (y 69), walking off its -Z edge: a fall.
    const c = at(s, [128, 69, 160])
    let fell = false
    run(s, c, 150, fwd(), (bb) => { if (!bb.grounded) fell = true })
    expect(fell).toBe(true)
    expect(c.pos[1]).toBe(64)
    expect(c.grounded).toBe(true)
  })

  it('jumps 5 and double jumps exactly 3 more', () => {
    const b = at(flat, [128, 64, 200])
    let top = 0
    run(flat, b, 1, input({ jump: true }), (bb) => { top = Math.max(top, bb.pos[1] - 64) })
    run(flat, b, 90, input(), (bb) => { top = Math.max(top, bb.pos[1] - 64) })
    expect(top).toBeGreaterThan(4.99)
    expect(top).toBeLessThanOrEqual(5 + 1e-9)
    expect(b.grounded).toBe(true)
    expect(b.pos[1]).toBe(64)

    // The double jump pressed at the top of the first: 5 + 3.
    const c = at(flat, [128, 64, 200])
    let top2 = 0, pressed = false
    run(flat, c, 1, input({ jump: true }))
    run(flat, c, 150, (_, bb) => {
      const now = !pressed && bb.vel[1] <= 0
      if (now) pressed = true
      return input({ jump: now })
    }, (bb) => { top2 = Math.max(top2, bb.pos[1] - 64) })
    expect(top2).toBeGreaterThan(7.98)
    expect(top2).toBeLessThanOrEqual(8 + 0.01)
    // Only one double jump a time in the air.
    const d = at(flat, [128, 64, 200])
    let top3 = 0
    run(flat, d, 150, (i) => input({ jump: i % 10 === 0 }), (bb) => { top3 = Math.max(top3, bb.pos[1] - 64) })
    expect(top3).toBeLessThan(8.01)
  })

  it('a ceiling ends the rise', () => {
    const s = boxes(GROUND, [[120, 68, 190], [136, 70, 210]])
    const b = at(s, [128, 64, 200])
    let top = 0
    run(s, b, 60, (i) => input({ jump: i === 0 }), (bb) => { top = Math.max(top, bb.pos[1] + spec.height) })
    expect(top).toBeLessThanOrEqual(68)
    expect(top).toBeGreaterThan(67.9)
    expect(b.pos[1]).toBe(64)
  })

  it('walks under a lintel 2.5 high (the lifted stair move falls back to a lower lift)', () => {
    const s = boxes(GROUND, [[110, 66.5, 190], [146, 70, 192]])
    const b = at(s, [128, 64, 200])
    run(s, b, 120, fwd())
    expect(b.pos[2]).toBeLessThan(185)
    expect(b.pos[1]).toBe(64)
  })

  it('never goes through a thin wall at full speed, at any angle, jumping or not', () => {
    for (let k = -6; k <= 6; k++) {
      const s = boxes(GROUND, [[0, 64, 180], [255, 74, 180.05]])
      const b = at(s, [128, 64, 196])
      const yaw = (k / 6) * (Math.PI / 2.2)
      run(s, b, 240, (i) => input({ move: { fwd: 1, strafe: 0 }, yaw, jump: i % 25 === 0 }), (bb) => {
        expect(bb.pos[2]).toBeGreaterThanOrEqual(180.05 + spec.radius - 1e-6)
      })
    }
  })

  it('never leaves the region', () => {
    const b = at(flat, [3, 64, 3])
    run(flat, b, 120, input({ move: { fwd: 1, strafe: 1 }, yaw: 0 }), (bb) => {
      expect(bb.pos[0] - spec.radius).toBeGreaterThanOrEqual(-0.5 - 1e-9)
      expect(bb.pos[2] - spec.radius).toBeGreaterThanOrEqual(-0.5 - 1e-9)
    })
    expect(b.pos[0]).toBeCloseTo(-0.5 + spec.radius, 1)
  })
})

describe('sprint and stamina (RunInput.sprint, spec.player.stamina)', () => {
  const flat = boxes(GROUND)
  const st = spec.stamina!
  const sprintFwd = (sprint = true): RunInput => input({ move: { fwd: 1, strafe: 0 }, sprint })
  const speed = (b: Body): number => Math.hypot(b.vel[0], b.vel[2])

  function fresh(): Body {
    const b = makeBody([128, 64, 230], 0, st.max)
    placeBody(b, spec, flat, bounds)
    return b
  }

  it('the base variant: 100 of stamina, 35 a second sprinting, 25 a second back after 0.6 s, a 1.2 s lockout, 1.6 times the speed', () => {
    expect(st).toEqual({ max: 100, drainPerS: 35, refillPerS: 25, refillDelayS: 0.6, lockoutS: 1.2, speedMul: 1.6 })
  })

  it('sprinting multiplies the top speed by speedMul; walking keeps fluid WALK\'s', () => {
    const b = fresh()
    run(flat, b, 60, sprintFwd())
    expect(b.sprinting).toBe(true)
    expect(speed(b)).toBeCloseTo(FLUID_MAX_SPEED * st.speedMul, 6)
    const w = fresh()
    run(flat, w, 60, sprintFwd(false))
    expect(w.sprinting).toBe(false)
    expect(speed(w)).toBeCloseTo(FLUID_MAX_SPEED, 6)
    // Let go, the body brakes back down to the walking top speed.
    run(flat, b, 30, sprintFwd(false))
    expect(speed(b)).toBeCloseTo(FLUID_MAX_SPEED, 6)
  })

  it('drains drainPerS a second while sprinting', () => {
    const b = fresh()
    run(flat, b, 60, sprintFwd())
    expect(b.stamina).toBeCloseTo(st.max - st.drainPerS, 9)
  })

  it('standing still, sprint does nothing: no drain, no sprinting', () => {
    const b = fresh()
    run(flat, b, 120, input({ sprint: true }))
    expect(b.sprinting).toBe(false)
    expect(b.stamina).toBe(st.max)
    expect(speed(b)).toBe(0)
  })

  it('refills refillPerS a second, only once refillDelayS has passed since the last sprinting step, up to max', () => {
    const b = fresh()
    run(flat, b, 60, sprintFwd())
    const left = b.stamina
    // 0.6 s (36 steps) of nothing...
    run(flat, b, 36, sprintFwd(false))
    expect(b.stamina).toBe(left)
    // ...then 25 a second.
    run(flat, b, 60, sprintFwd(false))
    expect(b.stamina).toBeCloseTo(left + st.refillPerS, 9)
    // A sprinting step restarts the delay.
    run(flat, b, 1, sprintFwd())
    const again = b.stamina
    run(flat, b, 36, sprintFwd(false))
    expect(b.stamina).toBe(again)
    run(flat, b, 600, sprintFwd(false))
    expect(b.stamina).toBe(st.max)
  })

  it('running dry locks sprint out for lockoutS, even held; then it sprints again on what has refilled', () => {
    const b = fresh()
    let empty = -1
    run(flat, b, 400, sprintFwd(), (x, i) => { if (empty < 0 && x.stamina === 0) empty = i })
    // 100 at 35 a second: dry on the 172nd step.
    expect(empty).toBe(171)
    const c = fresh()
    run(flat, c, 172, sprintFwd())
    expect(c.stamina).toBe(0)
    expect(c.sprintLock).toBe(st.lockoutS)
    const sprinted: boolean[] = []
    run(flat, c, 72, sprintFwd(), (x) => sprinted.push(x.sprinting))
    // 71 steps locked out (sprint held all along), sprinting again on the 72nd: 1.2 s.
    expect(sprinted.slice(0, 71).every((s) => !s)).toBe(true)
    expect(sprinted[71]).toBe(true)
    expect(speed(c)).toBeLessThan(FLUID_MAX_SPEED + 1)
    // The refill ran during the lockout once its delay had passed: 35 steps at 25 a second, less the sprinting step.
    expect(c.stamina).toBeCloseTo((35 * st.refillPerS) / 60 - st.drainPerS / 60, 9)
  })

  it('without stamina in the variant, sprint does nothing', () => {
    const plain = { ...spec, stamina: undefined }
    const b = makeBody([128, 64, 230])
    placeBody(b, plain, flat, bounds)
    for (let i = 0; i < 60; i++) stepPlayer(b, plain, flat, bounds, sprintFwd(), STEP_S)
    expect(b.sprinting).toBe(false)
    expect(speed(b)).toBeCloseTo(FLUID_MAX_SPEED, 6)
  })
})
