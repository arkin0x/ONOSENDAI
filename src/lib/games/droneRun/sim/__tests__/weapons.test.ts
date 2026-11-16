/**
 * weapons.test.ts - the guns (sim/weapons.ts) with the base variant's
 * numbers: exact cadence whatever the frame times, range, the seeded spread
 * cone, pellets, falloff, heat and its lock, ammo and reloads, charge
 * scaling, pierce, switching, and projectiles.
 */

import { describe, expect, it } from 'vitest'
import { coneSample, falloffAt, makeArsenal, stepGuns, stepProjectiles, type DamageHit, type GunContext, type Projectile, type Target } from '../weapons'
import { makeRng, next } from '../rng'
import { buildSolids, type Solids } from '../solids'
import { advance, createRun, STEP_S } from '../run'
import type { RunEvent } from '../events'
import type { RunInput, Vec3, WeaponDef } from '../../types'
import { GROUND, boxes, input, testLevel, variant } from './helpers'

const defs = variant().spec.weapons
const [PULSE, SCATTER, RAIL] = [0, 1, 2]
const empty = buildSolids([])

function rig(d: WeaponDef[] = defs, targets: Target[] = [], solids: Solids = empty) {
  const a = makeArsenal(d)
  const events: RunEvent[] = []
  const hits: DamageHit[] = []
  const projectiles: Projectile[] = []
  const ctx: GunContext = { defs: d, solids, targets, rng: makeRng(7), eye: [0, 0, 0], dir: [0, 0, -1], dt: STEP_S, events, hits, projectiles, ids: { next: 1 } }
  const step = (inp: Partial<Pick<RunInput, 'fire' | 'select' | 'reload'>> = {}): void => {
    events.length = 0
    stepGuns(a, { fire: false, select: null, reload: false, ...inp }, ctx)
    stepProjectiles(ctx)
  }
  return { a, ctx, events, hits, step }
}

const shots = (ev: RunEvent[]) => ev.filter((e) => e.type === 'shot').length
const straight = (i: number, over: Partial<WeaponDef> = {}): WeaponDef[] => defs.map((d, k) => (k === i ? { ...d, spread: 0, ...over } : d))

describe('weapons', () => {
  it('fire rate is exact over N seconds at uneven frame times', () => {
    const lv = testLevel()
    const solids = boxes(GROUND)
    const count = (frames: number[]): { shots: number; steps: number } => {
      // No heat here, so ten seconds of fire are never cut by an overheat.
      const v = variant()
      v.spec.weapons[PULSE].heat!.perShot = 0
      const st = createRun(v, solids, { level: lv })
      let carry = 0, n = 0
      for (const f of frames) carry = advance(st, carry, f, input({ fire: true }), (s) => { n += shots(s.events) })
      return { shots: n, steps: st.step }
    }
    // Ten seconds of frames between 5 and 45 ms, seeded.
    const r = makeRng(99)
    const uneven: number[] = []
    let total = 0
    while (total < 10) { const f = 0.005 + next(r) * 0.04; uneven.push(f); total += f }
    const a = count(uneven)
    const even = count(Array.from({ length: a.steps }, () => STEP_S))
    expect(even.steps).toBe(a.steps)
    expect(a.shots).toBe(even.shots)
    // 4 a second: one at the first step, then one each 15 steps.
    expect(a.shots).toBe(Math.floor((a.steps - 1) / 15) + 1)
  })

  it('a rate that does not divide 60 never drifts: 1.4 a second for 100 s', () => {
    const d = straight(PULSE, { rate: 1.4, heat: { perShot: 0, coolPerS: 1, overheatAt: 100, lockS: 1 } })
    const g = rig(d)
    let n = 0
    for (let i = 0; i < 6000; i++) { g.step({ fire: true }); n += shots(g.events) }
    // Steps 0 to 5999 span 99.983 s: one at 0, then floor(99.983 x 1.4) more.
    expect(n).toBe(140)
  })

  it('range limit: the PULSE RIFLE reaches 40, so a drone at 39 is hit, one at 41 is not', () => {
    const t = (z: number): Target => ({ id: 1, pos: [0, 0, -z], radius: 0.5, hp: 1 })
    const near = rig(straight(PULSE), [t(39)])
    near.step({ fire: true })
    expect(near.hits.length).toBe(1)
    const far = rig(straight(PULSE), [t(41)])
    far.step({ fire: true })
    expect(far.hits.length).toBe(0)
    const ev = far.events.find((e) => e.type === 'shot')!
    expect(ev.type === 'shot' && ev.end[2]).toBeCloseTo(-40, 9)
  })

  it('a solid stops a shot before the drone behind it', () => {
    const s = boxes([[-5, -5, -20], [5, 5, -19]])
    const g = rig(straight(PULSE), [{ id: 1, pos: [0, 0, -30], radius: 0.5, hp: 1 }], s)
    g.step({ fire: true })
    expect(g.hits.length).toBe(0)
  })

  it('spread: a seeded cone, every pellet inside the half-angle, uniform over the cap, the same for the same seed', () => {
    const run = (seed: number): Vec3[] => { const r = makeRng(seed); return Array.from({ length: 20000 }, () => coneSample([0, 0, -1], 6, r)) }
    const a = run(5), b = run(5)
    expect(a).toEqual(b)
    const angles = a.map((d) => Math.acos(Math.min(1, -d[2])) * (180 / Math.PI))
    expect(Math.max(...angles)).toBeLessThanOrEqual(6 + 1e-9)
    // Uniform over a small cap: the mean angle is two thirds of the half-angle, and the sides balance.
    const mean = angles.reduce((x, y) => x + y, 0) / angles.length
    expect(mean).toBeGreaterThan(3.9)
    expect(mean).toBeLessThan(4.1)
    expect(Math.abs(a.reduce((x, d) => x + d[0], 0) / a.length)).toBeLessThan(0.002)
    expect(Math.abs(a.reduce((x, d) => x + d[1], 0) / a.length)).toBeLessThan(0.002)
    for (const d of a.slice(0, 50)) expect(Math.hypot(...d)).toBeCloseTo(1, 12)
  })

  it('pellets: one ARC SCATTER pull is 8 pellets of 0.5, all on a big drone up close', () => {
    const g = rig(defs, [{ id: 1, pos: [0, 0, -4], radius: 1.3, hp: 7 }])
    g.step({ select: SCATTER })
    for (let i = 0; i < 30; i++) g.step()
    g.step({ fire: true })
    expect(shots(g.events)).toBe(8)
    expect(g.hits.length).toBe(8)
    expect(g.hits.reduce((x, h) => x + h.damage, 0)).toBeCloseTo(4, 9)
  })

  it('falloff: full to start, straight down to minFactor at end, minFactor beyond', () => {
    const f = defs[PULSE].falloff!
    expect(falloffAt(f, 10)).toBe(1)
    expect(falloffAt(f, 25)).toBe(1)
    expect(falloffAt(f, 32.5)).toBeCloseTo(0.75, 12)
    expect(falloffAt(f, 40)).toBe(0.5)
    expect(falloffAt(f, 99)).toBe(0.5)
    const g = rig(straight(PULSE), [{ id: 1, pos: [0, 0, -33], radius: 0.5, hp: 1 }])
    g.step({ fire: true })
    expect(g.hits[0].damage).toBeCloseTo(0.75, 9)
  })

  it('heat: PULSE RIFLE overheats on its 12th shot of a held trigger (2.75 s), locks 1.6 s, then fires again', () => {
    const g = rig()
    let n = 0, at = -1
    for (let i = 0; i < 60 * 25 && at < 0; i++) {
      g.step({ fire: true })
      n += shots(g.events)
      if (g.events.some((e) => e.type === 'overheated')) at = i
    }
    // Heat after n shots 0.25 s apart: 13 + (13 - 18 * 0.25) * (n - 1) = 13 + 8.5 (n - 1), so past 100 at the 12th, 2.75 s in.
    expect(n).toBe(12)
    expect(at * STEP_S).toBeCloseTo(2.75, 6)
    let locked = 0
    while (shots(g.events) === 0 || locked === 0) { g.step({ fire: true }); if (shots(g.events) === 0) locked++; else break }
    expect(locked * STEP_S).toBeCloseTo(1.6, 1)
    // Cooling while not firing: 18 a second.
    const h = g.a.guns[PULSE].heat
    for (let i = 0; i < 30; i++) g.step()
    expect(g.a.guns[PULSE].heat).toBeCloseTo(Math.max(0, h - 9), 6)
  })

  it('heat: CHARGE RAIL fired as fast as it charges locks out on its 3rd shot', () => {
    const g = rig()
    g.step({ select: RAIL })
    for (let i = 0; i < 40; i++) g.step()
    let pulls = 0, locked = false
    for (let k = 0; k < 6 && !locked; k++) {
      // The quickest shot: the minimum charge (0.25 s), then wait out the cadence.
      for (let i = 0; i < 16; i++) g.step({ fire: true })
      g.step()
      pulls += shots(g.events)
      locked = g.events.some((e) => e.type === 'overheated')
      while (g.a.guns[RAIL].cool > 0) g.step()
    }
    // 50 a shot, cooling 20 a second over a 0.92 s cycle: 50, 81.7, then past 100.
    expect(pulls).toBe(3)
    expect(locked).toBe(true)
  })

  it('ammo: ARC SCATTER empties its 6 in 6 presses, reloads for 1.6 s by itself, and a reload press refills a part mag', () => {
    const g = rig()
    g.step({ select: SCATTER })
    for (let i = 0; i < 30; i++) g.step()
    let n = 0
    for (let k = 0; k < 6; k++) {
      g.step({ fire: true })
      n += shots(g.events) > 0 ? 1 : 0
      for (let i = 0; i < 49; i++) g.step()
    }
    expect(n).toBe(6)
    expect(g.a.guns[SCATTER].mag).toBe(0)
    expect(g.a.guns[SCATTER].reload).toBeGreaterThan(0)
    // A press while reloading does nothing.
    g.step({ fire: true })
    expect(shots(g.events)).toBe(0)
    let steps = 50
    while (g.a.guns[SCATTER].reload > 0) { g.step(); steps++ }
    expect(steps).toBe(96)
    expect(g.events.some((e) => e.type === 'reloaded')).toBe(true)
    expect(g.a.guns[SCATTER].mag).toBe(6)
    g.step({ fire: true })
    expect(shots(g.events)).toBe(8)
    for (let i = 0; i < 50; i++) g.step()
    g.step({ reload: true })
    expect(g.events.some((e) => e.type === 'reload-started')).toBe(true)
    for (let i = 0; i < 100; i++) g.step()
    expect(g.a.guns[SCATTER].mag).toBe(6)
  })

  it('charge: under 0.25 s fizzles; 0.25 s is damage 1, 0.55 s is 2.2, a full second or more is 4', () => {
    const dmg = (holdSteps: number): number | null => {
      const g = rig(defs, [{ id: 1, pos: [0, 0, -30], radius: 0.8, hp: 99 }])
      g.step({ select: RAIL })
      for (let i = 0; i < 40; i++) g.step()
      for (let i = 0; i < holdSteps; i++) g.step({ fire: true })
      g.step()
      if (g.events.some((e) => e.type === 'charge-fizzled')) return null
      return g.hits.length ? g.hits[0].damage : -1
    }
    // The charge counts from the step after the press: holding n steps charges (n - 1) / 60 s.
    expect(dmg(10)).toBeNull()
    expect(dmg(16)).toBeCloseTo(1, 9)
    expect(dmg(34)).toBeCloseTo(2.2, 9)
    expect(dmg(61)).toBeCloseTo(4, 9)
    expect(dmg(200)).toBeCloseTo(4, 9)
  })

  it('pierce: CHARGE RAIL passes through 2 drones and stops in the third; PULSE RIFLE stops in the first', () => {
    const line = (): Target[] => [10, 20, 30, 40].map((z, i) => ({ id: i + 1, pos: [0, 0, -z], radius: 0.8, hp: 9 }))
    const g = rig(defs, line())
    g.step({ select: RAIL })
    for (let i = 0; i < 40; i++) g.step()
    for (let i = 0; i < 30; i++) g.step({ fire: true })
    g.step()
    expect(g.hits.map((h) => h.target)).toEqual([1, 2, 3])
    const ev = g.events.find((e) => e.type === 'shot')!
    expect(ev.type === 'shot' && ev.end[2]).toBeCloseTo(-30 + 0.8, 9)
    const p = rig(straight(PULSE), line())
    p.step({ fire: true })
    expect(p.hits.map((h) => h.target)).toEqual([1])
  })

  it('switching: the new gun is ready after its readyS, not before', () => {
    const g = rig()
    g.step({ select: SCATTER, fire: true })
    expect(g.events.some((e) => e.type === 'weapon-switched')).toBe(true)
    let waited = 0
    while (shots(g.events) === 0) { g.step({ fire: waited % 2 === 0 }); waited++ }
    expect(waited * STEP_S).toBeGreaterThanOrEqual(0.3 - 1e-9)
    expect(waited * STEP_S).toBeLessThan(0.36)
  })

  it('projectile guns fly: the hit comes after the flight time, and a solid stops them', () => {
    const d = straight(PULSE, { fire: 'projectile', projectileSpeed: 30 })
    const g = rig(d, [{ id: 1, pos: [0, 0, -30], radius: 0.5, hp: 9 }])
    g.step({ fire: true })
    expect(g.ctx.projectiles.length).toBe(1)
    let steps = 1
    while (!g.hits.length && steps < 200) { g.step(); steps++ }
    // 29.5 gibsons at 30 a second: about 59 steps.
    expect(steps).toBeGreaterThan(55)
    expect(steps).toBeLessThan(62)
    const w = rig(d, [{ id: 1, pos: [0, 0, -30], radius: 0.5, hp: 9 }], boxes([[-5, -5, -20], [5, 5, -19]]))
    w.step({ fire: true })
    for (let i = 0; i < 120; i++) w.step()
    expect(w.hits.length).toBe(0)
    expect(w.ctx.projectiles.length).toBe(0)
  })
})

