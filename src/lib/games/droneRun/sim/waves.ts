/**
 * waves.ts - running a WaveScript: which drones spawn, where, and when.
 *
 * Each spawn line starts when the wave starts, or when its trigger fires:
 * `time` at `value` seconds into the wave, `player-z-below` the first step
 * the player's feet are at z below `value`. Its first drone comes `delayS`
 * after it starts, then one each `every` seconds (all at once without
 * `every`), `count` in all. A drone that is due while `maxAlive` drones are
 * alive waits for a slot. Lines are served in their order, each step, so the
 * spawn order is fixed.
 *
 * Several drones from one point are spread up to SPAWN_JITTER gibsons
 * around it (seeded), at a place clear of solids if one is found.
 *
 * "Drones left" is what is still to spawn plus what is alive.
 */

import type { Vec3, WaveScript } from '../types'
import { range, type Rng } from './rng'
import { sphereHits, type Solids } from './solids'

/** How far around its point a spawn may be spread, gibsons. */
export const SPAWN_JITTER = 1.5
/** Float slack on the spawn clock. */
const EPS = 1e-9

/** One spawn line's progress. */
export interface LineState {
  started: boolean
  /** Wave seconds when it started. */
  startAt: number
  spawned: number
}

/** A wave in progress. */
export interface WaveState {
  lines: LineState[]
}

/** A wave script before it starts. */
export function makeWaveState(script: WaveScript): WaveState {
  return { lines: script.spawns.map(() => ({ started: false, startAt: 0, spawned: 0 })) }
}

/** Drones still to spawn. */
export function toSpawn(script: WaveScript, w: WaveState): number {
  return script.spawns.reduce((n, s, i) => n + Math.max(0, s.count - w.lines[i].spawned), 0)
}

/** A drone the wave asks for now: its line, its kind, its point. */
export interface SpawnOrder {
  line: number
  enemy: string
  at: Vec3
}

/**
 * The spawns due at wave time `t` (seconds since the wave started) with
 * `alive` drones up, the player's feet at `feetZ`. Advances `w`.
 */
export function dueSpawns(script: WaveScript, w: WaveState, t: number, feetZ: number, alive: number, pointOf: (at: string | Vec3) => Vec3): SpawnOrder[] {
  const out: SpawnOrder[] = []
  script.spawns.forEach((s, i) => {
    const line = w.lines[i]
    if (!line.started) {
      const tr = s.trigger
      if (!tr) { line.started = true; line.startAt = 0 }
      else if (tr.kind === 'time' && t + EPS >= tr.value) { line.started = true; line.startAt = tr.value }
      else if (tr.kind === 'player-z-below' && feetZ < tr.value) { line.started = true; line.startAt = t }
      if (!line.started) return
    }
    while (line.spawned < s.count && alive + out.length < script.maxAlive) {
      const due = line.startAt + s.delayS + (s.every && s.every > 0 ? line.spawned * s.every : 0)
      if (t + EPS < due) break
      out.push({ line: i, enemy: s.enemy, at: pointOf(s.at) })
      line.spawned++
    }
  })
  return out
}

/** Where a drone of radius `r` appears near `at`: the point itself for the first of its line, else spread around it, clear of solids if possible. */
export function spawnPlace(s: Solids, at: Vec3, r: number, nth: number, rng: Rng): Vec3 {
  if (nth === 0 && !sphereHits(s, at, r)) return [at[0], at[1], at[2]]
  for (let k = 0; k < 8; k++) {
    const p: Vec3 = [at[0] + range(rng, -SPAWN_JITTER, SPAWN_JITTER), at[1] + range(rng, -SPAWN_JITTER / 2, SPAWN_JITTER / 2), at[2] + range(rng, -SPAWN_JITTER, SPAWN_JITTER)]
    if (!sphereHits(s, p, r)) return p
  }
  return [at[0], at[1], at[2]]
}
