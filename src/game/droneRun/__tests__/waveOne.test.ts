/**
 * waveOne.test.ts - the base variant's first wave on the built-in field,
 * played by a scripted thumb with the touch aim assist on: clearable, but
 * not free. The player advances on the finish at a quarter of full speed
 * (fighting as it goes), the look drifts after the nearest drone the way a
 * thumb would, and the assist fires; the simulation's assist roll sends
 * some of those shots wide, the rifle overheats, and scouts land dives.
 *
 * At the tuning of 2026-11-16, over seeds 1 to 8: every run clears, 6 HP
 * lost in all (0 to 2 a run, a hit in 4 of the 8), 27 overheats in all
 * (about 3 a run), about 17% of assisted shots wide. A player who keeps moving at half speed
 * or more is not hit on this field (sniper shots and scout dives both aim
 * at where the player was), so the slow advance is the one checked.
 */

import { describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { createRun, eyeOf, stateHash, stepRun, type DroneRunVariant, type LevelInfo, type RunInput, type RunState, type Vec3 } from '../../../lib/games/droneRun/sim'
import { DRONE_RUN_GAME } from '../../../lib/games/droneRun/game'
import { worldFromLevel } from '../../../lib/games/droneRun/level/levelWorld'
import { placeholderField } from '../../../lib/games/droneRun/level/placeholderField'
import base from '../../../lib/games/droneRun/variants/drone-run-base.json'
import { applyAssist, type AssistAt } from '../assist'
import { lookAtScreen } from '../frame'
import { runnerSolids } from '../runner'

const W = 390, H = 844
const LENS = new PerspectiveCamera(55, W / H, 0.05, 600)
const AT: AssistAt = { halfPx: 70, projection: LENS.projectionMatrix, width: W, height: H }

const field = placeholderField()
const world = worldFromLevel(DRONE_RUN_GAME, 'wave-one', field.level, field.payloads)
const solids = runnerSolids(world.shards, DRONE_RUN_GAME.region.base)
const level = field.level as unknown as LevelInfo

function variant(): DroneRunVariant {
  return JSON.parse(JSON.stringify(base)) as DroneRunVariant
}

/** How the scripted player goes: `pace` of full speed toward the finish (0 stands once out of the start zone). */
interface Style { pace: number; sprint?: boolean; thumb?: number }

interface Outcome { phase: string; hp: number; timeS: number; kills: number; shots: number; assisted: number; wide: number; overheats: number; hitsTaken: number }

/** Wave 1 on the built-in field with `seed`, played by the scripted thumb for at most `maxS` seconds. */
function playWaveOne(seed: number, style: Style, maxS = 90): { st: RunState; out: Outcome; log: RunInput[] } {
  const st = createRun(variant(), solids, { level, seed, wave: 0 })
  const fin = st.world.level.finish
  const goal: Vec3 = [(fin.lo[0] + fin.hi[0]) / 2, 0, (fin.lo[2] + fin.hi[2]) / 2]
  let yaw = st.body.yaw, pitch = 0.1
  const out: Outcome = { phase: '', hp: 0, timeS: 0, kills: 0, shots: 0, assisted: 0, wide: 0, overheats: 0, hitsTaken: 0 }
  const log: RunInput[] = []
  let stuck = 0
  for (let i = 0; i < maxS * 60 && (st.phase === 'safe' || st.phase === 'wave'); i++) {
    const e = eyeOf(st.body, st.world.variant.spec.player)
    // Toward the finish, in the body's own terms (forward and right of the look).
    const dx = goal[0] - st.body.pos[0], dz = goal[2] - st.body.pos[2]
    const dl = Math.hypot(dx, dz) || 1
    const fx = Math.sin(yaw), fz = -Math.cos(yaw), rx = -Math.cos(yaw), rz = -Math.sin(yaw)
    const pace = st.phase === 'safe' ? 1 : style.pace
    const fwd = ((dx * fx + dz * fz) / dl) * pace, strafe = ((dx * rx + dz * rz) / dl) * pace
    const speed = Math.hypot(st.body.vel[0], st.body.vel[2])
    stuck = pace > 0 && speed < 2 ? stuck + 1 : 0
    const inp: RunInput = { move: { fwd, strafe }, yaw, pitch, jump: stuck > 10 && i % 20 === 0, fire: false, select: null, reload: false, sprint: style.sprint && st.drones.length === 0 }
    applyAssist(st, inp, AT)
    log.push(JSON.parse(JSON.stringify(inp)) as RunInput)
    stepRun(st, inp)
    for (const ev of st.events) {
      if (ev.type === 'shot') { out.shots++; if (inp.aim) out.assisted++; if (ev.wide) out.wide++ }
      if (ev.type === 'overheated') out.overheats++
      if (ev.type === 'player-hit') out.hitsTaken++
    }
    // The look: after the nearest drone in sight range, a little off and lagging, as a thumb would; with none, toward the finish.
    let want = lookAtScreen(e, [goal[0], e[1], goal[2]])
    if (st.drones.length) {
      const near = [...st.drones].sort((a, b) => Math.hypot(a.pos[0] - e[0], a.pos[1] - e[1], a.pos[2] - e[2]) - Math.hypot(b.pos[0] - e[0], b.pos[1] - e[1], b.pos[2] - e[2]))[0]
      if (Math.hypot(near.pos[0] - e[0], near.pos[1] - e[1], near.pos[2] - e[2]) < 60) want = lookAtScreen(e, [near.pos[0] + Math.sin(i / 23 + seed) * 1.5, near.pos[1] + Math.cos(i / 31 + seed), near.pos[2]])
    }
    let dy = want.yaw - yaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    const k = style.thumb ?? 0.1
    yaw += dy * k
    pitch += (want.pitch - pitch) * k
  }
  let kills = 0
  for (const k in st.kills) kills += st.kills[k]
  Object.assign(out, { phase: st.phase, hp: st.hp, timeS: st.waveStep / 60, kills })
  return { st, out, log }
}

describe('wave 1 on the built-in field, assist on', () => {
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]

  it('a slow, fighting advance clears every seed but takes hits, and the auto-firing rifle overheats', () => {
    const runs = SEEDS.map((seed) => playWaveOne(seed, { pace: 0.25 }).out)
    for (const r of runs) {
      expect(r.phase).toBe('cleared')
      expect(r.overheats).toBeGreaterThan(0)
    }
    const lost = runs.reduce((n, r) => n + (3 - r.hp), 0)
    expect(lost).toBeGreaterThanOrEqual(3)
    expect(runs.filter((r) => r.hp < 3).length).toBeGreaterThanOrEqual(3)
    // The assist roll: about 15% of the assisted shots go wide.
    const assisted = runs.reduce((n, r) => n + r.assisted, 0), wide = runs.reduce((n, r) => n + r.wide, 0)
    expect(assisted).toBeGreaterThan(200)
    expect(wide / assisted).toBeGreaterThan(0.09)
    expect(wide / assisted).toBeLessThan(0.23)
  }, 60000)

  it('a sloppier thumb clears too', () => {
    for (const seed of SEEDS.slice(0, 4)) expect(playWaveOne(seed, { pace: 0.25, thumb: 0.04 }).out.phase).toBe('cleared')
  }, 60000)

  it('a run with sprint and assisted shots replays from its input log to the same hash', () => {
    const { st, log } = playWaveOne(3, { pace: 1, sprint: true })
    expect(log.some((x) => x.sprint)).toBe(true)
    expect(log.some((x) => x.aim)).toBe(true)
    const again = createRun(variant(), solids, { level, seed: 3, wave: 0 })
    for (const inp of log) stepRun(again, inp)
    expect(stateHash(again)).toBe(stateHash(st))
  }, 60000)
})
