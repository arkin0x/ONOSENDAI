/**
 * run.ts - one run of DRONE RUN as a state machine, stepped at a fixed 60 Hz.
 *
 *   safe ──(the body leaves the start zone)──> wave ──(the body touches the finish zone)──> cleared
 *                                                └──(HP reaches 0)──> failed
 *
 * - safe: the player is in, or has not yet left, the start zone. No drones.
 *   The guns work (there is nothing to hit).
 * - wave: begins on the first step the body's box no longer overlaps the
 *   start zone's box. The wave script spawns drones (sim/waves.ts).
 * - cleared: on the first step in the wave the body's box overlaps the
 *   finish zone's box, however it got there (a hop that only clips a corner
 *   counts). The clear time is the steps since the wave began, over 60.
 * - failed: HP 0. A hit costs its damage (1) and opens an invulnerability
 *   window of invulnMs, inside which further hits cost nothing.
 *
 * cleared and failed are frozen: stepRun does nothing more until restart
 * (back to the entry in the safe zone, full HP, no drones, the same wave) or
 * nextWave (the same, with the next wave script; after the last it repeats
 * the last, or wraps to the first when spec.afterLast is "wrap").
 *
 * The run is a pure function of (variant, solids, level, seed, inputs):
 * fixed step STEP_S, seeded generators kept in the state (one each for the
 * guns' spread, the drones, and the spawns, so firing never changes where a
 * drone wanders), and no clock read anywhere. Order within a step: the body
 * moves, then the guns fire (from the moved eye, at the drones where the
 * last step left them), then spawns, then the drones move and attack. stepRun MUTATES the state in
 * place and returns it, for speed; restart and nextWave return a new state.
 * The state is plain data apart from its references to the variant, the
 * solids and the level, which are never changed.
 */

import type { DroneRunVariant, LevelInfo, RunInput, Vec3, WaveScript, ZoneBox } from '../types'
import type { RunEvent } from './events'
import { makeBody, placeBody, regionBounds, stepPlayer, eyeOf, type Body, type Bounds } from './player'
import { lookDir } from './fluid'
import { makeArsenal, stepGuns, stepProjectiles, type Arsenal, type DamageHit, type Projectile } from './weapons'
import { makeDrone, stepDrones, stepDroneShots, type Drone, type DroneShot, type PlayerHit } from './drones'
import { dueSpawns, makeWaveState, spawnPlace, toSpawn, type WaveState } from './waves'
import { makeRng, mixSeeds, type Rng } from './rng'
import type { Solids } from './solids'

/** The fixed step, seconds. */
export const STEP_S = 1 / 60

export type Phase = 'safe' | 'wave' | 'cleared' | 'failed'

/** A solid box, region-local gibsons. */
export interface Box3 {
  lo: Vec3
  hi: Vec3
}

/** The level as the run reads it: zones as solid boxes, the entry, spawn points by id. */
export interface RunLevel {
  start: Box3
  finish: Box3
  entry: Vec3
  entryYaw: number
  spawns: Record<string, Vec3>
}

/** How a run is made. */
export interface RunOptions {
  level: LevelInfo
  /** The run's own seed, mixed with the wave's. Default 0. */
  seed?: number
  /** The wave script index. Default 0. */
  wave?: number
  /** The region's side, gibsons. Default 256 (height 8). */
  regionSize?: number
}

/** One run. Plain data except the read-only references in `world`. */
export interface RunState {
  world: { variant: DroneRunVariant; solids: Solids; level: RunLevel; bounds: Bounds; options: RunOptions }
  wave: number
  phase: Phase
  /** Steps since the run was made. */
  step: number
  /** Steps since the wave began (0 on the step it began); -1 before. */
  waveStep: number
  hp: number
  /** Seconds of invulnerability left. */
  invuln: number
  body: Body
  arsenal: Arsenal
  drones: Drone[]
  droneShots: DroneShot[]
  projectiles: Projectile[]
  waveState: WaveState
  rng: { guns: Rng; drones: Rng; spawns: Rng }
  ids: { next: number }
  kills: Record<string, number>
  /** Seconds from the wave's start to the clear, once cleared. */
  clearTimeS: number | null
  score: number
  /** What happened in the last step, in order. */
  events: RunEvent[]
}

/** A zone of whole gibsons (both corners included) as a solid box. */
export function zoneBox(z: ZoneBox): Box3 {
  const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, 0]
  for (let a = 0; a < 3; a++) { lo[a] = Math.min(z.lo[a], z.hi[a]) - 0.5; hi[a] = Math.max(z.lo[a], z.hi[a]) + 0.5 }
  return { lo, hi }
}

/** The level facts the run needs, from either shape level.json may use. */
export function readLevel(level: LevelInfo): RunLevel {
  const entry = Array.isArray(level.entry) ? { at: level.entry as Vec3, yaw: 0 } : level.entry
  const spawns: Record<string, Vec3> = {}
  if (Array.isArray(level.spawns)) for (const s of level.spawns) spawns[s.id] = s.at
  else Object.assign(spawns, level.spawns)
  return { start: zoneBox(level.zones.start), finish: zoneBox(level.zones.finish), entry: [entry.at[0], entry.at[1], entry.at[2]], entryYaw: entry.yaw ?? 0, spawns }
}

/** The body's box. */
export function bodyBox(b: Body, height: number, radius: number): Box3 {
  return { lo: [b.pos[0] - radius, b.pos[1], b.pos[2] - radius], hi: [b.pos[0] + radius, b.pos[1] + height, b.pos[2] + radius] }
}

/** Whether two boxes overlap (touching counts). */
export function overlaps(a: Box3, b: Box3): boolean {
  return a.lo[0] <= b.hi[0] && a.hi[0] >= b.lo[0] && a.lo[1] <= b.hi[1] && a.hi[1] >= b.lo[1] && a.lo[2] <= b.hi[2] && a.hi[2] >= b.lo[2]
}

/** Throws on a variant the run cannot play with this level. */
export function checkVariant(v: DroneRunVariant, level: RunLevel): void {
  const s = v.spec
  if (v.format !== 'drone-run/1') throw new Error(`Unknown variant format: ${String(v.format)}`)
  if (!s.weapons.length) throw new Error('A variant needs at least one weapon.')
  for (const w of s.weapons) {
    if (!!w.heat === !!w.ammo) throw new Error(`Weapon ${w.id} needs exactly one of heat or ammo.`)
    if (!(w.rate > 0)) throw new Error(`Weapon ${w.id} needs a rate above 0.`)
    if (w.mode === 'charge' && !w.charge) throw new Error(`Weapon ${w.id} is a charge gun with no charge.`)
    if (w.assist !== undefined && (w.assist !== 'auto' || w.fire !== 'hitscan')) throw new Error(`Weapon ${w.id}: assist must be "auto", on a hitscan gun.`)
  }
  if (!s.waves.length) throw new Error('A variant needs at least one wave.')
  const enemies = new Set(s.enemies.map((e) => e.id))
  for (const wave of s.waves) for (const sp of wave.spawns) {
    if (!enemies.has(sp.enemy)) throw new Error(`Wave ${wave.id} spawns an unknown enemy: ${sp.enemy}`)
    if (typeof sp.at === 'string' && !level.spawns[sp.at]) throw new Error(`Wave ${wave.id} uses an unknown spawn point: ${sp.at}`)
  }
}

/** The script for wave index `i`. */
function scriptOf(v: DroneRunVariant, i: number): WaveScript {
  return v.spec.waves[Math.max(0, Math.min(v.spec.waves.length - 1, i))]
}

/** A fresh run at the entry, in the safe zone. */
export function createRun(variant: DroneRunVariant, solids: Solids, opts: RunOptions): RunState {
  const level = readLevel(opts.level)
  checkVariant(variant, level)
  const bounds = regionBounds(opts.regionSize ?? 256)
  const wave = Math.max(0, Math.min(variant.spec.waves.length - 1, opts.wave ?? 0))
  const script = scriptOf(variant, wave)
  const base = mixSeeds(opts.seed ?? 0, script.seed)
  const p = variant.spec.player
  const body = makeBody(level.entry, level.entryYaw)
  placeBody(body, p, solids, bounds)
  return {
    world: { variant, solids, level, bounds, options: opts },
    wave, phase: 'safe', step: 0, waveStep: -1, hp: p.hp, invuln: 0,
    body, arsenal: makeArsenal(variant.spec.weapons), drones: [], droneShots: [], projectiles: [],
    waveState: makeWaveState(script),
    rng: { guns: makeRng(mixSeeds(base, 1)), drones: makeRng(mixSeeds(base, 2)), spawns: makeRng(mixSeeds(base, 3)) },
    ids: { next: 1 }, kills: {}, clearTimeS: null, score: 0, events: [],
  }
}

/** Points for a clear. */
function scoreOf(st: RunState, timeS: number): number {
  const sc = st.world.variant.spec.scoring
  if (!sc) return 0
  let pts = 0
  for (const [enemy, n] of Object.entries(st.kills)) pts += (sc.perKill?.[enemy] ?? 0) * n
  if (sc.timeBonus) pts += Math.max(0, sc.timeBonus.parS - timeS) * sc.timeBonus.perSecond
  return Math.round(pts)
}

/** Drones still to spawn plus drones alive. */
export function dronesLeft(st: RunState): number {
  return toSpawn(scriptOf(st.world.variant, st.wave), st.waveState) + st.drones.length
}

/**
 * One fixed step (STEP_S) with `input`. MUTATES `st` and returns it;
 * st.events lists what happened. Does nothing once cleared or failed.
 */
export function stepRun(st: RunState, input: RunInput): RunState {
  st.events = []
  if (st.phase === 'cleared' || st.phase === 'failed') return st
  const { variant, solids, level, bounds } = st.world
  const spec = variant.spec
  const p = spec.player
  const dt = STEP_S
  const ev = st.events

  // The body.
  const be = stepPlayer(st.body, p, solids, bounds, input, dt)
  if (be.jumped) ev.push({ type: 'jumped', double: be.jumped === 2 })
  if (be.landed) ev.push({ type: 'landed' })
  const box = bodyBox(st.body, p.height, p.radius)
  if (st.phase === 'safe' && !overlaps(box, level.start)) {
    st.phase = 'wave'
    st.waveStep = 0
    ev.push({ type: 'wave-started', wave: st.wave })
  } else if (st.phase === 'wave') st.waveStep++
  if (st.phase === 'wave' && overlaps(box, level.finish)) {
    st.phase = 'cleared'
    st.clearTimeS = st.waveStep * dt
    st.score = scoreOf(st, st.clearTimeS)
    ev.push({ type: 'cleared', wave: st.wave, timeS: st.clearTimeS, score: st.score })
    return finishStep(st, dt)
  }

  // The guns.
  const eye = eyeOf(st.body, p)
  const hits: DamageHit[] = []
  const gunCtx = { defs: spec.weapons, solids, targets: st.drones, rng: st.rng.guns, eye, dir: lookDir(st.body.yaw, st.body.pitch), aim: aimDir(input), dt, events: ev, hits, projectiles: st.projectiles, ids: st.ids }
  stepGuns(st.arsenal, input, gunCtx)
  stepProjectiles(gunCtx)
  applyHits(st, hits)

  if (st.phase === 'wave') {
    const script = scriptOf(variant, st.wave)
    const due = dueSpawns(script, st.waveState, st.waveStep * dt, st.body.pos[2], st.drones.length, (at) => (typeof at === 'string' ? level.spawns[at] : at))
    for (const o of due) {
      const defIndex = spec.enemies.findIndex((e) => e.id === o.enemy)
      const def = spec.enemies[defIndex]
      const nth = st.waveState.lines[o.line].spawned - 1
      const at = spawnPlace(solids, o.at, def.radius, nth, st.rng.spawns)
      const d = makeDrone(st.ids.next++, spec.enemies, defIndex, at, eye, st.rng.drones)
      st.drones.push(d)
      ev.push({ type: 'drone-spawned', drone: d.id, enemy: d.enemy, at: [at[0], at[1], at[2]] })
    }
    const playerHits: PlayerHit[] = []
    const droneCtx = { defs: spec.enemies, solids, bounds, player: { feet: st.body.pos, eye, height: p.height, radius: p.radius }, rng: st.rng.drones, dt, events: ev, playerHits, shots: st.droneShots, ids: st.ids }
    stepDrones(st.drones, droneCtx)
    stepDroneShots(droneCtx)
    for (const h of playerHits) {
      if (st.invuln > 0 || st.hp <= 0) continue
      st.hp = Math.max(0, st.hp - h.damage)
      st.invuln = p.invulnMs / 1000
      ev.push({ type: 'player-hit', by: h.enemy, drone: h.drone, damage: h.damage, hp: st.hp })
      if (st.hp <= 0) {
        st.phase = 'failed'
        ev.push({ type: 'failed', wave: st.wave, timeS: st.waveStep * dt })
        break
      }
    }
  }
  return finishStep(st, dt)
}

/** The unit direction of the input's aim (RunInput.aim), or null when it has none or it is not finite. */
export function aimDir(input: RunInput): Vec3 | null {
  const a = input.aim
  if (!a || !Number.isFinite(a.yaw) || !Number.isFinite(a.pitch)) return null
  return lookDir(a.yaw, a.pitch)
}

function finishStep(st: RunState, dt: number): RunState {
  st.invuln = Math.max(0, st.invuln - dt)
  st.step++
  return st
}

/** Damage from the guns: drones lose HP, and those at 0 are destroyed and counted. */
function applyHits(st: RunState, hits: readonly DamageHit[]): void {
  if (!hits.length) return
  for (const h of hits) {
    const d = st.drones.find((x) => x.id === h.target)
    if (!d || d.hp <= 0) continue
    d.hp -= h.damage
    st.events.push({ type: 'hit', drone: d.id, damage: h.damage, point: h.point })
    if (d.hp <= 1e-9) {
      d.hp = 0
      st.kills[d.enemy] = (st.kills[d.enemy] ?? 0) + 1
      st.events.push({ type: 'drone-destroyed', drone: d.id, enemy: d.enemy, at: [d.pos[0], d.pos[1], d.pos[2]] })
    }
  }
  st.drones = st.drones.filter((d) => d.hp > 0)
}

/** Back to the entry in the safe zone: full HP, no drones, no shots, guns reset, the same wave. A new state, equal to a fresh run. */
export function restart(st: RunState): RunState {
  const { variant, solids, options } = st.world
  return createRun(variant, solids, { ...options, wave: st.wave })
}

/** The wave after this one (after the last: the last again, or the first with afterLast "wrap"). */
export function nextWaveIndex(st: RunState): number {
  const n = st.world.variant.spec.waves.length
  if (st.wave + 1 < n) return st.wave + 1
  return st.world.variant.spec.afterLast === 'wrap' ? 0 : n - 1
}

/** After a clear: as restart, with the next wave script. A new state. */
export function nextWave(st: RunState): RunState {
  const { variant, solids, options } = st.world
  return createRun(variant, solids, { ...options, wave: nextWaveIndex(st) })
}

/**
 * Runs as many fixed steps as `frameDt` seconds of real time owe, carrying
 * the remainder (`carry`, seconds) to the next frame, all with the same
 * input (edges only on the first step). Returns the new carry. For the view:
 * the sim itself never reads a clock. A frame shorter than a step runs no
 * step (st.step does not change): keep that frame's edges (jump, reload,
 * select) for the next frame, or they are lost.
 */
export function advance(st: RunState, carry: number, frameDt: number, input: RunInput, onStep?: (st: RunState) => void): number {
  let acc = carry + Math.max(0, Math.min(frameDt, 0.25))
  let first = true
  while (acc >= STEP_S - 1e-12) {
    stepRun(st, first ? input : { ...input, jump: false, reload: false, select: null })
    onStep?.(st)
    first = false
    acc -= STEP_S
  }
  return acc
}
