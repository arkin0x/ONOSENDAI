/**
 * assist.test.ts - the touch aim assist (assist.ts): which drone it picks
 * (inside the box, most central, in front, in range, in sight), that it
 * fires only the assist gun and only while the box is shown, that every
 * shot it fires hits drones that are moving, that it never fires through a
 * wall, and that a run with assisted aims replays exactly. No canvas, no
 * relay.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { createRun, eyeOf, stepRun, stateHash, type DroneRunVariant, type RunInput, type RunState, type Solids, type Target, type Vec3 } from '../../../lib/games/droneRun/sim'
import { makeDrone } from '../../../lib/games/droneRun/sim/drones'
import { GROUND, boxes, input, testLevel, variant } from '../../../lib/games/droneRun/sim/__tests__/helpers'
import { applyAssist, assistState, eyeAfterStep, pickAssistTarget, setAssistBox, setAssistView } from '../assist'
import { DroneRunner } from '../runner'
import { cameraYaw, lookAtScreen, toRender } from '../frame'

/** A phone in portrait, CSS px. */
const W = 390, H = 844
const HALF = 70

/** The camera at `eye` looking along (yaw, pitch), as Canvas3D's EyeCamera places it. */
function cameraAt(eye: Readonly<Vec3>, yaw: number, pitch: number): PerspectiveCamera {
  const c = new PerspectiveCamera(55, W / H, 0.05, 600)
  toRender(eye, c.position)
  c.rotation.set(pitch, cameraYaw(yaw), 0, 'YXZ')
  c.updateMatrixWorld()
  return c
}

const EYE: Vec3 = [128, 65.75, 128]
const field = boxes(GROUND)
const t = (id: number, pos: Vec3, radius = 0.5): Target => ({ id, pos, radius, hp: 1 })

function pick(drones: Target[], solids: Solids = field, over: { yaw?: number; pitch?: number; halfPx?: number; range?: number } = {}) {
  return pickAssistTarget({ camera: cameraAt(EYE, over.yaw ?? 0, over.pitch ?? 0), width: W, height: H, halfPx: over.halfPx ?? HALF, eye: EYE, drones, range: over.range ?? 60, solids })
}

afterEach(() => { setAssistBox(null); setAssistView(null) })

describe('picking the target', () => {
  it('a drone inside the box is picked, one outside it is not', () => {
    expect(pick([t(1, [128.5, 66, 100])])?.target).toBe(1)
    // 12 across at 28 deep is far out to the side.
    expect(pick([t(2, [140, 65.75, 100])])).toBeNull()
    // The same drone with a box as wide as the screen.
    expect(pick([t(2, [140, 65.75, 100])], field, { halfPx: W })?.target).toBe(2)
  })

  it('the most central wins, even when it is farther', () => {
    const p = pick([t(1, [129.2, 66, 108]), t(2, [128.2, 65.9, 90])])
    expect(p?.target).toBe(2)
  })

  it('behind the camera is ignored, even right behind the reticle', () => {
    expect(pick([t(1, [128, 65.75, 150])])).toBeNull()
  })

  it('out of the gun\'s range is ignored', () => {
    expect(pick([t(1, [128, 65.75, 128 - 59])])?.target).toBe(1)
    expect(pick([t(1, [128, 65.75, 128 - 61])])).toBeNull()
    expect(pick([t(1, [128, 65.75, 128 - 25])], field, { range: 20 })).toBeNull()
  })

  it('behind a wall is ignored; a drone in sight in the box is picked instead', () => {
    const wall = boxes(GROUND, [[126, 63.5, 110], [130, 72, 111]])
    expect(pick([t(1, [128, 66, 100])], wall)).toBeNull()
    const p = pick([t(1, [128, 66, 100]), t(2, [132, 66, 100])], wall, { halfPx: 150 })
    expect(p?.target).toBe(2)
  })

  it('a drone in front of the most central one takes the shot, so it is the one picked', () => {
    // The rear drone sits dead centre; the front one is a little off, but its sphere covers the line.
    const p = pick([t(1, [128, 65.75, 90]), t(2, [128.2, 65.8, 110], 0.6)])
    expect(p?.target).toBe(2)
  })

  it('the aim points from the eye at the drone\'s centre, in the look\'s terms', () => {
    const p = pick([t(1, [131, 70, 100])], field, { halfPx: W })
    expect(p?.aim).toEqual(lookAtScreen(EYE, [131, 70, 100]))
  })
})

/** A variant whose waves spawn nothing (the tests place drones by hand). */
function quiet(): DroneRunVariant {
  const v = variant()
  v.spec.waves = v.spec.waves.map((w) => ({ ...w, spawns: [] }))
  return v
}

/** A run on the test field, out of the start zone and standing, with drones placed at `at`. */
function standing(v: DroneRunVariant, solids: Solids, at: Vec3[] = []): RunState {
  const st = createRun(v, solids, { level: testLevel(), seed: 1 })
  while (st.phase === 'safe') stepRun(st, input({ move: { fwd: 1, strafe: 0 } }))
  for (let i = 0; i < 60; i++) stepRun(st, input())
  for (const p of at) st.drones.push(makeDrone(st.ids.next++, v.spec.enemies, 0, p, eyeOf(st.body, v.spec.player), st.rng.drones))
  return st
}

function eye(st: RunState): Vec3 {
  return eyeOf(st.body, st.world.variant.spec.player)
}

describe('auto-fire', () => {
  it('fires the PULSE RIFLE at a drone in the box, and the shot hits', () => {
    const st = standing(quiet(), field)
    const e = eye(st)
    st.drones.push(makeDrone(st.ids.next++, st.world.variant.spec.enemies, 0, [e[0] + 0.6, e[1] + 1, e[2] - 30], e, st.rng.drones))
    const inp = input()
    const p = applyAssist(st, inp, { halfPx: HALF, camera: cameraAt(e, 0, 0), width: W, height: H })
    expect(p).not.toBeNull()
    expect(inp.fire).toBe(true)
    expect(inp.aim).toBeDefined()
    expect(assistState.target).toBe(p!.target)
    stepRun(st, inp)
    expect(st.events.some((x) => x.type === 'hit')).toBe(true)
  })

  it('never for ARC SCATTER or CHARGE RAIL, in hand or being switched to', () => {
    for (const w of [1, 2]) {
      const st = standing(quiet(), field)
      const e = eye(st)
      st.drones.push(makeDrone(st.ids.next++, st.world.variant.spec.enemies, 0, [e[0], e[1] + 1, e[2] - 30], e, st.rng.drones))
      const cam = { halfPx: HALF, camera: cameraAt(e, 0, 0), width: W, height: H }
      // Switching to it this step.
      const sw = input({ select: w })
      expect(applyAssist(st, sw, cam)).toBeNull()
      expect(sw.fire).toBe(false)
      stepRun(st, sw)
      // In hand.
      const inp = input()
      expect(applyAssist(st, inp, cam)).toBeNull()
      expect(inp.fire).toBe(false)
      expect(inp.aim).toBeUndefined()
      // Switching back to the PULSE RIFLE this step: it is the gun that fires.
      const back = input({ select: 0 })
      expect(applyAssist(st, back, cam)).not.toBeNull()
    }
  })

  it('only while the box is shown (the HUD sets it on touch screens; null is off)', () => {
    const st = standing(quiet(), field)
    const e = eye(st)
    st.drones.push(makeDrone(st.ids.next++, st.world.variant.spec.enemies, 0, [e[0], e[1] + 1, e[2] - 30], e, st.rng.drones))
    setAssistView(cameraAt(e, 0, 0), W, H)
    const off = input()
    expect(applyAssist(st, off)).toBeNull()
    expect(off.fire).toBe(false)
    setAssistBox(HALF)
    const on = input()
    expect(applyAssist(st, on)?.target).toBe(st.drones[0].id)
    expect(on.fire).toBe(true)
    setAssistBox(null)
    expect(assistState.target).toBeNull()
    const off2 = input()
    expect(applyAssist(st, off2)).toBeNull()
    expect(off2.fire).toBe(false)
  })

  it('an overheated gun stays quiet: the assist asks, the simulation refuses', () => {
    const st = standing(quiet(), field)
    const e = eye(st)
    st.drones.push(makeDrone(st.ids.next++, st.world.variant.spec.enemies, 0, [e[0], e[1] + 1, e[2] - 30], e, st.rng.drones))
    st.arsenal.guns[0].lock = 1
    const inp = input()
    applyAssist(st, inp, { halfPx: HALF, camera: cameraAt(e, 0, 0), width: W, height: H })
    expect(inp.fire).toBe(true)
    stepRun(st, inp)
    expect(st.events.some((x) => x.type === 'shot')).toBe(false)
  })

  it('never through a wall: a drone behind one is not fired at', () => {
    const wall = boxes(GROUND)
    const st0 = standing(quiet(), wall)
    const e = eye(st0)
    const solids = boxes(GROUND, [[e[0] - 8, 63.5, e[2] - 12], [e[0] + 8, e[1] + 6, e[2] - 11]])
    const st = standing(quiet(), solids)
    const e2 = eye(st)
    st.drones.push(makeDrone(st.ids.next++, st.world.variant.spec.enemies, 0, [e2[0], e2[1] + 1, e2[2] - 30], e2, st.rng.drones))
    const inp = input()
    expect(applyAssist(st, inp, { halfPx: HALF, camera: cameraAt(e2, 0, 0), width: W, height: H })).toBeNull()
    expect(inp.fire).toBe(false)
  })

  it('aims from the eye after this step\'s move: the copy of the body moves exactly as the run will', () => {
    const st = standing(quiet(), field)
    const inp = input({ move: { fwd: 1, strafe: 0.5 }, jump: true })
    const predicted = eyeAfterStep(st, inp)
    stepRun(st, inp)
    expect(eye(st)).toEqual(predicted)
  })
})

/** A wave of scouts and swarmers coming at the player from ahead, with hedges to fly round. */
function busy(seed: number): DroneRunVariant {
  const v = variant()
  // The seed moves the spawn points about too: on an open field, scouts and swarmers draw few random numbers.
  const dx = ((seed * 7) % 21) - 10, dz = ((seed * 5) % 11) - 5
  v.spec.waves[0] = {
    id: 'busy', name: 'busy', seed, maxAlive: 10, spawns: [
      { at: [118 + dx, 80, 150 + dz], enemy: 'scout', count: 6, delayS: 0.5, every: 1.2 },
      { at: [140 - dx, 76, 145 - dz], enemy: 'swarmer', count: 8, delayS: 2, every: 0.4 },
      { at: [128 + dx / 2, 84, 140 + dz], enemy: 'scout', count: 4, delayS: 4, every: 1.5 },
    ],
  }
  return v
}
const hedges = boxes(GROUND, [[112, 63.5, 160], [122, 67, 161]], [[132, 63.5, 150], [142, 68, 151]], [[124, 63.5, 135], [127, 70, 138]])

/** Plays a busy wave with the assist on; the player strafes and hops, and the look drifts after the drones. Returns counts. */
function playAssisted(seed: number, steps: number) {
  const st = createRun(busy(seed), hedges, { level: testLevel(), seed })
  let yaw = 0, pitch = 0.15
  let assistedShots = 0, assistedHits = 0, fired = 0
  const log: RunInput[] = []
  for (let i = 0; i < steps && (st.phase === 'safe' || st.phase === 'wave'); i++) {
    const out = st.phase === 'safe' || st.waveStep < 30
    const inp = input({ move: { fwd: out ? 1 : 0, strafe: out ? 0 : Math.sin(i / 70) }, yaw, pitch, jump: !out && i % 90 === 0 })
    const e = eye(st)
    applyAssist(st, inp, { halfPx: HALF, camera: cameraAt(e, yaw, pitch), width: W, height: H })
    log.push(JSON.parse(JSON.stringify(inp)) as RunInput)
    stepRun(st, inp)
    const shots = st.events.filter((x) => x.type === 'shot').length
    if (inp.aim) {
      assistedShots += shots
      assistedHits += st.events.filter((x) => x.type === 'hit').length
    }
    fired += shots
    // The look follows the nearest drone, a little off and lagging, as a thumb would.
    if (st.drones.length) {
      const near = [...st.drones].sort((a, b) => Math.hypot(a.pos[0] - e[0], a.pos[1] - e[1], a.pos[2] - e[2]) - Math.hypot(b.pos[0] - e[0], b.pos[1] - e[1], b.pos[2] - e[2]))[0]
      const want = lookAtScreen(e, [near.pos[0] + Math.sin(i / 23 + seed) * 2, near.pos[1] + Math.cos(i / 31 + seed), near.pos[2]])
      let dy = want.yaw - yaw
      dy = Math.atan2(Math.sin(dy), Math.cos(dy))
      yaw += dy * 0.12
      pitch += (want.pitch - pitch) * 0.12
    }
  }
  return { st, assistedShots, assistedHits, fired, log }
}

describe('every assisted shot hits', () => {
  it('against moving scouts and swarmers, over several seeds', () => {
    let total = 0
    for (const seed of [1, 2, 3, 4]) {
      const r = playAssisted(seed, 60 * 30)
      expect(r.assistedHits).toBe(r.assistedShots)
      expect(r.assistedShots).toBeGreaterThan(20)
      total += r.assistedShots
      let kills = 0
      for (const k in r.st.kills) kills += r.st.kills[k]
      expect(kills).toBeGreaterThan(0)
    }
    expect(total).toBeGreaterThan(100)
  })

  it('a run with assisted aims replays exactly from its input log', () => {
    const r = playAssisted(2, 60 * 20)
    expect(r.log.some((x) => x.aim)).toBe(true)
    const again = createRun(busy(2), hedges, { level: testLevel(), seed: 2 })
    for (const inp of r.log) stepRun(again, inp)
    expect(stateHash(again)).toBe(stateHash(r.st))
  })
})

describe('in the runner', () => {
  it('each step\'s input is touched by the assist before it is stepped, and the log of stepped inputs replays to the same hash', () => {
    const v = busy(3)
    const stepped: RunInput[] = []
    let yaw = 0
    let runner: DroneRunner | null = null
    const cam = new PerspectiveCamera(55, W / H, 0.05, 600)
    const read = (): RunInput => {
      // The canvas: the camera at the eye, looking where the input looks.
      if (runner) {
        const st = runner.state
        const e = eye(st)
        if (st.drones.length) yaw += (lookAtScreen(e, st.drones[0].pos).yaw - yaw) * 0.08
        toRender(e, cam.position)
        cam.rotation.set(0.1, cameraYaw(yaw), 0, 'YXZ')
        cam.updateMatrixWorld()
        setAssistView(cam, W, H)
      }
      const out = runner && runner.state.phase === 'safe'
      return input({ move: { fwd: out || runner === null ? 1 : 0, strafe: 0 }, yaw, pitch: 0.1 })
    }
    setAssistBox(HALF)
    runner = new DroneRunner(v, hedges, { level: testLevel(), seed: 3, hud: false, input: read, assist: (st, inp) => { applyAssist(st, inp); stepped.push(JSON.parse(JSON.stringify(inp)) as RunInput) } })
    for (let k = 0; k < 60 * 15; k++) runner.frame(1 / 60)
    expect(stepped.some((x) => x.aim && x.fire)).toBe(true)
    const again = createRun(v, hedges, { level: testLevel(), seed: 3 })
    for (const inp of stepped) stepRun(again, inp)
    expect(stateHash(again)).toBe(runner.hash())
  })

  it('with the box never set (a desktop), the runner fires only when told', () => {
    const v = busy(3)
    let fired = 0
    const r = new DroneRunner(v, hedges, { level: testLevel(), seed: 3, hud: false, input: () => input({ move: { fwd: 0.3, strafe: 0 }, yaw: 0, pitch: 0.1 }) })
    setAssistView(cameraAt(EYE, 0, 0.1), W, H)
    for (let k = 0; k < 60 * 10; k++) { r.frame(1 / 60); fired += r.state.events.filter((x) => x.type === 'shot').length }
    expect(r.state.drones.length + Object.keys(r.state.kills).length).toBeGreaterThan(0)
    expect(fired).toBe(0)
  })
})
