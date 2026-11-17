/**
 * aim.test.ts - aimed shots (RunInput.aim, WeaponDef.assist): an aimed
 * shot goes exactly along its aim with no spread, so it hits where a spread
 * shot can miss; it takes the same random draws as an unaimed one; it is
 * ignored on a step with no shot and by a gun without assist; and a log that
 * carries aims replays exactly.
 */

import { describe, expect, it } from 'vitest'
import { makeArsenal, stepGuns, stepProjectiles, type DamageHit, type GunContext, type Projectile, type Target } from '../weapons'
import { makeRng, next } from '../rng'
import { buildSolids } from '../solids'
import { aimDir, createRun, stepRun, STEP_S, type RunState } from '../run'
import { stateHash } from '../hash'
import { lookDir } from '../fluid'
import type { RunEvent } from '../events'
import type { DroneRunVariant, RunInput, Vec3, WeaponDef } from '../../types'
import { GROUND, boxes, input, testLevel, variant } from './helpers'

const defs = variant().spec.weapons
const PULSE = 0, SCATTER = 1, RAIL = 2
const empty = buildSolids([])

/** A gun rig at the origin looking along -Z, with `targets`; `aim` is the step's aimed direction (or none). */
function rig(targets: Target[], seed = 7, d: WeaponDef[] = defs) {
  const a = makeArsenal(d)
  const events: RunEvent[] = []
  const hits: DamageHit[] = []
  const projectiles: Projectile[] = []
  const ctx: GunContext = { defs: d, solids: empty, targets, rng: makeRng(seed), eye: [0, 0, 0], dir: [0, 0, -1], aim: null, dt: STEP_S, events, hits, projectiles, ids: { next: 1 } }
  const step = (fire: boolean, aim: Vec3 | null = null, select: number | null = null): void => {
    events.length = 0
    ctx.aim = aim
    stepGuns(a, { fire, select, reload: false }, ctx)
    stepProjectiles(ctx)
  }
  return { a, ctx, events, hits, step }
}

/** The aim (yaw, pitch) from the origin at `p`, and its direction as the run rebuilds it. */
function aimAt(p: Vec3): { yaw: number; pitch: number; dir: Vec3 } {
  const len = Math.hypot(p[0], p[1], p[2])
  const yaw = Math.atan2(p[0], -p[2]), pitch = Math.asin(p[1] / len)
  return { yaw, pitch, dir: lookDir(yaw, pitch) }
}

describe('aimed shots', () => {
  it('the PULSE RIFLE carries assist "auto" in the base variant; the other guns do not', () => {
    expect(defs[PULSE].assist).toBe('auto')
    expect(defs[SCATTER].assist).toBeUndefined()
    expect(defs[RAIL].assist).toBeUndefined()
  })

  it('an aimed hitscan shot hits a small drone at range that spread shots miss some of the time', () => {
    // A swarmer-sized sphere 58 out (the rifle's range stretched to 60 and its heat off for this): the 0.4 degree cone reaches 0.4 off the line there, past its 0.3 radius.
    const long = defs.map((d, k) => (k === PULSE ? { ...d, range: 60, heat: { ...d.heat!, perShot: 0 } } : d))
    const tg: Target = { id: 1, pos: [0, 0, -58], radius: 0.3, hp: 1e9 }
    const plain = rig([tg], 7, long)
    const aimed = rig([tg], 7, long)
    const dir = aimAt(tg.pos).dir
    let plainShots = 0, aimedShots = 0
    for (let i = 0; i < 60 * 20; i++) {
      plain.step(true)
      plainShots += plain.events.filter((e) => e.type === 'shot').length
      aimed.step(true, dir)
      aimedShots += aimed.events.filter((e) => e.type === 'shot').length
    }
    expect(aimedShots).toBe(plainShots)
    expect(aimedShots).toBeGreaterThan(40)
    expect(aimed.hits.length).toBe(aimedShots)
    expect(plain.hits.length).toBeLessThan(plainShots)
  })

  it('an aimed shot goes where it is aimed, not along the look: a drone well off the reticle is hit', () => {
    const tg: Target = { id: 1, pos: [12, 4, -30], radius: 0.5, hp: 1e9 }
    const g = rig([tg])
    g.step(true)
    expect(g.hits.length).toBe(0)
    const h = rig([tg])
    h.step(true, aimAt(tg.pos).dir)
    expect(h.hits.length).toBe(1)
    const shot = h.events.find((e) => e.type === 'shot')
    expect(shot && shot.type === 'shot' && shot.dir).toEqual(aimAt(tg.pos).dir)
  })

  it('an aimed shot takes the same random draws as an unaimed one: the guns\' stream does not depend on aiming', () => {
    const a = rig([]), b = rig([])
    for (let i = 0; i < 600; i++) { a.step(i % 50 < 30); b.step(i % 50 < 30, i % 3 ? lookDir(0.3, 0.1) : null) }
    expect(a.a.pulls).toBe(b.a.pulls)
    expect(a.a.pulls).toBeGreaterThan(20)
    expect(a.ctx.rng.s).toBe(b.ctx.rng.s)
  })

  it('a gun without assist ignores the aim: ARC SCATTER and CHARGE RAIL fire along the look with their spread', () => {
    for (const w of [SCATTER, RAIL]) {
      const tg: Target = { id: 1, pos: [12, 4, -15], radius: 0.5, hp: 1e9 }
      const g = rig([tg])
      g.step(false, null, w)
      for (let i = 0; i < 40; i++) g.step(false)
      const dir = aimAt(tg.pos).dir
      // Fire (the rail charges, then fires on release), aiming at the drone all along.
      const shots: Vec3[] = []
      const fire = (on: boolean): void => { g.step(on, dir); for (const e of g.events) if (e.type === 'shot') shots.push(e.dir) }
      for (let i = 0; i < 45; i++) fire(true)
      fire(false)
      expect(shots.length).toBeGreaterThan(0)
      // Every pellet inside the gun's own cone round the look (-Z).
      const cosMax = Math.cos((Math.max(defs[w].spread, 1e-6) * Math.PI) / 180)
      for (const d of shots) expect(-d[2]).toBeGreaterThanOrEqual(cosMax - 1e-12)
      expect(g.hits.length).toBe(0)
    }
  })

  it('the run turns RunInput.aim into the shot direction, and ignores a missing or broken one', () => {
    expect(aimDir(input())).toBeNull()
    expect(aimDir(input({ aim: { yaw: NaN, pitch: 0 } }))).toBeNull()
    expect(aimDir(input({ aim: { yaw: 0.5, pitch: -0.2 } }))).toEqual(lookDir(0.5, -0.2))
  })

  it('a variant may give assist only as "auto", and only to a hitscan gun whose mode is auto', () => {
    const lv = testLevel(), field = boxes(GROUND)
    const bad1 = variant()
    ;(bad1.spec.weapons[0] as { assist?: string }).assist = 'always'
    expect(() => createRun(bad1, field, { level: lv })).toThrow(/assist/)
    const bad2 = variant()
    bad2.spec.weapons[0] = { ...bad2.spec.weapons[0], fire: 'projectile', projectileSpeed: 80 }
    expect(() => createRun(bad2, field, { level: lv })).toThrow(/assist/)
    // A semi gun latches; a charge gun never releases while the assist holds the trigger.
    for (const mode of ['semi', 'charge'] as const) {
      const bad = variant()
      bad.spec.weapons[0] = { ...bad.spec.weapons[0], mode, charge: { minS: 0.2, maxS: 1, damageMax: 3, rangeMax: 80 } }
      expect(() => createRun(bad, field, { level: lv })).toThrow(/assist must be "auto", on a hitscan gun whose mode is "auto"/)
    }
    // The base variant (an auto hitscan gun) is fine.
    expect(() => createRun(variant(), field, { level: lv })).not.toThrow()
  })
})

describe('aims in the input log', () => {
  const field = boxes(GROUND, [[110, 63.5, 150], [120, 72, 152]])

  /** Runs out of the start zone, then stands and turns, firing in bursts; `aimed` adds an aim on some steps. */
  function log(n: number, aimed: (i: number) => RunInput['aim']): RunInput[] {
    const out: RunInput[] = []
    for (let i = 0; i < n; i++) {
      const inp = input({ move: { fwd: i < 150 ? 1 : 0, strafe: i > 300 && i < 360 ? 1 : 0 }, yaw: Math.sin(i / 80) * 0.5, pitch: 0.2, fire: i % 60 < 35, select: i === 500 ? 1 : i === 560 ? 0 : null })
      const a = aimed(i)
      if (a) inp.aim = a
      out.push(inp)
    }
    return out
  }

  function play(v: DroneRunVariant, inputs: RunInput[], seed = 5): RunState {
    const st = createRun(v, field, { level: testLevel(), seed, wave: 2 })
    for (const inp of inputs) stepRun(st, inp)
    return st
  }

  it('an aim on a step that fires no shot changes nothing', () => {
    const plain = log(900, () => undefined)
    const st = play(variant(), plain)
    // The same log with an aim on every step whose trigger is up.
    const withAim = log(900, (i) => (i % 60 < 35 ? undefined : { yaw: 1.1, pitch: 0.4 }))
    expect(stateHash(play(variant(), withAim))).toBe(stateHash(st))
  })

  it('an aim while ARC SCATTER is in hand changes nothing', () => {
    const v = variant()
    const steps = 900
    const scatterLog = (aim: boolean): RunInput[] => log(steps, () => undefined).map((inp, i) => ({ ...inp, select: i === 0 ? SCATTER : null, ...(aim ? { aim: { yaw: -0.7, pitch: 0.3 } } : {}) }))
    expect(stateHash(play(v, scatterLog(true)))).toBe(stateHash(play(v, scatterLog(false))))
  })

  it('aims at the drones change the run (a missed shot leaves no trace, a hit does), and a recorded log with aims replays to the same hash', () => {
    // Played live: every other step aims at the nearest drone from the eye.
    const base = log(1800, () => undefined)
    const live = createRun(variant(), field, { level: testLevel(), seed: 5, wave: 2 })
    const recorded: RunInput[] = []
    for (const b of base) {
      const inp: RunInput = { ...b, move: { ...b.move } }
      const eye: Vec3 = [live.body.pos[0], live.body.pos[1] + 1.75, live.body.pos[2]]
      const near = [...live.drones].sort((p, q) => Math.hypot(p.pos[0] - eye[0], p.pos[1] - eye[1], p.pos[2] - eye[2]) - Math.hypot(q.pos[0] - eye[0], q.pos[1] - eye[1], q.pos[2] - eye[2]))[0]
      if (near && live.step % 2 === 0) {
        const dx = near.pos[0] - eye[0], dy = near.pos[1] - eye[1], dz = near.pos[2] - eye[2]
        inp.aim = { yaw: Math.atan2(dx, -dz), pitch: Math.asin(dy / Math.hypot(dx, dy, dz)) }
      }
      recorded.push(inp)
      stepRun(live, inp)
    }
    const unaimed = play(variant(), base)
    expect(stateHash(live)).not.toBe(stateHash(unaimed))
    const read = JSON.parse(JSON.stringify(recorded)) as RunInput[]
    expect(read.filter((x) => x.aim).length).toBeGreaterThan(50)
    const replay = play(variant(), read)
    expect(stateHash(replay)).toBe(stateHash(live))
    expect(replay.kills).toEqual(live.kills)
  })
})

describe('the assist roll (WeaponDef.assistHit, assistMissBy)', () => {
  /** A rig whose aimed pulls roll on their own assist stream, as the run's do. */
  function rolled(targets: Target[], seed = 7, d: WeaponDef[] = defs) {
    const g = rig(targets, seed, d)
    g.ctx.assistRng = makeRng(seed ^ 0x5a5a)
    return g
  }

  it('the base PULSE RIFLE hits with 85% of its aimed pulls and misses by 1 gibson beyond the drone', () => {
    expect(defs[PULSE].assistHit).toBe(0.85)
    expect(defs[PULSE].assistMissBy).toBe(1)
  })

  it('about 85% of aimed pulls hit; every wide one clears the drone by assistMissBy and hits nothing', () => {
    const tg: Target = { id: 1, pos: [3, 2, -25], radius: 0.5, hp: 1e9 }
    const g = rolled([tg])
    const aim = aimAt(tg.pos).dir
    let shots = 0, wide = 0, hitShots = 0
    for (let i = 0; i < 60 * 600 && shots < 2000; i++) {
      const before = g.hits.length
      g.step(true, aim)
      // The heat lock would stop a held trigger: cool it, the roll is what is measured here.
      g.a.guns[PULSE].heat = 0
      for (const e of g.events) {
        if (e.type !== 'shot') continue
        shots++
        if (e.wide) {
          wide++
          // The closest pass of the wide line to the drone's centre is radius + assistMissBy.
          const c = tg.pos, d = e.dir
          const t = c[0] * d[0] + c[1] * d[1] + c[2] * d[2]
          const pass = Math.hypot(c[0] - d[0] * t, c[1] - d[1] * t, c[2] - d[2] * t)
          expect(pass).toBeCloseTo(0.5 + 1, 9)
        }
      }
      const hit = g.hits.length - before
      if (hit) hitShots++
      if (g.events.some((e) => e.type === 'shot' && e.wide)) expect(hit).toBe(0)
    }
    expect(shots).toBe(2000)
    expect(hitShots).toBe(shots - wide)
    // 85% within a few points (2000 pulls: one standard deviation is 0.8 points).
    expect(hitShots / shots).toBeGreaterThan(0.82)
    expect(hitShots / shots).toBeLessThan(0.88)
  })

  it('the roll draws from the assist stream only: the guns\' stream is the same as without it', () => {
    const tg: Target = { id: 1, pos: [0, 0, -20], radius: 0.5, hp: 1e9 }
    const plain = rig([tg]), withRoll = rolled([tg])
    const aim = aimAt(tg.pos).dir
    for (let i = 0; i < 600; i++) { plain.step(i % 50 < 30, aim); withRoll.step(i % 50 < 30, aim) }
    expect(withRoll.a.pulls).toBe(plain.a.pulls)
    expect(withRoll.ctx.rng.s).toBe(plain.ctx.rng.s)
    // Two draws an aimed pull.
    const r = makeRng(7 ^ 0x5a5a)
    for (let k = 0; k < plain.a.pulls * 2; k++) next(r)
    expect(withRoll.ctx.assistRng!.s).toBe(r.s)
  })

  it('assistHit 1 never goes wide and 0 always does; an unaimed pull never rolls', () => {
    const tg: Target = { id: 1, pos: [0, 0, -20], radius: 0.5, hp: 1e9 }
    const aim = aimAt(tg.pos).dir
    for (const [hit, wideAll] of [[1, false], [0, true]] as const) {
      const g = rolled([tg], 7, defs.map((d, k) => (k === PULSE ? { ...d, assistHit: hit } : d)))
      for (let i = 0; i < 120; i++) {
        g.step(true, aim)
        for (const e of g.events) if (e.type === 'shot') expect(!!e.wide).toBe(wideAll)
      }
    }
    const g = rolled([tg])
    const s0 = g.ctx.assistRng!.s
    for (let i = 0; i < 120; i++) g.step(true)
    expect(g.a.pulls).toBeGreaterThan(5)
    expect(g.ctx.assistRng!.s).toBe(s0)
  })

  it('a variant may set assistHit (0 to 1) and assistMissBy (0 or more) only on an assist gun', () => {
    const lv = testLevel(), field = boxes(GROUND)
    const bad1 = variant(); bad1.spec.weapons[0].assistHit = 1.5
    expect(() => createRun(bad1, field, { level: lv })).toThrow(/assistHit/)
    const bad2 = variant(); bad2.spec.weapons[0].assistMissBy = -1
    expect(() => createRun(bad2, field, { level: lv })).toThrow(/assistMissBy/)
    const bad3 = variant(); bad3.spec.weapons[1].assistHit = 0.5
    expect(() => createRun(bad3, field, { level: lv })).toThrow(/need assist/)
  })
})

describe('the assist roll in a run', () => {
  const field = boxes(GROUND)

  it('a run without aims never draws from the assist stream, so its other streams are what they always were', () => {
    const st = createRun(variant(), field, { level: testLevel(), seed: 5, wave: 2 })
    const a0 = st.rng.assist.s
    for (let i = 0; i < 60 * 20; i++) stepRun(st, input({ move: { fwd: i < 200 ? 1 : 0, strafe: 0 }, yaw: Math.sin(i / 80) * 0.5, pitch: 0.2, fire: i % 60 < 35 }))
    expect(st.arsenal.pulls).toBeGreaterThan(20)
    expect(st.rng.assist.s).toBe(a0)
  })

  it('a replayed log goes wide on exactly the same shots', () => {
    const play = (inputs: RunInput[] | null) => {
      const st = createRun(variant(), field, { level: testLevel(), seed: 5, wave: 2 })
      const log: RunInput[] = []
      const wideAt: number[] = []
      const n = inputs ? inputs.length : 60 * 30
      for (let i = 0; i < n && (st.phase === 'safe' || st.phase === 'wave'); i++) {
        let inp: RunInput
        if (inputs) inp = inputs[i]
        else {
          inp = input({ move: { fwd: i < 150 ? 1 : 0, strafe: 0 }, pitch: 0.2 })
          const eye: Vec3 = [st.body.pos[0], st.body.pos[1] + 1.75, st.body.pos[2]]
          const near = st.drones[0]
          if (near) {
            const dx = near.pos[0] - eye[0], dy = near.pos[1] - eye[1], dz = near.pos[2] - eye[2]
            inp.aim = { yaw: Math.atan2(dx, -dz), pitch: Math.asin(dy / Math.hypot(dx, dy, dz)) }
            inp.fire = true
          }
        }
        log.push(JSON.parse(JSON.stringify(inp)) as RunInput)
        stepRun(st, inp)
        if (st.events.some((e) => e.type === 'shot' && e.wide)) wideAt.push(st.step)
      }
      return { st, log, wideAt }
    }
    const live = play(null)
    expect(live.wideAt.length).toBeGreaterThan(2)
    const again = play(live.log)
    expect(again.wideAt).toEqual(live.wideAt)
    expect(stateHash(again.st)).toBe(stateHash(live.st))
  })
})
