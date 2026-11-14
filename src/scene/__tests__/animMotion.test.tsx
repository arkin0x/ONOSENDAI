/**
 * animMotion.test.tsx: a shard whose payload carries `anim` moves in a real
 * R3F root (test/r3fRoot.ts) on the world clock: the group above it carries
 * the motion's pose at the Unix time, with no network at all (offline it
 * still moves), a world shard's pose turn is folded round it, a clock
 * correction eases rather than jumps, a malformed `anim` draws the shard
 * exactly as before, and reduced motion holds it at its shape as written
 * (stepPhases).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { Group, Vector3, type Object3D } from 'three'
import { newShard, toRender, type ShardModel } from 'sno-core/shards'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { ShardMesh } from '../ShardMesh'
import { readClock, resetWorldClock, setClockOffset } from '../../lib/worldClock'
import { phaseAt, readAnim } from '../../lib/anim'
import { newPhaseState, stepPhases } from '../animMotion'
import { applyPose, frameAt, poseMatrix, type Pose } from '../../lib/pose'

/** 2026-11-20 00:00:00 UTC, a whole number of 20-second cycles. */
const T = 1_795_132_800_000
const SPIN = [['turn', 'y', 1, 20, 0]]

function hoop(anim: unknown): ShardModel {
  return {
    ...newShard('Hoop'), unit: 0, mode: 'solid',
    vertices: [{ p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 1, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }],
    faces: [[0, 1, 2]],
    extra: { anim },
  } as ShardModel
}

/** The group the motion is written into: the one above the faces that R3F does not update itself. */
function motionGroup(scene: Object3D): Group | null {
  let found: Group | null = null
  scene.traverse((o) => { if (!found && o instanceof Group && !o.matrixAutoUpdate && o.children.some((c) => c.name === 'shard-faces' || c.children.some((d) => d.name === 'shard-faces'))) found = o })
  return found
}

/** Where the group puts render point (1, 0, 0). */
const carried = (g: Group): Vector3 => new Vector3(1, 0, 0).applyMatrix4(g.matrix)
/** The spin's angle at device time `ms`, corrected by `offsetMs`. */
const angleAt = (ms: number, offsetMs = 0): number => phaseAt({ c: 1, b: 20, phi: 0 }, (ms + offsetMs) / 1000) * 2 * Math.PI

let r: R3fRoot | null = null
beforeEach(() => {
  resetWorldClock()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T)
  // Eases are timed by the monotonic clock; here it runs with the faked wall clock.
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - T + 1000)
  // No network at all: anything that tries to measure the clock fails.
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
})
afterEach(async () => {
  await r?.unmount()
  r = null
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetWorldClock()
})

describe('a shard with anim in the scene', () => {
  it('turns to its pose at the Unix time, offline, with no clock data at all', async () => {
    r = await r3fRoot()
    await r.render(createElement(ShardMesh, { shard: hoop(SPIN), world: true }))
    await r.frame()
    const g = motionGroup(r.state().scene)
    expect(g).not.toBeNull()
    expect(g!.userData.ambientMotion).toBe(true)
    // A whole cycle: at rest's angle.
    expect(carried(g!).x).toBeCloseTo(1, 6)
    // 5 s on, a quarter turn: +X right-handed about +Y in the §2 frame (the render frame) goes to −Z.
    vi.setSystemTime(T + 5000)
    await r.frame()
    expect(carried(g!).x).toBeCloseTo(0, 6)
    expect(carried(g!).z).toBeCloseTo(-1, 6)
    vi.setSystemTime(T + 7000)
    await r.frame()
    expect(carried(g!).x).toBeCloseTo(Math.cos(angleAt(T + 7000)), 6)
    expect(carried(g!).z).toBeCloseTo(-Math.sin(angleAt(T + 7000)), 6)
  })

  it('a clock correction eases into the new time rather than jumping, in place within 3 s', async () => {
    r = await r3fRoot()
    await r.render(createElement(ShardMesh, { shard: hoop(SPIN), world: true }))
    await r.frame()
    const g = motionGroup(r.state().scene)!
    // The relay says the device is 5 s slow.
    setClockOffset(5000)
    vi.setSystemTime(T + 16)
    await r.frame()
    expect(carried(g).x).not.toBeCloseTo(Math.cos(angleAt(T + 16, 5000)), 2)
    vi.setSystemTime(T + 3200)
    await r.frame()
    expect(carried(g).x).toBeCloseTo(Math.cos(angleAt(T + 3200, 5000)), 6)
    expect(carried(g).z).toBeCloseTo(-Math.sin(angleAt(T + 3200, 5000)), 6)
  })

  it('folds a world shard\'s pose round its motion: G · A · Gᵀ, against the posed vertex turned in the model', async () => {
    // A shard standing on the Earth somewhere, facing 40 degrees: no symmetry to hide a swapped conjugation.
    const pose: Pose = poseMatrix(frameAt(37, -122), 40)
    vi.setSystemTime(T + 7000)
    r = await r3fRoot()
    await r.render(createElement(ShardMesh, { shard: hoop(SPIN), world: true, pose }))
    await r.frame()
    const g = motionGroup(r.state().scene)!
    const th = angleAt(T + 7000)
    for (const v of [[120, 0, 0], [0, 0, 120], [37, 55, -80]] as Array<[number, number, number]>) {
      // Ground truth: the vertex in the §2 frame (toRender, ×120), turned right-handed about +Y there,
      // back into sno-core's frame (z negated), then posed and drawn as ShardMesh draws any vertex.
      const p = toRender(v).map((x) => x * 120)
      const turned = [p[0] * Math.cos(th) + p[2] * Math.sin(th), p[1], -p[0] * Math.sin(th) + p[2] * Math.cos(th)]
      const want = toRender(applyPose(pose, [turned[0], turned[1], -turned[2]]))
      const drawn = new Vector3(...toRender(applyPose(pose, v))).applyMatrix4(g.matrix)
      expect(drawn.x).toBeCloseTo(want[0], 9)
      expect(drawn.y).toBeCloseTo(want[1], 9)
      expect(drawn.z).toBeCloseTo(want[2], 9)
    }
  })

  it('a malformed or unknown anim draws the shard exactly as before, with no motion group', async () => {
    r = await r3fRoot()
    await r.render(createElement(ShardMesh, { shard: hoop([['spin', 'y', 1, 20, 0], ['turn', 'q', 1, 1, 0], ['turn', 'y', 5, 1, 0], 'x']), world: true }))
    await r.frame()
    expect(motionGroup(r.state().scene)).toBeNull()
    expect(r.state().scene.getObjectByName('shard-faces')).toBeDefined()
  })

  it('still (the bench while editing, the feed\'s pictures) draws it as written', async () => {
    r = await r3fRoot()
    await r.render(createElement(ShardMesh, { shard: hoop(SPIN), world: true, still: true }))
    await r.frame()
    expect(motionGroup(r.state().scene)).toBeNull()
  })
})

describe('stepPhases', () => {
  const motions = readAnim([['turn', 'y', 1, 20, 0], ['slide', 'x', 120, 1, 7, 45]])
  const reading = (nowMs: number) => ({ ...readClock({}, nowMs, nowMs, nowMs) })

  it('reduced motion holds the shape as written (held), except for a time chosen by hand (the workshop\'s scrub)', () => {
    const st = newPhaseState(motions.length)
    stepPhases(motions, reading(T + 3000), false, st)
    expect(st.shown[0]).toBeGreaterThan(0)
    stepPhases(motions, reading(T + 3016), true, st)
    expect(st.held).toBe(true)
    expect([...st.shown]).toEqual([0, 0])
    stepPhases(motions, { ...reading(T + 3032), chosen: true }, true, st)
    expect(st.held).toBe(false)
    expect(st.shown[0]).toBeGreaterThan(0)
  })

  it('the first frame draws the true phase at once', () => {
    const st = newPhaseState(motions.length)
    const r0 = reading(T + 1234)
    stepPhases(motions, r0, false, st)
    expect(st.shown[0]).toBeCloseTo(phaseAt(motions[0], r0.t), 9)
    expect(st.shown[1]).toBeCloseTo(phaseAt(motions[1], r0.t), 9)
  })

  it('a correction eases the shortest way round', () => {
    const st = newPhaseState(motions.length)
    stepPhases(motions, reading(T), false, st)
    const before = st.shown[1]
    setClockOffset(10_000)
    stepPhases(motions, reading(T + 16), false, st)
    expect(Math.abs(st.shown[1] - before)).toBeLessThan(0.01)
    expect(Math.abs(st.err[1])).toBeLessThanOrEqual(0.5)
  })
})
