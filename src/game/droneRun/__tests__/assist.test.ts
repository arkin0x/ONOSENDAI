/**
 * assist.test.ts - the touch aim assist (assist.ts): which drone it picks
 * (inside the box, most central, in front, in range, in sight), that it
 * fires only the assist gun and only while the box is shown, that every
 * shot it fires hits drones that are moving unless the simulation's assist
 * roll says miss (about 15% for the base PULSE RIFLE, sent visibly wide),
 * that it never fires through a wall, that its auto-fire can overheat the
 * rifle in a busy fight, and that a run with assisted aims replays exactly,
 * misses and all. No canvas, no relay.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

/** Counts the assist's own body steps (eyeAfterStep): the run steps its body through sim/player directly, so only the assist's calls go through here. */
const bodySteps = { n: 0 }
vi.mock('../../../lib/games/droneRun/sim', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/games/droneRun/sim')>()
  return { ...real, stepPlayer: (...a: Parameters<typeof real.stepPlayer>) => { bodySteps.n++; return real.stepPlayer(...a) } }
})
import { PerspectiveCamera } from 'three'
import { createRun, eyeOf, stepRun, stateHash, type DroneRunVariant, type RunInput, type RunState, type Solids, type Target, type Vec3 } from '../../../lib/games/droneRun/sim'
import { makeDrone } from '../../../lib/games/droneRun/sim/drones'
import { GROUND, boxes, input, testLevel, variant } from '../../../lib/games/droneRun/sim/__tests__/helpers'
import { anyNearBox, applyAssist, assistState, eyeAfterStep, pickAssistTarget, setAssistBox, setAssistView, type AssistAt } from '../assist'
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

/** The lens of a phone's camera in portrait, as Canvas3D hands it over: only the projection is read. */
const LENS = new PerspectiveCamera(55, W / H, 0.05, 600)
/** The box and the lens as the HUD and the canvas would set them. */
const AT: AssistAt = { halfPx: HALF, projection: LENS.projectionMatrix, width: W, height: H }

const EYE: Vec3 = [128, 65.75, 128]
const field = boxes(GROUND)
const t = (id: number, pos: Vec3, radius = 0.5): Target => ({ id, pos, radius, hp: 1 })

function pick(drones: Target[], solids: Solids = field, over: { yaw?: number; pitch?: number; halfPx?: number; range?: number } = {}) {
  return pickAssistTarget({ projection: LENS.projectionMatrix, width: W, height: H, halfPx: over.halfPx ?? HALF, eye: EYE, yaw: over.yaw ?? 0, pitch: over.pitch ?? 0, drones, range: over.range ?? 60, solids })
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
  it('fires the PULSE RIFLE at a drone in the box, and the shot hits (with the roll set to always hit: the aim is what is checked)', () => {
    const v = quiet()
    v.spec.weapons[0].assistHit = 1
    const st = standing(v, field)
    const e = eye(st)
    st.drones.push(makeDrone(st.ids.next++, st.world.variant.spec.enemies, 0, [e[0] + 0.6, e[1] + 1, e[2] - 30], e, st.rng.drones))
    const inp = input()
    const p = applyAssist(st, inp, AT)
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
      const cam = AT
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
    applyAssist(st, inp, AT)
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
    expect(applyAssist(st, inp, AT)).toBeNull()
    expect(inp.fire).toBe(false)
  })

  it('never for a gun whose mode is not auto, even if a variant slipped assist onto it (a semi gun latches, a charge gun never releases)', () => {
    for (const mode of ['semi', 'charge'] as const) {
      const st = standing(quiet(), field)
      const e = eye(st)
      st.drones.push(makeDrone(st.ids.next++, st.world.variant.spec.enemies, 0, [e[0], e[1] + 1, e[2] - 30], e, st.rng.drones))
      // createRun would refuse this variant; the assist refuses it on its own too.
      st.world.variant.spec.weapons[0].mode = mode
      const inp = input()
      expect(applyAssist(st, inp, AT)).toBeNull()
      expect(inp.fire).toBe(false)
      expect(inp.aim).toBeUndefined()
    }
  })

  it('one source: the box is the simulation\'s view (this step\'s eye and look), not the drawn camera', () => {
    const st = standing(quiet(), field)
    const e = eye(st)
    st.drones.push(makeDrone(st.ids.next++, st.world.variant.spec.enemies, 0, [e[0], e[1] + 1, e[2] - 30], e, st.rng.drones))
    setAssistBox(HALF)
    // The drawn camera turned right round and bobbed up: it does not matter, only its lens is read.
    setAssistView(cameraAt([e[0], e[1] + 0.3, e[2]], Math.PI, 0.4), W, H)
    expect(applyAssist(st, input({ yaw: 0, pitch: 0 }))?.target).toBe(st.drones[0].id)
    // The look turned away this step: nothing in the box, whatever the drawn camera shows.
    setAssistView(cameraAt(e, 0, 0), W, H)
    const away = input({ yaw: Math.PI / 2, pitch: 0 })
    expect(applyAssist(st, away)).toBeNull()
    expect(away.fire).toBe(false)
  })

  it('the body is stepped on a copy only when a drone is near the box', () => {
    const st = standing(quiet(), field)
    const e = eye(st)
    // Far out to the side: the cheap pass finds nothing, no copy of the body is stepped.
    st.drones.push(makeDrone(st.ids.next++, st.world.variant.spec.enemies, 0, [e[0] + 20, e[1], e[2] - 25], e, st.rng.drones))
    bodySteps.n = 0
    expect(applyAssist(st, input({ move: { fwd: 1, strafe: 0 } }), AT)).toBeNull()
    expect(bodySteps.n).toBe(0)
    // One in the box: one copy stepped, and it is picked.
    st.drones.push(makeDrone(st.ids.next++, st.world.variant.spec.enemies, 0, [e[0], e[1] + 1, e[2] - 30], e, st.rng.drones))
    expect(applyAssist(st, input({ move: { fwd: 1, strafe: 0 } }), AT)?.target).toBe(st.drones[1].id)
    expect(bodySteps.n).toBe(1)
  })

  it('the cheap pass widens the box by what a step\'s move can shift a drone, so it never drops one the exact pick would take', () => {
    const q = { projection: LENS.projectionMatrix, width: W, height: H, halfPx: HALF, eye: EYE, yaw: 0, pitch: 0, range: 60 }
    // Just outside the box from here, inside once the eye has slid 0.4 to the right (toward -X facing -Z).
    const d = t(1, [EYE[0] - 2.8, EYE[1], EYE[2] - 30])
    expect(pick([d])).toBeNull()
    const moved: Vec3 = [EYE[0] - 0.4, EYE[1], EYE[2]]
    expect(pickAssistTarget({ ...q, eye: moved, drones: [d], solids: field })?.target).toBe(1)
    expect(anyNearBox({ ...q, drones: [d] }, 0.5)).toBe(true)
    // Far off to the side, or out of range, it is dropped.
    expect(anyNearBox({ ...q, drones: [t(2, [EYE[0] + 20, EYE[1], EYE[2] - 25])] }, 0.5)).toBe(false)
    expect(anyNearBox({ ...q, drones: [t(3, [EYE[0], EYE[1], EYE[2] - 70])] }, 0.5)).toBe(false)
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
  let assistedShots = 0, assistedHits = 0, fired = 0, wide = 0, overheats = 0
  const log: RunInput[] = []
  /** The steps whose aimed shot went wide. */
  const wideAt: number[] = []
  for (let i = 0; i < steps && (st.phase === 'safe' || st.phase === 'wave'); i++) {
    const out = st.phase === 'safe' || st.waveStep < 30
    const inp = input({ move: { fwd: out ? 1 : 0, strafe: out ? 0 : Math.sin(i / 70) }, yaw, pitch, jump: !out && i % 90 === 0 })
    const e = eye(st)
    const pick = applyAssist(st, inp, AT)
    log.push(JSON.parse(JSON.stringify(inp)) as RunInput)
    stepRun(st, inp)
    const shots = st.events.filter((x) => x.type === 'shot')
    if (pick) {
      for (const sh of shots) {
        assistedShots++
        const hitIt = st.events.some((x) => x.type === 'hit' && x.drone === pick.target)
        if (sh.type === 'shot' && sh.wide) {
          wide++
          wideAt.push(st.step)
          // Wide: the drone it was aimed at is not hit.
          expect(hitIt).toBe(false)
        } else if (hitIt) assistedHits++
      }
    }
    overheats += st.events.filter((x) => x.type === 'overheated').length
    fired += shots.length
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
  return { st, assistedShots, assistedHits, fired, wide, wideAt, overheats, log }
}

describe('every assisted shot hits unless the simulation\'s roll says miss', () => {
  it('against moving scouts and swarmers, over several seeds: every shot the roll lets through hits, and about 85% do', () => {
    let total = 0, hits = 0, wide = 0, overheats = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = playAssisted(seed, 60 * 30)
      // A shot that is not wide hits the drone it was aimed at.
      expect(r.assistedHits).toBe(r.assistedShots - r.wide)
      expect(r.assistedShots).toBeGreaterThan(12)
      total += r.assistedShots; hits += r.assistedHits; wide += r.wide; overheats += r.overheats
      let kills = 0
      for (const k in r.st.kills) kills += r.st.kills[k]
      expect(kills).toBeGreaterThan(0)
    }
    expect(total).toBeGreaterThan(150)
    // 85% of the assisted shots hit, within a tolerance for the sample.
    expect(hits / total).toBeGreaterThan(0.78)
    expect(hits / total).toBeLessThan(0.92)
    expect(wide).toBeGreaterThan(0)
    // The auto-fire heats the rifle like any trigger: a busy fight trips the overheat.
    expect(overheats).toBeGreaterThan(0)
  })

  it('a run with assisted aims replays exactly from its input log, missing exactly the same shots', () => {
    const r = playAssisted(2, 60 * 20)
    expect(r.log.some((x) => x.aim)).toBe(true)
    expect(r.wideAt.length).toBeGreaterThan(0)
    const again = createRun(busy(2), hedges, { level: testLevel(), seed: 2 })
    const wideAgain: number[] = []
    for (const inp of r.log) {
      stepRun(again, inp)
      if (again.events.some((x) => x.type === 'shot' && x.wide)) wideAgain.push(again.step)
    }
    expect(wideAgain).toEqual(r.wideAt)
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

  it('while a card is up (the run paused) no step runs, so the assist is never asked', () => {
    let asked = 0
    const r = new DroneRunner(busy(3), hedges, { level: testLevel(), seed: 3, hud: false, input: () => input({ move: { fwd: 1, strafe: 0 } }), assist: () => { asked++ } })
    for (let k = 0; k < 30; k++) r.frame(1 / 60)
    expect(asked).toBe(30)
    r.setPaused(true, 'card')
    for (let k = 0; k < 60; k++) expect(r.frame(1 / 60)).toBe(0)
    expect(asked).toBe(30)
    r.setPaused(false, 'card')
    r.frame(1 / 60)
    r.frame(1 / 60)
    expect(asked).toBeGreaterThan(30)
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
