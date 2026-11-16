/**
 * drones.test.ts - the enemy drones (sim/drones.ts): steering (seek
 * converges, standoff holds its band, dive commits), line of sight (lost
 * behind a wall, regained, limited by range, given up after loseAfterS),
 * projectiles that stop at solids and can be dodged, and collision with a
 * plumb wall authored as a shard, holding over many seeds.
 */

import { describe, expect, it } from 'vitest'
import { canSee, chestOf, closestApproachTime, interceptTime, leadPoint, makeDrone, moveSphere, stepDrones, stepDroneShots, trackDive, type Drone, type DroneContext, type PlayerTarget } from '../drones'
import { regionBounds } from '../player'
import { FLUID_MAX_SPEED } from '../fluid'
import { makeRng, next } from '../rng'
import { buildSolids, groundBelow, segmentCast, sphereHits, type Solids } from '../solids'
import { trianglesFromShards } from '../fromShards'
import { STEP_S } from '../run'
import type { RunEvent } from '../events'
import type { DroneDef, Vec3 } from '../../types'
import { GROUND, boxTris, boxes, plumbWall, variant } from './helpers'

const enemies = variant().spec.enemies
const SCOUT = 0, SNIPER = 1, SWARMER = 3
const bounds = regionBounds()

function player(feet: Vec3): PlayerTarget {
  return { feet: [...feet] as Vec3, eye: [feet[0], feet[1] + 1.75, feet[2]], height: 2, radius: 0.35 }
}

function rig(solids: Solids, p: PlayerTarget, defs: DroneDef[] = enemies, seed = 1) {
  const events: RunEvent[] = []
  const ctx: DroneContext = { defs, solids, bounds, player: p, rng: makeRng(seed), dt: STEP_S, events, playerHits: [], shots: [], ids: { next: 100 } }
  const drones: Drone[] = []
  const add = (def: number, at: Vec3): Drone => { const d = makeDrone(drones.length + 1, defs, def, at, p.eye, ctx.rng); drones.push(d); return d }
  const step = (n = 1, each?: () => void): void => {
    for (let i = 0; i < n; i++) { events.length = 0; stepDrones(drones, ctx); stepDroneShots(ctx); each?.() }
  }
  return { ctx, drones, events, add, step }
}

const flatDist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2])

describe('drone steering', () => {
  const field = boxes(GROUND)

  it('seek converges: a swarmer from 30 away reaches the player and hits by contact', () => {
    const p = player([128, 64, 128])
    const g = rig(field, p)
    g.add(SWARMER, [128, 70, 158])
    let hitAt = -1
    for (let i = 0; i < 300 && hitAt < 0; i++) { g.step(); if (g.ctx.playerHits.length) hitAt = i }
    expect(hitAt).toBeGreaterThan(0)
    // 30 gibsons at 10 a second, with the turn and the climb: well under 5 s.
    expect(hitAt * STEP_S).toBeLessThan(5)
  })

  it('standoff holds its range band: a sniper too close backs off, one too far closes in, and both stay in the band', () => {
    for (const start of [12, 50]) {
      const p = player([128, 64, 128])
      const g = rig(field, p)
      const d = g.add(SNIPER, [128, 78, 128 + start])
      g.step(60 * 12)
      for (let i = 0; i < 60 * 6; i++) {
        g.step()
        const r = flatDist(d.pos, p.feet)
        expect(r).toBeGreaterThan(35 - 4 - 1.5)
        expect(r).toBeLessThan(35 + 4 + 1.5)
      }
    }
  })

  it('dive commits: a scout lines up, commits to the chest where it was, dives straight at it, then pulls up', () => {
    const p = player([128, 64, 128])
    const g = rig(field, p)
    const d = g.add(SCOUT, [128, 74, 150])
    type Dive = Extract<RunEvent, { type: 'drone-dive' }>
    let dive: Dive | null = null
    for (let i = 0; i < 600 && !dive; i++) { g.step(); dive = (g.events.find((e) => e.type === 'drone-dive') as Dive | undefined) ?? null }
    expect(dive).not.toBeNull()
    expect(dive!.target).toEqual([128, 65, 128])
    expect(d.mode).toBe('dive')
    // Heading at the locked point within a few steps.
    g.step(6)
    const to = [d.aim[0] - d.pos[0], d.aim[1] - d.pos[1], d.aim[2] - d.pos[2]]
    const cos = (to[0] * d.vel[0] + to[1] * d.vel[1] + to[2] * d.vel[2]) / (Math.hypot(...to) * Math.hypot(...d.vel))
    expect(cos).toBeGreaterThan(0.95)
    let hit = false
    g.step(120, () => { if (g.ctx.playerHits.length) hit = true })
    expect(hit).toBe(true)
    expect(['pullup', 'hunt']).toContain(d.mode)
  })

  it('a dive can be dodged: a player who steps aside is not hit by that dive', () => {
    const p = player([128, 64, 128])
    const g = rig(field, p)
    g.add(SCOUT, [128, 74, 150])
    let committed = false
    for (let i = 0; i < 600 && !committed; i++) { g.step(); committed = g.events.some((e) => e.type === 'drone-dive') }
    // Step 4 gibsons aside at once (the locked point stays).
    p.feet[0] += 4; p.eye[0] += 4
    let hit = false
    g.step(60, () => { if (g.ctx.playerHits.length) hit = true })
    expect(hit).toBe(false)
  })

  it('drones keep to their altitude band over the ground', () => {
    const p = player([128, 64, 60])
    const g = rig(field, p)
    const d = g.add(SNIPER, [128, 67, 128])
    g.step(60 * 8)
    expect(d.pos[1]).toBeGreaterThanOrEqual(64 + 10 - 0.5)
    expect(d.pos[1]).toBeLessThanOrEqual(64 + 22 + 0.5)
  })
})

describe('line of sight', () => {
  const wall = boxes(GROUND, [[100, 64, 120], [156, 90, 122]])
  const def = enemies[SCOUT]

  it('a drone behind a wall does not see the player; out from behind it, it does', () => {
    const eye: Vec3 = [128, 65.75, 100]
    expect(canSee(wall, def, [128, 70, 140], eye)).toBe(false)
    expect(canSee(wall, def, [128, 105, 124], eye)).toBe(true)
    expect(canSee(wall, def, [90, 70, 123], eye)).toBe(true)
  })

  it('detection is limited by range (the fog limit), with a clear line', () => {
    const eye: Vec3 = [128, 70, 100]
    expect(canSee(wall, def, [128, 70, 100 - 54.9], eye)).toBe(true)
    expect(canSee(wall, def, [128, 70, 100 - 55.1], eye)).toBe(false)
  })

  it('lost behind a wall, it goes to the last known place, then gives up after loseAfterS and patrols; seen again, it is alerted again', () => {
    const p = player([128, 64, 100])
    const g = rig(wall, p)
    // Seen once, from in the open.
    const d = g.add(SCOUT, [90, 74, 123])
    g.step()
    expect(d.sees).toBe(true)
    // The player goes behind the wall, out of reach of sight from where the drone is held.
    p.feet = [128, 64, 140]; p.eye = [128, 65.75, 140]
    const held: Vec3 = [128, 70, 110]
    let lostAt = -1
    for (let i = 0; i < 60 * 6 && lostAt < 0; i++) {
      d.pos = [...held] as Vec3; d.vel = [0, 0, 0]
      g.step()
      if (g.events.some((e) => e.type === 'drone-alert' && !e.seen)) lostAt = i
    }
    expect(lostAt * STEP_S).toBeGreaterThan(def.loseAfterS - 0.1)
    expect(lostAt * STEP_S).toBeLessThan(def.loseAfterS + 0.1)
    expect(d.alerted).toBe(false)
    expect(d.mode).toBe('patrol')
    // Back in sight.
    d.pos = [90, 74, 123]
    p.feet = [128, 64, 100]; p.eye = [128, 65.75, 100]
    g.step()
    expect(d.alerted).toBe(true)
    expect(g.events.some((e) => e.type === 'drone-alert' && e.seen)).toBe(true)
  })
})

describe('drone projectiles', () => {
  it('fly straight, stop at a solid, and can be dodged', () => {
    const solids = boxes(GROUND, [[100, 64, 110], [156, 90, 111]])
    const p = player([128, 64, 100])
    const g = rig(solids, p)
    g.ctx.shots.push({ id: 1, drone: 1, enemy: 'sniper', pos: [128, 70, 130], vel: [0, -0.6, -16], radius: 0.35, travelled: 0, range: 70, damage: 1 })
    g.step(120)
    expect(g.ctx.shots.length).toBe(0)
    expect(g.ctx.playerHits.length).toBe(0)
    // In the open, aimed at the chest: a hit; aimed the same but the player steps aside: a miss.
    const open = boxes(GROUND)
    const h = rig(open, player([128, 64, 100]))
    h.ctx.shots.push({ id: 2, drone: 1, enemy: 'sniper', pos: [128, 65, 130], vel: [0, 0, -16], radius: 0.35, travelled: 0, range: 70, damage: 1 })
    h.step(150)
    expect(h.ctx.playerHits.length).toBe(1)
    const m = rig(open, player([128, 64, 100]))
    m.ctx.shots.push({ id: 3, drone: 1, enemy: 'sniper', pos: [128, 65, 130], vel: [0, 0, -16], radius: 0.35, travelled: 0, range: 70, damage: 1 })
    m.step(30)
    m.ctx.player.feet[0] += 2
    m.step(150)
    expect(m.ctx.playerHits.length).toBe(0)
  })
})

describe('drones never pass through a wall built from shards', () => {
  // Five 16-long plumb walls side by side: a wall 80 long across x 60..140, standing at z 97..104.
  const pieces = [76, 92, 108, 124, 140].map((x) => ({ shard: plumbWall(), at: [x - 8, 64, 100] as Vec3 }))
  const tris = trianglesFromShards(pieces)
  const ground = boxTris(GROUND[0], GROUND[1])
  const solids = buildSolids([...Array.from(tris), ...ground])
  const wallOnly = buildSolids(tris)

  it('pushed straight at it at full tilt from many places and angles, a drone stops or slides, never crosses', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = makeRng(seed)
      const radius = [0.3, 0.5, 0.8, 1.3][seed % 4]
      const pos: Vec3 = [80 + next(r) * 40, 66 + next(r) * 8, 104.5 + radius + next(r) * 4]
      expect(sphereHits(solids, pos, radius)).toBe(false)
      const ang = (next(r) - 0.5) * (Math.PI / 2)
      const speed = 10 + next(r) * 30
      for (let i = 0; i < 90; i++) {
        const vel: Vec3 = [Math.sin(ang) * speed, (next(r) - 0.5) * 4, -Math.cos(ang) * speed]
        const before: Vec3 = [...pos] as Vec3
        moveSphere(solids, bounds, pos, vel, radius, STEP_S)
        expect(segmentCast(wallOnly, before, pos)).toBeNull()
        expect(sphereHits(solids, pos, radius)).toBe(false)
        // Past the wall's middle only by going over its top.
        if (pos[2] <= 100) expect(pos[1] - radius).toBeGreaterThanOrEqual((groundBelow(wallOnly, pos[0], 255, pos[2], 255) ?? -Infinity) - 1e-6)
      }
    }
  })

  it('hunting a player behind it, over many seeds, drones go over or around, never through', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const p = player([100, 64, 80])
      const g = rig(solids, p, enemies, seed)
      const r = makeRng(seed * 31)
      for (const def of [SCOUT, SNIPER, 2, SWARMER]) g.add(def, [80 + next(r) * 40, 68 + next(r) * 6, 106 + next(r) * 6])
      for (let i = 0; i < 60 * 6; i++) {
        const before = g.drones.map((d) => [...d.pos] as Vec3)
        g.step()
        g.drones.forEach((d, k) => {
          expect(segmentCast(wallOnly, before[k], d.pos)).toBeNull()
          expect(sphereHits(solids, d.pos, d.radius)).toBe(false)
        })
      }
    }
  })
})

describe('leading shots (attack.lead) and tracking dives (dive.track)', () => {
  const open = boxes(GROUND)
  const HEAVY = 2

  it('the base variant: the sniper leads fully, the heavy 0.7, both held to 3 s; the scout\'s dive re-aims at 90 degrees a second', () => {
    expect(enemies[SNIPER].attack).toMatchObject({ lead: 1, leadMaxS: 3 })
    expect(enemies[HEAVY].attack).toMatchObject({ lead: 0.7, leadMaxS: 3 })
    expect(enemies[SCOUT].dive?.track).toBe(90)
  })

  it('interceptTime: where a bolt (with its muzzle offset) meets a target moving at constant velocity', () => {
    const from: Vec3 = [10, 20, 5], at: Vec3 = [40, 3, -12], vel: Vec3 = [6, 0, -4]
    const t = interceptTime(from, at, vel, 16, 1.2)!
    expect(t).toBeGreaterThan(0)
    const meet: Vec3 = [at[0] + vel[0] * t, at[1] + vel[1] * t, at[2] + vel[2] * t]
    expect(Math.hypot(meet[0] - from[0], meet[1] - from[1], meet[2] - from[2])).toBeCloseTo(1.2 + 16 * t, 9)
    // Standing still: distance less the offset, over the speed.
    expect(interceptTime(from, at, [0, 0, 0], 16, 1.2)).toBeCloseTo((Math.hypot(30, -17, -17) - 1.2) / 16, 12)
    // A target faster than the bolt running straight away: never.
    expect(interceptTime([0, 0, 0], [0, 0, -10], [0, 0, -20], 16, 0)).toBeNull()
  })

  /** A sniper firing at a player who runs at constant level velocity `vel`; returns whether its first bolt hits. */
  function boltAt(lead: number, vel: Vec3): boolean {
    const defs = enemies.map((e, k) => (k === SNIPER ? { ...e, attack: { ...e.attack, lead } } : e))
    const p: PlayerTarget = { ...player([128, 64, 100]), vel }
    const g = rig(open, p, defs)
    g.add(SNIPER, [128, 78, 135])
    let fired = false, hit = false
    for (let i = 0; i < 60 * 12 && !hit; i++) {
      g.step()
      if (g.events.some((e) => e.type === 'drone-shot')) fired = true
      if (g.ctx.playerHits.length) hit = true
      // The player runs on: feet and eye move with the velocity.
      for (const q of [p.feet, p.eye]) { q[0] += vel[0] * STEP_S; q[2] += vel[2] * STEP_S }
      if (fired && g.ctx.shots.length === 0) break
    }
    expect(fired).toBe(true)
    return hit
  }

  it('lead 1 hits a player running across at constant speed; lead 0 misses them; either hits one standing still', () => {
    const across: Vec3 = [-9, 0, 0]
    expect(boltAt(1, across)).toBe(true)
    expect(boltAt(0, across)).toBe(false)
    expect(boltAt(0, [0, 0, 0])).toBe(true)
    expect(boltAt(1, [0, 0, 0])).toBe(true)
  })

  it('a led bolt is dodged by a change of direction after it is fired', () => {
    const defs = enemies.map((e, k) => (k === SNIPER ? { ...e, attack: { ...e.attack, lead: 1 } } : e))
    const vel: Vec3 = [-9, 0, 0]
    const p: PlayerTarget = { ...player([128, 64, 100]), vel }
    const g = rig(open, p, defs)
    g.add(SNIPER, [128, 78, 135])
    let fired = false, hit = false
    for (let i = 0; i < 60 * 12 && !hit; i++) {
      g.step()
      if (g.events.some((e) => e.type === 'drone-shot')) { fired = true; vel[0] = 9 }
      if (g.ctx.playerHits.length) hit = true
      for (const q of [p.feet, p.eye]) { q[0] += vel[0] * STEP_S; q[2] += vel[2] * STEP_S }
      if (fired && g.ctx.shots.length === 0) break
    }
    expect(fired).toBe(true)
    expect(hit).toBe(false)
  })

  it('with no intercept (the player sprinting across a heavy, faster than its bolt) the shot aims at the closest approach, never 3 s ahead', () => {
    const heavy = enemies[HEAVY]
    const shot = heavy.attack.shot!
    const sprint = FLUID_MAX_SPEED * variant().spec.player.stamina!.speedMul
    expect(sprint).toBeGreaterThan(shot.speed)
    const off = heavy.radius + shot.radius + 0.05
    // Straight across at 30 gibsons: no intercept, and the closest approach is now, so it aims at the chest.
    const p: PlayerTarget = { ...player([128, 64, 128]), vel: [sprint, 0, 0] }
    const chest = chestOf(p)
    const d = makeDrone(1, enemies, HEAVY, [128, 66, 98], p.eye, makeRng(1))
    d.sees = true
    expect(interceptTime(d.pos, chest, [sprint, 0, 0], shot.speed, off)).toBeNull()
    expect(closestApproachTime(d.pos, chest, [sprint, 0, 0])).toBe(0)
    expect(leadPoint(d, heavy, shot, chest, p)).toEqual(chest)
    // Across and a little toward it: still no intercept, so it aims at where the player passes closest, a short way ahead.
    const slant: Vec3 = [sprint, 0, -2]
    const q: PlayerTarget = { ...p, vel: slant }
    expect(interceptTime(d.pos, chest, slant, shot.speed, off)).toBeNull()
    const tc = closestApproachTime(d.pos, chest, slant)
    expect(tc).toBeGreaterThan(0)
    expect(tc).toBeLessThan(0.5)
    const aim = leadPoint(d, heavy, shot, chest, q)
    expect(Math.hypot(aim[0] - chest[0], aim[2] - chest[2])).toBeCloseTo(Math.hypot(sprint, -2) * tc * heavy.attack.lead!, 9)
    // Moving away: 0, aimed at the chest.
    expect(closestApproachTime(d.pos, chest, [0, 0, 20])).toBe(0)
    expect(closestApproachTime(d.pos, chest, [0, 0, 0])).toBe(0)
  })

  it('a heavy firing on a player sprinting across it at 30 gibsons aims its bolts within a few gibsons of them', () => {
    const sprint = FLUID_MAX_SPEED * variant().spec.player.stamina!.speedMul
    const p: PlayerTarget = { ...player([128, 64, 128]), vel: [sprint, 0, 0] }
    const g = rig(open, p)
    g.add(HEAVY, [128, 68, 98])
    const misses: number[] = []
    for (let i = 0; i < 60 * 12 && misses.length < 3; i++) {
      g.step()
      for (const e of g.events) {
        if (e.type !== 'drone-shot') continue
        // How far the bolt's line passes from the chest it was fired at.
        const c = chestOf(p)
        const v = e.vel, vl = Math.hypot(...v)
        const w: Vec3 = [c[0] - e.origin[0], c[1] - e.origin[1], c[2] - e.origin[2]]
        const along = (w[0] * v[0] + w[1] * v[1] + w[2] * v[2]) / vl
        misses.push(Math.sqrt(Math.max(0, w[0] ** 2 + w[1] ** 2 + w[2] ** 2 - along * along)))
      }
    }
    expect(misses.length).toBeGreaterThan(0)
    // The old rule aimed leadMaxS (3 s) ahead: 0.7 x 14.5 x 3, about 30 gibsons off.
    for (const m of misses) expect(m).toBeLessThan(3)
  })

  it('trackDive turns the dive\'s level bearing toward the chest by at most its turn, keeping its descent and distance', () => {
    const d = makeDrone(1, enemies, SCOUT, [0, 10, 0], [0, 0, 0], makeRng(1))
    d.aim = [0, 10, -20]
    const chest: Vec3 = [20, 10, -20]
    const max = (15 * Math.PI) / 180 / 60
    trackDive(d, chest, max)
    const h = [d.aim[0] - d.pos[0], d.aim[1] - d.pos[1], d.aim[2] - d.pos[2]]
    const hl = Math.hypot(...h)
    expect(hl).toBeCloseTo(20, 9)
    expect(h[1]).toBe(0)
    expect(Math.acos(-h[2] / hl)).toBeCloseTo(max, 9)
    // A diving heading keeps its descent: only the bearing turns.
    const f = makeDrone(3, enemies, SCOUT, [0, 10, 0], [0, 0, 0], makeRng(1))
    f.aim = [0, 2, -20]
    trackDive(f, [20, 2, -20], max)
    expect(f.aim[1]).toBe(2)
    expect(Math.hypot(f.aim[0], f.aim[2])).toBeCloseTo(20, 9)
    // Within the turn, it points straight at the chest.
    const e = makeDrone(2, enemies, SCOUT, [0, 10, 0], [0, 0, 0], makeRng(1))
    e.aim = [0, 10, -20]
    trackDive(e, [0.001, 10, -20], max)
    expect(e.aim[0]).toBeCloseTo(0.001, 9)
  })

  it('in a dive, the heading to the locked point never turns faster than dive.track', () => {
    const p: PlayerTarget = { ...player([128, 64, 128]), vel: [7, 0, 0] }
    const g = rig(open, p)
    const d = g.add(SCOUT, [128, 74, 150])
    let prev: Vec3 | null = null, turns = 0, maxStep = 0
    for (let i = 0; i < 60 * 10; i++) {
      g.step()
      for (const q of [p.feet, p.eye]) q[0] += 7 * STEP_S
      if (d.mode !== 'dive') { prev = null; continue }
      const h: Vec3 = [d.aim[0] - d.pos[0], d.aim[1] - d.pos[1], d.aim[2] - d.pos[2]]
      const l = Math.hypot(...h)
      if (prev && l > 0.5) {
        const pl = Math.hypot(...prev)
        const a = Math.acos(Math.max(-1, Math.min(1, (h[0] * prev[0] + h[1] * prev[1] + h[2] * prev[2]) / (l * pl))))
        maxStep = Math.max(maxStep, a)
        turns++
      }
      prev = h
    }
    expect(turns).toBeGreaterThan(10)
    // The drone's own move between steps shifts the heading a little too; the turn itself is at most 90 degrees a second.
    expect(maxStep).toBeGreaterThan(0)
    expect(maxStep).toBeLessThan(((90 * Math.PI) / 180 / 60) * 1.5 + 0.02)
  })

  it('track 0 keeps the dive\'s point locked where the chest was', () => {
    const defs = enemies.map((e, k) => (k === SCOUT ? { ...e, dive: { ...e.dive, track: 0 } } : e))
    const p: PlayerTarget = { ...player([128, 64, 128]), vel: [7, 0, 0] }
    const g = rig(open, p, defs)
    const d = g.add(SCOUT, [128, 74, 150])
    let locked: Vec3 | null = null
    for (let i = 0; i < 60 * 10; i++) {
      g.step()
      for (const q of [p.feet, p.eye]) q[0] += 7 * STEP_S
      if (d.mode === 'dive') { locked ??= [d.aim[0], d.aim[1], d.aim[2]]; expect(d.aim).toEqual(locked) } else if (locked) break
    }
    expect(locked).not.toBeNull()
  })
})
