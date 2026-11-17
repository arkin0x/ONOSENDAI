/**
 * droneSpeed.test.ts - how long each drone of the base variant takes from
 * 30 gibsons off to reach the player: the time the player has to shoot it
 * down. The owner's target: about 2 s or more for a scout and a swarmer at
 * that mid range when standing, and about 1.6 s or more when running at the
 * drone at full fluid speed (the case the owner feels: the two closing
 * speeds add); a sniper's bolt slow enough to step out of; a heavy slow.
 *
 * Two ways in: a drone that spawns 30 off (alerted, from rest), and one that
 * spawns 60 off and is timed from the moment it comes within 30 of the eye,
 * already at cruising speed.
 *
 * Standing, the clock stops at the first hit. Running, a dive locked on
 * where the chest was can miss, so it stops at the first hit or the first
 * step the drone is within reach of the chest (its radius + 1.5), whichever
 * comes first: the drone has arrived either way.
 *
 * The thresholds sit between the old speeds (scout speed 13, accel 30, dive
 * x1.5; swarmer speed 10, accel 25) and the new ones, so putting the old
 * numbers back fails this file. Measured: standing, scout 2.13 s old and
 * 2.72 s new, swarmer 3.02 s and 4.28 s; running, scout 1.28 s and 1.65 s,
 * swarmer 1.50 s and 1.78 s.
 */

import { describe, expect, it } from 'vitest'
import { makeDrone, stepDrones, stepDroneShots, type DroneContext, type PlayerTarget } from '../drones'
import { regionBounds } from '../player'
import { FLUID_MAX_SPEED } from '../fluid'
import { makeRng } from '../rng'
import { STEP_S } from '../run'
import type { RunEvent } from '../events'
import type { DroneDef, Vec3 } from '../../types'
import { GROUND, boxes, variant } from './helpers'

const field = boxes(GROUND)
const enemies = variant().spec.enemies
const idx = (list: readonly DroneDef[], id: string): number => list.findIndex((e) => e.id === id)

/** The base variant's drones with the scout and swarmer put back to their old speeds. */
function oldSpeeds(): DroneDef[] {
  const list = variant().spec.enemies
  const scout = list[idx(list, 'scout')], swarmer = list[idx(list, 'swarmer')]
  scout.speed = 13; scout.accel = 30; scout.dive = { ...scout.dive, speedFactor: 1.5 }
  swarmer.speed = 10; swarmer.accel = 25
  return list
}

/**
 * Seconds from the drone being within 30 of the eye (it sees from 55) to its
 * arrival (see the header); -1 if none in 20 s. `run` is the player's pace
 * toward the drone, level, gibsons a second (0 stands).
 */
function contactTime(list: DroneDef[], id: string, from: number, seed: number, angle: number, run = 0): number {
  const p: PlayerTarget = { feet: [128, 64, 128], eye: [128, 65.75, 128], height: 2, radius: 0.35 }
  const events: RunEvent[] = []
  const ctx: DroneContext = { defs: list, solids: field, bounds: regionBounds(), player: p, rng: makeRng(seed), dt: STEP_S, events, playerHits: [], shots: [], ids: { next: 100 } }
  const def = list[idx(list, id)]
  const at: Vec3 = [128 + Math.sin(angle) * from, 64 + (def.altitude.min + def.altitude.max) / 2, 128 + Math.cos(angle) * from]
  const d = makeDrone(1, list, idx(list, id), at, p.eye, ctx.rng)
  let inside = -1
  let dx = Math.sin(angle), dz = Math.cos(angle)
  for (let i = 1; i <= 60 * 20; i++) {
    events.length = 0
    if (run > 0) {
      // Straight at the drone, level; right under it, the way it was going.
      const hx = d.pos[0] - p.feet[0], hz = d.pos[2] - p.feet[2], h = Math.hypot(hx, hz)
      if (h > 1) { dx = hx / h; dz = hz / h }
      for (const q of [p.feet, p.eye]) { q[0] += dx * run * STEP_S; q[2] += dz * run * STEP_S }
    }
    stepDrones([d], ctx)
    stepDroneShots(ctx)
    if (inside < 0 && Math.hypot(d.pos[0] - p.eye[0], d.pos[1] - p.eye[1], d.pos[2] - p.eye[2]) <= 30 + 1e-9) inside = from <= 30 ? 0 : i
    const arrived = run > 0 && Math.hypot(d.pos[0] - p.feet[0], d.pos[1] - (p.feet[1] + 1.2), d.pos[2] - p.feet[2]) <= def.radius + 1.5
    if (ctx.playerHits.length || arrived) return (i - inside) * STEP_S
  }
  return -1
}

/** The shortest time over a few seeds and directions, from 30 and from 60. */
function shortest(id: string, run = 0, list: DroneDef[] = enemies): number {
  let min = Infinity
  for (const from of [30, 60]) for (const seed of [1, 2, 3]) for (const angle of [0, 2.1, 4.2]) {
    const t = contactTime(list, id, from, seed, angle, run)
    min = Math.min(min, t < 0 ? Infinity : t)
  }
  // At least one way in arrives (a drone that never reaches the player would pass every bound).
  expect(min).toBeLessThan(Infinity)
  return min
}

describe('drone speed: time to reach the player from mid range (30 gibsons)', () => {
  it('a scout, standing: at least 2.5 s to its dive landing (the old speeds gave 2.13 s)', () => {
    expect(shortest('scout')).toBeGreaterThanOrEqual(2.5)
    expect(shortest('scout', 0, oldSpeeds())).toBeLessThan(2.5)
  })

  it('a swarmer, standing: at least 3.5 s to contact (the old speeds gave 3.02 s)', () => {
    expect(shortest('swarmer')).toBeGreaterThanOrEqual(3.5)
    expect(shortest('swarmer', 0, oldSpeeds())).toBeLessThan(3.5)
  })

  it('running at it at full fluid speed: a scout and a swarmer each take at least 1.6 s to arrive (the old speeds gave 1.28 s and 1.50 s)', () => {
    expect(shortest('scout', FLUID_MAX_SPEED)).toBeGreaterThanOrEqual(1.6)
    expect(shortest('swarmer', FLUID_MAX_SPEED)).toBeGreaterThanOrEqual(1.6)
    expect(shortest('scout', FLUID_MAX_SPEED, oldSpeeds())).toBeLessThan(1.6)
    expect(shortest('swarmer', FLUID_MAX_SPEED, oldSpeeds())).toBeLessThan(1.6)
  })

  it('a sniper\'s bolt is slow enough to step out of: over 1.5 s of flight from 30, after its windup', () => {
    const s = enemies[idx(enemies, 'sniper')]
    expect(30 / s.attack.shot!.speed).toBeGreaterThan(1.5)
    expect(shortest('sniper')).toBeGreaterThanOrEqual(2.0)
  })

  it('a heavy stays slow: under half the player\'s pace, at least 2 s to its first hit', () => {
    expect(enemies[idx(enemies, 'heavy')].speed).toBeLessThan(FLUID_MAX_SPEED / 2)
    expect(shortest('heavy')).toBeGreaterThanOrEqual(2.0)
  })
})
