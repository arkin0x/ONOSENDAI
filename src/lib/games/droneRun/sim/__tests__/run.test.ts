/**
 * run.test.ts - the run's state machine (sim/run.ts): the wave starts on
 * the very step the body leaves the start zone, a clear on the step it
 * touches the finish zone (a hop that only clips it counts), 3 HP with
 * invulnerability frames and failure at 0, restart and next wave, and
 * determinism: the same inputs give the same state hash, and a recorded
 * input log replays to the same result.
 */

import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bodyBox, createRun, nextWave, overlaps, restart, stepRun, STEP_S, type RunState } from '../run'
import { stateHash } from '../hash'
import { makeRng, next } from '../rng'
import { buildSolids } from '../solids'
import { trianglesFromShards } from '../fromShards'
import type { DroneRunVariant, LevelInfo, RunInput, Vec3 } from '../../types'
import { GROUND, boxes, groundSlab, input, plumbWall, testLevel, variant } from './helpers'

const field = boxes(GROUND)
const fwd = (over: Partial<RunInput> = {}): RunInput => input({ move: { fwd: 1, strafe: 0 }, ...over })
const box = (st: RunState) => bodyBox(st.body, st.world.variant.spec.player.height, st.world.variant.spec.player.radius)

/** A variant whose waves spawn nothing: the run's rules alone. */
function quiet(): DroneRunVariant {
  const v = variant()
  v.spec.waves = v.spec.waves.map((w) => ({ ...w, spawns: [] }))
  return v
}

/** Puts a drone shot right in front of the player's chest, flying at it. */
function shoot(st: RunState): void {
  const p = st.body.pos
  st.droneShots.push({ id: st.ids.next++, drone: 0, enemy: 'sniper', pos: [p[0], p[1] + 1, p[2] - 2], vel: [0, 0, 16], radius: 0.35, travelled: 0, range: 70, damage: 1 })
}

describe('the run', () => {
  it('starts in the safe zone with no drones, and the wave starts on exactly the step the body leaves the start zone', () => {
    const st = createRun(variant(), field, { level: testLevel() })
    expect(st.phase).toBe('safe')
    expect(st.body.pos).toEqual([128, 64, 208])
    expect(st.body.grounded).toBe(true)
    // Jumping about inside it starts nothing.
    for (let i = 0; i < 120; i++) stepRun(st, input({ jump: i % 40 === 0 }))
    expect(st.phase).toBe('safe')
    let was = true
    for (let i = 0; i < 300; i++) {
      stepRun(st, fwd())
      const inZone = overlaps(box(st), st.world.level.start)
      const started = st.events.some((e) => e.type === 'wave-started')
      if (was && !inZone) { expect(started).toBe(true); expect(st.phase).toBe('wave'); expect(st.waveStep).toBe(0); break }
      expect(started).toBe(false)
      expect(st.phase).toBe('safe')
      expect(st.drones.length).toBe(0)
      was = inZone
    }
    expect(st.phase).toBe('wave')
    // The zone box is lo - 0.5 .. hi + 0.5: the body's front (z - r) has just passed z 199.5.
    expect(st.body.pos[2] + 0.35).toBeLessThan(199.5)
  })

  it('clears on the step the body enters the finish zone, with the time since the wave began', () => {
    const lv: LevelInfo = { ...testLevel(), zones: { start: { lo: [120, 64, 200], hi: [136, 80, 216] }, finish: { lo: [120, 64, 180], hi: [136, 80, 190] } } }
    const st = createRun(quiet(), field, { level: lv })
    let waveAt = -1
    for (let i = 0; i < 400 && st.phase !== 'cleared'; i++) {
      stepRun(st, fwd())
      if (st.events.some((e) => e.type === 'wave-started')) waveAt = st.step
      const touching = overlaps(box(st), st.world.level.finish)
      expect((st.phase as string) === 'cleared').toBe(touching)
    }
    expect(st.phase).toBe('cleared')
    expect(st.body.pos[2] - 0.35).toBeLessThanOrEqual(190.5)
    expect(st.clearTimeS).toBeCloseTo((st.step - waveAt) * STEP_S, 12)
    const ev = st.events.find((e) => e.type === 'cleared')
    expect(ev).toBeDefined()
    // Frozen once cleared.
    const h = stateHash(st)
    stepRun(st, fwd())
    expect(stateHash(st)).toBe(h)
  })

  it('a hop that only touches the finish zone clears it', () => {
    // The finish zone hangs over the path, from y 70: walking under it touches nothing; a jump's head clips it.
    const lv: LevelInfo = { ...testLevel(), zones: { start: { lo: [120, 64, 200], hi: [136, 80, 216] }, finish: { lo: [120, 70, 150], hi: [136, 75, 190] } } }
    const walk = createRun(quiet(), field, { level: lv })
    for (let i = 0; i < 240; i++) stepRun(walk, fwd())
    expect(walk.phase).toBe('wave')
    expect(walk.body.pos[2]).toBeLessThan(175)
    const hop = createRun(quiet(), field, { level: lv })
    for (let i = 0; i < 240 && hop.phase !== 'cleared'; i++) stepRun(hop, fwd({ jump: hop.body.pos[2] < 185 && hop.body.grounded }))
    expect(hop.phase).toBe('cleared')
    // It cleared on the way up, the moment the head reached the zone's bottom (69.5).
    expect(hop.body.pos[1] + 2).toBeGreaterThanOrEqual(69.5)
    expect(hop.body.pos[1] + 2).toBeLessThan(69.5 + 0.5)
  })

  it('3 HP: a hit costs 1, two hits inside the invulnerability window cost 1, and 0 HP fails the run', () => {
    const st = createRun(quiet(), field, { level: testLevel() })
    while (st.phase === 'safe') stepRun(st, fwd())
    for (let i = 0; i < 10; i++) stepRun(st, input())
    expect(st.hp).toBe(3)
    shoot(st)
    let hits = 0
    for (let i = 0; i < 20; i++) { stepRun(st, input()); hits += st.events.filter((e) => e.type === 'player-hit').length }
    expect(hits).toBe(1)
    expect(st.hp).toBe(2)
    expect(st.invuln).toBeGreaterThan(0)
    // Inside the 1.2 s window: costs nothing.
    shoot(st)
    for (let i = 0; i < 20; i++) stepRun(st, input())
    expect(st.hp).toBe(2)
    // After it: costs 1 again.
    for (let i = 0; i < 60; i++) stepRun(st, input())
    expect(st.invuln).toBe(0)
    shoot(st)
    for (let i = 0; i < 20; i++) stepRun(st, input())
    expect(st.hp).toBe(1)
    for (let i = 0; i < 80; i++) stepRun(st, input())
    shoot(st)
    let failed = false
    for (let i = 0; i < 20; i++) { stepRun(st, input()); if (st.events.some((e) => e.type === 'failed')) failed = true }
    expect(st.hp).toBe(0)
    expect(failed).toBe(true)
    expect(st.phase).toBe('failed')
  })

  it('restart: the state equals a fresh run at the entry, the same wave, whatever happened before', () => {
    const v = variant()
    const lv = testLevel()
    const st0 = createRun(v, field, { level: lv, seed: 4, wave: 1 })
    let st = st0
    for (let i = 0; i < 600; i++) stepRun(st, fwd({ fire: true, yaw: Math.sin(i / 50) * 0.5, jump: i % 70 === 0 }))
    expect(st.phase === 'wave' || st.phase === 'failed').toBe(true)
    expect(st.drones.length + st.step).toBeGreaterThan(600)
    st = restart(st)
    const fresh = createRun(v, field, { level: lv, seed: 4, wave: 1 })
    expect(st).toEqual(fresh)
    expect(st.wave).toBe(1)
    expect(st.phase).toBe('safe')
    expect(st.hp).toBe(3)
    expect(st.drones.length).toBe(0)
    expect(stateHash(st)).toBe(stateHash(fresh))
  })

  it('next wave: after a clear, the next script from the safe zone; after the last it repeats the last, or wraps', () => {
    const lv: LevelInfo = { ...testLevel(), zones: { start: { lo: [120, 64, 200], hi: [136, 80, 216] }, finish: { lo: [120, 64, 180], hi: [136, 80, 190] } } }
    const clear = (st: RunState): RunState => { while (st.phase !== 'cleared') stepRun(st, fwd()); return st }
    const v = quiet()
    let st = clear(createRun(v, field, { level: lv }))
    st = nextWave(st)
    expect(st.wave).toBe(1)
    expect(st.phase).toBe('safe')
    expect(st).toEqual(createRun(v, field, { level: lv, wave: 1 }))
    st = nextWave(clear(st))
    expect(st.wave).toBe(2)
    st = nextWave(clear(st))
    expect(st.wave).toBe(2)
    v.spec.afterLast = 'wrap'
    st = nextWave(clear(createRun(v, field, { level: lv, wave: 2 })))
    expect(st.wave).toBe(0)
  })

  it('a wave spawns its drones on schedule, counts kills, and the guns kill them', () => {
    const v = variant()
    v.spec.waves[0] = { id: 't', name: 't', seed: 1, maxAlive: 4, spawns: [{ at: [128, 66, 180], enemy: 'scout', count: 6, delayS: 0.5, every: 0.5 }] }
    const st = createRun(v, field, { level: testLevel() })
    while (st.phase === 'safe') stepRun(st, fwd())
    const spawnSteps: number[] = []
    for (let i = 0; i < 60 * 3; i++) {
      stepRun(st, input())
      if (st.events.some((e) => e.type === 'drone-spawned')) spawnSteps.push(st.waveStep)
    }
    // At 0.5, 1.0, 1.5, 2.0 s, then held at 4 alive.
    expect(spawnSteps.slice(0, 4)).toEqual([30, 60, 90, 120])
    expect(st.drones.length).toBeLessThanOrEqual(4)
  })
})

describe('determinism', () => {
  /** A seeded log of inputs: running, turning, looking, jumping, firing, switching, reloading. */
  function inputLog(seed: number, steps: number): RunInput[] {
    const r = makeRng(seed)
    const log: RunInput[] = []
    let yaw = 0, pitch = 0
    for (let i = 0; i < steps; i++) {
      yaw += (next(r) - 0.5) * 0.05
      pitch = Math.max(-0.6, Math.min(0.6, pitch + (next(r) - 0.5) * 0.04))
      log.push({ move: { fwd: next(r) < 0.85 ? 1 : 0, strafe: next(r) < 0.2 ? (next(r) < 0.5 ? -1 : 1) : 0 }, yaw, pitch, jump: next(r) < 0.02, fire: next(r) < 0.6, select: next(r) < 0.005 ? Math.floor(next(r) * 3) : null, reload: next(r) < 0.003, sprint: Math.floor(i / 90) % 3 === 0 })
    }
    return log
  }

  function play(v: DroneRunVariant, log: RunInput[], seed = 3): RunState {
    const st = createRun(v, field, { level: testLevel(), seed, wave: 2 })
    for (const inp of log) stepRun(st, inp)
    return st
  }

  it('the same input log twice gives an identical final state hash', () => {
    const log = inputLog(11, 60 * 30)
    const a = play(variant(), log), b = play(variant(), log)
    // It may end early (cleared or failed), and is frozen from then on.
    expect(a.step).toBeGreaterThan(600)
    expect(stateHash(a)).toBe(stateHash(b))
    expect(a.drones.length + Object.keys(a.kills).length).toBeGreaterThan(0)
    // A different seed is a different run.
    expect(stateHash(play(variant(), log, 4))).not.toBe(stateHash(a))
  })

  it('sprint is in the log: the same log without it is a different run, and with it replays exactly', () => {
    const log = inputLog(13, 60 * 10)
    expect(log.some((x) => x.sprint)).toBe(true)
    const a = play(variant(), log), b = play(variant(), log)
    expect(stateHash(a)).toBe(stateHash(b))
    const walked = play(variant(), log.map((x) => ({ ...x, sprint: false })))
    expect(stateHash(walked)).not.toBe(stateHash(a))
  })

  it('a recorded input log, written out and read back, replays to the same result', () => {
    const log = inputLog(12, 60 * 20)
    const live = createRun(variant(), field, { level: testLevel(), seed: 9, wave: 2 })
    const recorded: string[] = []
    const hashes: string[] = []
    log.forEach((inp, i) => { recorded.push(JSON.stringify(inp)); stepRun(live, inp); if (i % 120 === 0) hashes.push(stateHash(live)) })
    const file = JSON.stringify({ seed: 9, wave: 2, inputs: recorded.map((s) => JSON.parse(s)) })
    const read = JSON.parse(file) as { seed: number; wave: number; inputs: RunInput[] }
    const replay = createRun(variant(), field, { level: testLevel(), seed: read.seed, wave: read.wave })
    const again: string[] = []
    read.inputs.forEach((inp, i) => { stepRun(replay, inp); if (i % 120 === 0) again.push(stateHash(replay)) })
    expect(again).toEqual(hashes)
    expect(stateHash(replay)).toBe(stateHash(live))
    expect(replay.phase).toBe(live.phase)
    expect(replay.kills).toEqual(live.kills)
  })
})

describe('performance', () => {
  it('a step with 20 drones over about 40k triangles of shards', () => {
    const pieces: Array<{ shard: ReturnType<typeof groundSlab>; at: Vec3 }> = []
    const tile = groundSlab(), wall = plumbWall()
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) pieces.push({ shard: tile, at: [16 + i * 32, 64, 16 + j * 32] })
    for (let k = 0; k < 20; k++) pieces.push({ shard: wall, at: [40 + (k % 5) * 36, 64, 60 + Math.floor(k / 5) * 40] })
    const tris = trianglesFromShards(pieces)
    const t0 = performance.now()
    const solids = buildSolids(tris)
    const buildMs = performance.now() - t0
    expect(solids.count).toBeGreaterThan(38000)
    const v = variant()
    const ids = ['scout', 'sniper', 'heavy', 'swarmer']
    v.spec.waves[0] = { id: 'p', name: 'p', seed: 5, maxAlive: 20, spawns: ids.map((enemy, k) => ({ at: [100 + k * 15, 80, 150] as Vec3, enemy, count: 5, delayS: 0 })) }
    const lv: LevelInfo = { ...testLevel(), zones: { start: { lo: [120, 64, 236], hi: [136, 80, 250] }, finish: { lo: [120, 64, 4], hi: [136, 80, 10] } }, entry: [128, 65, 238] }
    const st = createRun(v, solids, { level: lv })
    while (st.phase === 'safe') stepRun(st, fwd())
    stepRun(st, input())
    expect(st.drones.length).toBe(20)
    const N = 600
    const t1 = performance.now()
    for (let i = 0; i < N && st.phase === 'wave'; i++) stepRun(st, input({ move: { fwd: 0.3, strafe: Math.sin(i / 40) }, yaw: Math.sin(i / 90), fire: true }))
    const per = (performance.now() - t1) / N
    // The console is quiet under this config: the numbers go to a scratch file for the report.
    writeFileSync('/tmp/drone-run-perf.txt', `drone run perf: ${solids.count} triangles built in ${buildMs.toFixed(1)} ms; ${per.toFixed(3)} ms a step with ${st.drones.length} drones left (20 at start)\n`)
    expect(per).toBeLessThan(8)
  })
})

