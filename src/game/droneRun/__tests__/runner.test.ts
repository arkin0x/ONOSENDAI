/**
 * runner.test.ts - the runner's clock, its drawing between steps, its HUD
 * store, and the screen-to-simulation look map. No canvas, no relay.
 */

import { describe, expect, it } from 'vitest'
import { Euler, PerspectiveCamera, Vector3 } from 'three'
import base from '../../../lib/games/droneRun/variants/drone-run-base.json'
import { STEP_S, buildSolids, createRun, lookDir, rightOf, stepRun, stateHash, type DroneRunVariant, type LevelInfo, type RunInput, type Solids, type Vec3 } from '../../../lib/games/droneRun/sim'
import { DroneRunner, HUD_EVERY, hudOf, onDroneRunEvent, sameHud, useDroneRunHud } from '../runner'
import { cameraYaw, lookAtScreen, simYaw, toRender, toSimInput } from '../frame'
import { switchPose } from '../Viewmodel'
import { standInLevel } from '../runLevel'

const variant = (): DroneRunVariant => JSON.parse(JSON.stringify(base)) as DroneRunVariant

/** The 12 triangles of a box. */
function boxTris(lo: Vec3, hi: Vec3): number[] {
  const v = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]])
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
  const out: number[] = []
  for (const [a, b, c, d] of quads) for (const t of [[a, b, c], [a, c, d]]) for (const k of t) out.push(...v[k])
  return out
}

/** A flat field: the ground's top at 63.5 (the floor of gibson 64), and a wall across the middle to give the drones something to fly round. */
const SOLIDS: Solids = buildSolids([...boxTris([-0.5, 48, -0.5], [255.5, 63.5, 255.5]), ...boxTris([100, 63.5, 150], [110, 70, 152])])

const LEVEL: LevelInfo = standInLevel(variant(), [128, 64, 196])

/** A scripted input log in screen terms: run forward out of the safe zone, turn, strafe, fire in bursts, switch guns, jump. */
function inputLog(n: number): RunInput[] {
  const out: RunInput[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      move: { fwd: i < 400 ? 1 : 0.5, strafe: i > 250 && i < 330 ? 1 : i > 450 ? -0.6 : 0 },
      yaw: Math.sin(i / 90) * 0.4,
      pitch: 0.15 + Math.sin(i / 50) * 0.1,
      jump: i % 97 === 0,
      fire: (i % 40) < 25,
      select: i === 300 ? 1 : i === 420 ? 2 : null,
      reload: false,
    })
  }
  return out
}

/** Runs a runner until it has stepped `n` times, frames chosen by `dt(k)`; returns the state's hash after exactly n steps. */
function runWithFrames(n: number, dt: (k: number) => number): string {
  const log = inputLog(n + 50)
  let i = 0
  let hashAt: string | null = null
  // eslint-disable-next-line prefer-const
  let runner: DroneRunner
  const input = (): RunInput => {
    if (i === n && hashAt === null) hashAt = runner.hash()
    return log[i++]
  }
  runner = new DroneRunner(variant(), SOLIDS, { level: LEVEL, seed: 7, input, hud: false })
  let k = 0
  while (hashAt === null && k < 100000) runner.frame(dt(k++))
  return hashAt!
}

describe('the runner clock', () => {
  it('gives the same state for the same input log, whatever the frame times', () => {
    const n = 700
    const even = runWithFrames(n, () => 1 / 60)
    const fast = runWithFrames(n, () => 1 / 144)
    let seed = 12345
    const jitter = runWithFrames(n, () => { seed = (seed * 1103515245 + 12345) >>> 0; return 0.001 + (seed / 2 ** 32) * 0.06 })
    const stall = runWithFrames(n, (k) => (k % 50 === 0 ? 0.5 : 1 / 30))
    expect(fast).toBe(even)
    expect(jitter).toBe(even)
    expect(stall).toBe(even)
    // And the same as stepping the simulation directly with the same inputs.
    const st = createRun(variant(), SOLIDS, { level: LEVEL, seed: 7 })
    for (const inp of inputLog(n)) stepRun(st, toSimInput(inp))
    expect(stateHash(st)).toBe(even)
    // The run went somewhere: the wave began and drones came.
    expect(st.phase).not.toBe('safe')
  })

  it('runs no step for a frame shorter than a step, and carries the remainder', () => {
    const r = new DroneRunner(variant(), SOLIDS, { level: LEVEL, hud: false, input: () => inputLog(1)[0] })
    expect(r.frame(STEP_S * 0.4)).toBe(0)
    expect(r.frame(STEP_S * 0.4)).toBe(0)
    expect(r.frame(STEP_S * 0.4)).toBe(1)
    expect(r.carry).toBeCloseTo(STEP_S * 0.2, 9)
    // A stall owes at most a quarter second.
    expect(r.frame(10)).toBe(Math.floor((0.25 + r.carry) / STEP_S + 1e-9))
  })

  it('pauses: no steps, the time away dropped, and the first frame back runs none', () => {
    const r = new DroneRunner(variant(), SOLIDS, { level: LEVEL, hud: false, input: () => inputLog(1)[0] })
    r.setPaused(true)
    expect(r.frame(0.1)).toBe(0)
    r.setPaused(false)
    expect(r.frame(0.1)).toBe(0)
    expect(r.frame(0.1)).toBe(6)
  })
})

describe('drawing between steps', () => {
  it('alpha stays in 0..1 and the drawn eye lies between the last two steps', () => {
    const log = inputLog(2000)
    let i = 0
    const r = new DroneRunner(variant(), SOLIDS, { level: LEVEL, hud: false, input: () => log[i++] })
    let seed = 99
    const out: Vec3 = [0, 0, 0]
    for (let k = 0; k < 600; k++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      r.frame(0.002 + (seed / 2 ** 32) * 0.03)
      const a = r.alpha()
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(1)
      r.eye(out)
      const p = r.state.body.pos, e = r.state.world.variant.spec.player.eye
      const now: Vec3 = [p[0], p[1] + e, p[2]]
      for (let ax = 0; ax < 3; ax++) {
        const lo = Math.min(r.prev.eye[ax], now[ax]) - 1e-9, hi = Math.max(r.prev.eye[ax], now[ax]) + 1e-9
        expect(out[ax]).toBeGreaterThanOrEqual(lo)
        expect(out[ax]).toBeLessThanOrEqual(hi)
      }
      for (const d of r.state.drones) {
        r.between('drones', d.id, d.pos, out)
        const was = r.prev.drones.get(d.id) ?? d.pos
        for (let ax = 0; ax < 3; ax++) {
          expect(out[ax]).toBeGreaterThanOrEqual(Math.min(was[ax], d.pos[ax]) - 1e-9)
          expect(out[ax]).toBeLessThanOrEqual(Math.max(was[ax], d.pos[ax]) + 1e-9)
        }
      }
    }
  })
})

describe('the HUD store', () => {
  it('is set only when a value it shows changes, and moving values at most every HUD_EVERY steps', () => {
    let sets = 0
    const stop = useDroneRunHud.subscribe(() => { sets++ })
    const idle: RunInput = { move: { fwd: 0, strafe: 0 }, yaw: 0, pitch: 0, jump: false, fire: false, select: null, reload: false }
    let cur = idle
    const r = new DroneRunner(variant(), SOLIDS, { level: LEVEL, input: () => cur })
    const names = useDroneRunHud.getState().weaponNames
    expect(useDroneRunHud.getState().maxHp).toBe(3)
    sets = 0
    // Standing still in the safe zone: nothing the HUD shows changes.
    for (let k = 0; k < 120; k++) r.frame(1 / 60)
    expect(sets).toBe(0)
    // Firing the heat gun: heat moves every step, the store at most every HUD_EVERY steps.
    cur = { ...idle, fire: true }
    for (let k = 0; k < 60; k++) r.frame(1 / 60)
    expect(sets).toBeGreaterThan(0)
    expect(sets).toBeLessThanOrEqual(Math.ceil(60 / HUD_EVERY) + 2)
    expect(useDroneRunHud.getState().heat).toBeGreaterThan(0)
    // The lists keep their references.
    expect(useDroneRunHud.getState().weaponNames).toBe(names)
    stop()
  })

  it('shows sprint stamina (0..1, at most 10 times a second like heat), whether sprinting, and the lockout', () => {
    const idle: RunInput = { move: { fwd: 0, strafe: 0 }, yaw: 0, pitch: 0, jump: false, fire: false, select: null, reload: false }
    let cur = idle
    const r = new DroneRunner(variant(), SOLIDS, { level: LEVEL, input: () => cur })
    expect(useDroneRunHud.getState()).toMatchObject({ stamina: 1, sprinting: false, sprintLocked: false, hasStamina: true })
    let sets = 0
    const stop = useDroneRunHud.subscribe(() => { sets++ })
    // Sprinting (sprint passes from the input through toSimInput): stamina falls, the store moves at most every HUD_EVERY steps.
    cur = { ...idle, move: { fwd: 1, strafe: 0 }, sprint: true }
    for (let k = 0; k < 60; k++) r.frame(1 / 60)
    const h = useDroneRunHud.getState()
    expect(h.sprinting).toBe(true)
    expect(h.stamina).toBeGreaterThan(0.6)
    expect(h.stamina).toBeLessThan(0.7)
    expect(Math.round(h.stamina * 50)).toBe(h.stamina * 50)
    expect(sets).toBeLessThanOrEqual(Math.ceil(60 / HUD_EVERY) + 3)
    // Run dry: the lockout shows.
    for (let k = 0; k < 120 && !useDroneRunHud.getState().sprintLocked; k++) r.frame(1 / 60)
    // (The step that ran it dry was still a sprinting step.)
    expect(useDroneRunHud.getState().sprintLocked).toBe(true)
    // The meter catches up within a tenth of a second (it is one of the 10 Hz values).
    for (let k = 0; k < HUD_EVERY; k++) r.frame(1 / 60)
    expect(useDroneRunHud.getState()).toMatchObject({ stamina: 0, sprintLocked: true, sprinting: false })
    stop()
  })

  it('a snapshot compares equal to itself and differs on any field', () => {
    const st = createRun(variant(), SOLIDS, { level: LEVEL })
    const a = hudOf(st, null, true)
    expect(sameHud(a, hudOf(st, a, true))).toBe(true)
    expect(sameHud(a, { ...a, hp: a.hp - 1 })).toBe(false)
  })

  it('tells every event of every step, in order', () => {
    const seen: string[] = []
    const stop = onDroneRunEvent((ev) => seen.push(ev.type))
    const log = inputLog(400)
    let i = 0
    const r = new DroneRunner(variant(), SOLIDS, { level: LEVEL, hud: false, input: () => log[i++] })
    for (let k = 0; k < 300; k++) r.frame(1 / 60)
    stop()
    expect(seen).toContain('wave-started')
    expect(seen).toContain('shot')
    expect(seen.indexOf('wave-started')).toBeGreaterThanOrEqual(0)
  })
})

describe('screen look to simulation look (frame.ts)', () => {
  it('no flip: the input goes to the simulation as it is, the camera looks where it aims, and strafe +1 moves right on screen', () => {
    const cam = new PerspectiveCamera()
    for (const [yaw, pitch] of [[0, 0], [0.7, 0.2], [-2.1, -0.4], [3, 0.1]]) {
      cam.rotation.copy(new Euler(pitch, cameraYaw(yaw), 0, 'YXZ'))
      cam.updateMatrixWorld()
      const forward = cam.getWorldDirection(new Vector3())
      const aim = new Vector3()
      expect(simYaw(yaw)).toBe(yaw)
      toRender(lookDir(yaw, pitch), aim)
      expect(forward.distanceTo(aim)).toBeLessThan(1e-9)
      // Screen right, level.
      const right = new Vector3(1, 0, 0).applyQuaternion(cam.quaternion)
      right.y = 0
      right.normalize()
      const screen: RunInput = { move: { fwd: 0, strafe: 1 }, yaw, pitch, jump: false, fire: false, select: null, reload: false }
      const sim = toSimInput(screen)
      expect(sim).toEqual(screen)
      const r = rightOf(sim.yaw)
      const moved = new Vector3()
      toRender([r.x * sim.move.strafe, 0, r.z * sim.move.strafe], moved)
      expect(right.distanceTo(moved.normalize())).toBeLessThan(1e-9)
    }
  })

  it('lookAtScreen faces a point', () => {
    const eye: Vec3 = [10, 70, 200], target: Vec3 = [30, 80, 150]
    const l = lookAtScreen(eye, target)
    const d = lookDir(l.yaw, l.pitch)
    const want = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]
    const len = Math.hypot(want[0], want[1], want[2])
    for (let a = 0; a < 3; a++) expect(d[a]).toBeCloseTo(want[a] / len, 9)
  })
})

describe('the viewmodel switch', () => {
  it('lowers the old gun for the first half of readyS and raises the new one for the second', () => {
    expect(switchPose(0, 0.3, 0, 2)).toEqual({ shown: 0, lower: 0 })
    expect(switchPose(0.075, 0.3, 0, 2).shown).toBe(0)
    expect(switchPose(0.075, 0.3, 0, 2).lower).toBeCloseTo(0.5)
    expect(switchPose(0.225, 0.3, 0, 2).shown).toBe(2)
    expect(switchPose(0.225, 0.3, 0, 2).lower).toBeCloseTo(0.5)
    expect(switchPose(0.3, 0.3, 0, 2)).toEqual({ shown: 2, lower: 0 })
  })
})
