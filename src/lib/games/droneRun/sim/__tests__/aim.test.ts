/**
 * aim.test.ts - aimed shots (RunInput.aim, WeaponDef.assist): an aimed
 * shot goes exactly along its aim with no spread, so it hits where a spread
 * shot can miss; it takes the same random draws as an unaimed one; it is
 * ignored on a step with no shot and by a gun without assist; and a log that
 * carries aims replays exactly.
 */

import { describe, expect, it } from 'vitest'
import { makeArsenal, stepGuns, stepProjectiles, type DamageHit, type GunContext, type Projectile, type Target } from '../weapons'
import { makeRng } from '../rng'
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
    // A swarmer-sized sphere 58 out: the 0.4 degree cone reaches 0.4 off the line there, past its 0.3 radius.
    const tg: Target = { id: 1, pos: [0, 0, -58], radius: 0.3, hp: 1e9 }
    const plain = rig([tg])
    const aimed = rig([tg])
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
    const tg: Target = { id: 1, pos: [12, 4, -40], radius: 0.5, hp: 1e9 }
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
