/**
 * droneSpeed.test.ts - how long each drone of the base variant takes from
 * seeing a standing player 30 gibsons off to its first hit: the time the
 * player has to shoot it down. The owner's target: at least about 2 s for a
 * scout and a swarmer at that mid range; a sniper's bolt slow enough to step
 * out of; a heavy slow.
 *
 * Two ways in: a drone that spawns 30 off (alerted, from rest), and one that
 * spawns 60 off and is timed from the moment it comes within 30 of the eye,
 * already at cruising speed (the case that feels fastest).
 */

import { describe, expect, it } from 'vitest'
import { makeDrone, stepDrones, stepDroneShots, type DroneContext, type PlayerTarget } from '../drones'
import { regionBounds } from '../player'
import { makeRng } from '../rng'
import { STEP_S } from '../run'
import type { RunEvent } from '../events'
import type { Vec3 } from '../../types'
import { GROUND, boxes, variant } from './helpers'

const field = boxes(GROUND)
const enemies = variant().spec.enemies
const idx = (id: string): number => enemies.findIndex((e) => e.id === id)

/** Seconds from the drone being within 30 of the eye (it sees from 55) to its first hit on a standing player; -1 if none in 20 s. */
function contactTime(id: string, from: number, seed: number, angle: number): number {
  const p: PlayerTarget = { feet: [128, 64, 128], eye: [128, 65.75, 128], height: 2, radius: 0.35 }
  const events: RunEvent[] = []
  const ctx: DroneContext = { defs: enemies, solids: field, bounds: regionBounds(), player: p, rng: makeRng(seed), dt: STEP_S, events, playerHits: [], shots: [], ids: { next: 100 } }
  const def = enemies[idx(id)]
  const at: Vec3 = [128 + Math.sin(angle) * from, 64 + (def.altitude.min + def.altitude.max) / 2, 128 + Math.cos(angle) * from]
  const d = makeDrone(1, enemies, idx(id), at, p.eye, ctx.rng)
  let inside = -1
  for (let i = 1; i <= 60 * 20; i++) {
    events.length = 0
    stepDrones([d], ctx)
    stepDroneShots(ctx)
    if (inside < 0 && Math.hypot(d.pos[0] - p.eye[0], d.pos[1] - p.eye[1], d.pos[2] - p.eye[2]) <= 30 + 1e-9) inside = from <= 30 ? 0 : i
    if (ctx.playerHits.length) return (i - inside) * STEP_S
  }
  return -1
}

/** The shortest contact time over a few seeds and directions, from 30 and from 60. */
function shortest(id: string): number {
  let min = Infinity
  for (const from of [30, 60]) for (const seed of [1, 2, 3]) for (const angle of [0, 2.1, 4.2]) {
    const t = contactTime(id, from, seed, angle)
    expect(t).toBeGreaterThan(0)
    min = Math.min(min, t)
  }
  return min
}

describe('drone speed: time to intercept at mid range (30 gibsons)', () => {
  it('a scout takes at least 2 s from 30 off to its dive landing', () => {
    expect(shortest('scout')).toBeGreaterThanOrEqual(2.0)
  })

  it('a swarmer takes at least 2 s from 30 off to contact', () => {
    expect(shortest('swarmer')).toBeGreaterThanOrEqual(2.0)
  })

  it('a sniper\'s bolt is slow enough to step out of: over 1.5 s of flight from 30, after its windup', () => {
    const s = enemies[idx('sniper')]
    expect(30 / s.attack.shot!.speed).toBeGreaterThan(1.5)
    expect(shortest('sniper')).toBeGreaterThanOrEqual(2.0)
  })

  it('a heavy stays slow: under half the player\'s pace, at least 2 s to its first hit', () => {
    expect(enemies[idx('heavy')].speed).toBeLessThan(4.6)
    expect(shortest('heavy')).toBeGreaterThanOrEqual(2.0)
  })
})
