import { describe, expect, it } from 'vitest'
import {
  CAM_IMPACT_PITCH, CAM_WINDUP_PITCH, CANCEL_MS, HITSTOP_MS, IDLE_CLOCK, POSE_CALM_DIP, POSE_IDLE, POSE_IMPACT, POSE_READY, POSE_WINDUP, READY_MAX_MS,
  RECOVER_MS, WINDUP_MAX_MS, chargeAt, hammerBusy, hammerPose, newPose, nextClock, phaseAt, readyMs, windupFromMs, type HammerClock,
} from '../hammerAnim'
import { shatterLayers } from '../smashSound'

const SWING = 180
const hold = (ms: number, since = 0): HammerClock => ({ ...IDLE_CLOCK, since, ms })
const swung = (ms: number, swingAt = 0): HammerClock => ({ ...IDLE_CLOCK, ms, swingAt })

describe('the phases across a hold', () => {
  it('maps a 4 second hold: ready, charge, windup, in that order and at the stated shares', () => {
    const c = hold(4000)
    expect(readyMs(4000)).toBe(600)
    expect(windupFromMs(4000)).toBe(3100)
    expect(phaseAt(0, c, SWING).phase).toBe('ready')
    expect(phaseAt(599, c, SWING).phase).toBe('ready')
    expect(phaseAt(600, c, SWING)).toMatchObject({ phase: 'charge', t: 0 })
    expect(phaseAt(1850, c, SWING)).toMatchObject({ phase: 'charge', t: 0.5 })
    expect(phaseAt(3100, c, SWING)).toMatchObject({ phase: 'windup', t: 0 })
    expect(phaseAt(3999, c, SWING).phase).toBe('windup')
    // The timer that ends the hold may be late: the wind-up holds at its top.
    expect(phaseAt(4100, c, SWING)).toMatchObject({ phase: 'windup', t: 1 })
  })

  it('stretches to a hold of any length, by shares for a short one and capped for a long one', () => {
    for (const ms of [800, 3000, 4000, 5000, 7000, 20000]) {
      const ready = readyMs(ms), wind = windupFromMs(ms)
      expect(ready).toBeGreaterThan(0)
      expect(ready).toBeLessThan(wind)
      expect(wind).toBeLessThan(ms)
      expect(ready).toBeLessThanOrEqual(READY_MAX_MS)
      expect(ms - wind).toBeLessThanOrEqual(WINDUP_MAX_MS)
      const c = hold(ms)
      expect(phaseAt(ready / 2, c, SWING).phase).toBe('ready')
      expect(phaseAt((ready + wind) / 2, c, SWING).phase).toBe('charge')
      expect(phaseAt((wind + ms) / 2, c, SWING).phase).toBe('windup')
    }
    // A short hold keeps the shares; a long one keeps the caps, and the charge takes the rest.
    expect(readyMs(1000)).toBe(150)
    expect(windupFromMs(1000)).toBe(760)
    expect(readyMs(20000)).toBe(600)
    expect(windupFromMs(20000)).toBe(19100)
  })

  it('after the hold: the swing for swingMs, the hit-stop, the recovery, then rest', () => {
    const c = swung(4000, 10_000)
    expect(phaseAt(10_000, c, SWING)).toMatchObject({ phase: 'swing', t: 0, sinceImpact: null })
    expect(phaseAt(10_090, c, SWING)).toMatchObject({ phase: 'swing', t: 0.5 })
    expect(phaseAt(10_000 + SWING, c, SWING)).toMatchObject({ phase: 'impact', t: 0, sinceImpact: 0 })
    expect(phaseAt(10_000 + SWING + HITSTOP_MS - 1, c, SWING).phase).toBe('impact')
    expect(phaseAt(10_000 + SWING + HITSTOP_MS, c, SWING)).toMatchObject({ phase: 'recover', t: 0, sinceImpact: HITSTOP_MS })
    expect(phaseAt(10_000 + SWING + HITSTOP_MS + RECOVER_MS - 1, c, SWING).phase).toBe('recover')
    expect(phaseAt(10_000 + SWING + HITSTOP_MS + RECOVER_MS, c, SWING).phase).toBe('idle')
    // The swing's length is whatever the smash says it is.
    expect(phaseAt(10_250, c, 300).phase).toBe('swing')
    expect(phaseAt(10_300, c, 300).phase).toBe('impact')
  })

  it('is busy from the start of a hold to the end of the recovery, and not at rest', () => {
    expect(hammerBusy(5, IDLE_CLOCK, SWING)).toBe(false)
    expect(hammerBusy(5, hold(4000), SWING)).toBe(true)
    expect(hammerBusy(100, swung(4000), SWING)).toBe(true)
    expect(hammerBusy(SWING + HITSTOP_MS + RECOVER_MS + 1, swung(4000), SWING)).toBe(false)
  })
})

describe('the poses', () => {
  it('rests as the small corner item, two-handed: shaft to the lower left, head up and to the right', () => {
    const p = hammerPose(0, IDLE_CLOCK, SWING, false)
    expect(p).toEqual(POSE_IDLE)
    // Leaning right (the head toward the right of the screen), in the right half, low, and far off (small).
    expect(p.roll).toBeLessThan(0)
    expect(p.wide).toBe(1)
    expect(p.x).toBeLessThan(0.5)
    expect(p.y).toBeLessThan(-0.5)
    expect(p.depth).toBeGreaterThan(POSE_READY.depth * 1.5)
  })

  it('comes forward and large by the end of ready, unlit', () => {
    const c = hold(4000)
    const p = hammerPose(readyMs(4000), c, SWING, false)
    expect(p.depth).toBeCloseTo(POSE_READY.depth, 5)
    expect(p.x).toBeCloseTo(POSE_READY.x, 5)
    expect(p.wide).toBeCloseTo(0, 5)
    expect(p.charge).toBe(0)
    expect(p.sparks).toBe(0)
    // On the way it overshoots a little: nearer than the ready hold for a moment.
    const depths = [0.6, 0.7, 0.8, 0.9].map((k) => hammerPose(readyMs(4000) * k, c, SWING, false).depth)
    expect(Math.min(...depths)).toBeLessThan(POSE_READY.depth)
  })

  it('lights progressively through the charge, sparks few at first and many at the top', () => {
    const c = hold(4000)
    let last = -1
    for (let e = 600; e <= 4000; e += 100) {
      const p = hammerPose(e, c, SWING, false)
      expect(p.charge).toBeGreaterThanOrEqual(last)
      expect(p.sparks).toBeLessThanOrEqual(p.charge + 1e-9)
      expect(p.sparks).toBeCloseTo(p.charge ** 1.5, 9)
      last = p.charge
    }
    expect(chargeAt(600, 4000)).toBe(0)
    expect(chargeAt(2300, 4000)).toBeCloseTo(0.5, 5)
    expect(chargeAt(4000, 4000)).toBe(1)
    // The view does not move while it only charges.
    expect(hammerPose(2000, c, SWING, false)).toMatchObject({ camPitch: 0, camRoll: 0, shake: 0 })
  })

  it('winds up: a dip first, then up and back over the head with the view tilting up a few degrees', () => {
    const c = hold(4000)
    const from = windupFromMs(4000)
    const dip = hammerPose(from + 900 * 0.11, c, SWING, false)
    expect(dip.y).toBeLessThan(POSE_READY.y)
    expect(dip.pitch).toBeGreaterThan(POSE_READY.pitch)
    const top = hammerPose(4000, c, SWING, false)
    expect(top.pitch).toBeCloseTo(POSE_WINDUP.pitch, 5)
    expect(top.y).toBeCloseTo(POSE_WINDUP.y, 5)
    expect(top.pitch).toBeLessThan(-1)
    expect(top.charge).toBe(1)
    expect(top.camPitch).toBeCloseTo(CAM_WINDUP_PITCH, 9)
    expect(Math.abs(top.camPitch)).toBeLessThan((4 * Math.PI) / 180)
  })

  it('swings down slow off the top and fast at the blocks, with the streak, and lands on the cross', () => {
    const c = swung(4000)
    const start = hammerPose(0, c, SWING, false), mid = hammerPose(SWING / 2, c, SWING, false), hit = hammerPose(SWING, c, SWING, false)
    expect(start.pitch).toBeCloseTo(POSE_WINDUP.pitch, 5)
    // Halfway through its time it has covered well under half its arc.
    expect((mid.pitch - start.pitch) / (hit.pitch - start.pitch)).toBeLessThan(0.3)
    expect(mid.trail).toBeGreaterThan(0)
    expect(hit).toMatchObject({ x: POSE_IMPACT.x, y: POSE_IMPACT.y, pitch: POSE_IMPACT.pitch, depth: POSE_IMPACT.depth })
  })

  it('holds still for the hit-stop with the flash and the kick, then rebounds and comes home', () => {
    const c = swung(4000)
    const a = hammerPose(SWING, c, SWING, false), b = hammerPose(SWING + HITSTOP_MS - 1, c, SWING, false)
    for (const k of ['x', 'y', 'depth', 'pitch', 'yaw', 'roll'] as const) expect(b[k]).toBe(a[k])
    expect(a.flash).toBe(1)
    expect(a.shake).toBe(1)
    expect(a.camPitch).toBe(CAM_IMPACT_PITCH)
    expect(HITSTOP_MS).toBeGreaterThanOrEqual(60)
    expect(HITSTOP_MS).toBeLessThanOrEqual(90)
    const rebound = hammerPose(SWING + HITSTOP_MS + RECOVER_MS * 0.2, c, SWING, false)
    expect(rebound.pitch).toBeLessThan(POSE_IMPACT.pitch)
    const late = hammerPose(SWING + HITSTOP_MS + RECOVER_MS - 1, c, SWING, false)
    expect(late.depth).toBeCloseTo(POSE_IDLE.depth, 1)
    expect(late.charge).toBe(0)
    expect(late.shake).toBe(0)
    expect(Math.abs(late.camPitch)).toBeLessThan(0.001)
    expect(hammerPose(SWING + HITSTOP_MS + RECOVER_MS, c, SWING, false)).toEqual(POSE_IDLE)
  })

  it('never moves the view more than a few degrees', () => {
    const limit = (4 * Math.PI) / 180
    for (let e = 0; e <= 4000; e += 20) {
      const p = hammerPose(e, hold(4000), SWING, false)
      expect(Math.abs(p.camPitch)).toBeLessThanOrEqual(limit)
      expect(Math.abs(p.camRoll)).toBeLessThanOrEqual(limit)
    }
    for (let e = 0; e <= 1000; e += 5) expect(Math.abs(hammerPose(e, swung(4000), SWING, false).camPitch)).toBeLessThanOrEqual(limit)
  })

  it('with reduced motion: forward, charged, a dip; never overhead, no streak, and the view never moves', () => {
    const calmAt = (c: HammerClock, e: number) => hammerPose(e, c, SWING, true)
    for (let e = 0; e <= 4000; e += 50) {
      const p = calmAt(hold(4000), e)
      expect(p.pitch).toBeGreaterThan(0)
      expect(p).toMatchObject({ camPitch: 0, camRoll: 0, shake: 0, tremble: 0, trail: 0 })
    }
    expect(calmAt(hold(4000), 3900).charge).toBeGreaterThan(0.9)
    for (let e = 0; e <= 1000; e += 10) {
      const p = calmAt(swung(4000), e)
      expect(p.pitch).toBeGreaterThan(0)
      expect(p).toMatchObject({ camPitch: 0, camRoll: 0, shake: 0, trail: 0 })
    }
    expect(calmAt(swung(4000), SWING).pitch).toBeCloseTo(POSE_CALM_DIP.pitch, 9)
  })

  it('writes into the pose it is given, making nothing', () => {
    const out = newPose()
    expect(hammerPose(2000, hold(4000), SWING, false, out)).toBe(out)
    expect(hammerPose(100, swung(4000), SWING, false, out)).toBe(out)
  })
})

describe('letting go early', () => {
  it('the tracker notes a let-go, with how far in it came; a completed hold is not one', () => {
    let c = nextClock(IDLE_CLOCK, { since: 1000, ms: 4000, swingAt: null }, 1000)
    expect(c).toMatchObject({ since: 1000, ms: 4000, cancelAt: null })
    const letGo = nextClock(c, { since: null, ms: 4000, swingAt: null }, 2500)
    expect(letGo).toMatchObject({ since: null, ms: 4000, cancelAt: 2500, cancelFrom: 1500 })
    const done = nextClock(c, { since: null, ms: 4000, swingAt: 5000 }, 5000)
    expect(done).toMatchObject({ since: null, swingAt: 5000, cancelAt: null })
    // A new hold forgets the let-go.
    c = nextClock(letGo, { since: 3000, ms: 7000, swingAt: null }, 3000)
    expect(c).toMatchObject({ since: 3000, ms: 7000, cancelAt: null })
  })

  it('carries the hammer smoothly from where it was back to rest, the light winding down, with no smash', () => {
    const held = hold(4000, 1000)
    const before = hammerPose(3000, held, SWING, false)
    const c = nextClock(held, { since: null, ms: 4000, swingAt: null }, 3000)
    expect(phaseAt(3000, c, SWING)).toMatchObject({ phase: 'cancel', t: 0, sinceImpact: null })
    const at0 = hammerPose(3000, c, SWING, false)
    // No jump at the moment of letting go.
    for (const k of ['x', 'y', 'depth', 'pitch', 'yaw', 'roll', 'charge'] as const) expect(at0[k]).toBeCloseTo(before[k], 9)
    expect(at0.sparks).toBe(0)
    let last = at0.charge
    for (let e = 20; e < CANCEL_MS; e += 20) {
      const p = hammerPose(3000 + e, c, SWING, false)
      expect(p.charge).toBeLessThan(last)
      expect(p).toMatchObject({ flash: 0, trail: 0, shake: 0 })
      last = p.charge
    }
    expect(phaseAt(3000 + CANCEL_MS, c, SWING).phase).toBe('idle')
    expect(hammerPose(3000 + CANCEL_MS, c, SWING, false)).toEqual(POSE_IDLE)
    // Never a swing or an impact.
    for (let e = 0; e < 2000; e += 10) expect(['cancel', 'idle']).toContain(phaseAt(3000 + e, c, SWING).phase)
  })

  it('a let-go in the wind-up brings the view back level too', () => {
    const held = hold(4000)
    const c = nextClock(held, { since: null, ms: 4000, swingAt: null }, 3900)
    expect(hammerPose(3900, c, SWING, false).camPitch).toBeGreaterThan(0)
    expect(hammerPose(3900 + CANCEL_MS - 1, c, SWING, false).camPitch).toBeLessThan(0.001)
  })

  it('a let-go after an earlier smash is still a let-go, and a smash after a let-go still swings', () => {
    const afterSmash = nextClock({ ...IDLE_CLOCK, ms: 4000, swingAt: 100, since: 5000 }, { since: null, ms: 4000, swingAt: 100 }, 6000)
    expect(phaseAt(6100, afterSmash, SWING).phase).toBe('cancel')
    const smashAfterLetGo: HammerClock = { ...IDLE_CLOCK, ms: 4000, cancelAt: 1000, cancelFrom: 500, swingAt: 9000 }
    expect(phaseAt(9050, smashAfterLetGo, SWING).phase).toBe('swing')
  })
})

describe('the glass at the impact', () => {
  it('lays more breaks over each other the more blocks went, within its limits', () => {
    expect(shatterLayers(1)).toBe(3)
    expect(shatterLayers(27)).toBeGreaterThan(shatterLayers(4))
    expect(shatterLayers(4)).toBeGreaterThan(shatterLayers(1))
    expect(shatterLayers(4096)).toBe(8)
    expect(shatterLayers(0)).toBe(3)
  })
})
