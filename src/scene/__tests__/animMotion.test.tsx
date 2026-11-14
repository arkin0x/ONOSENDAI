/**
 * animMotion.test.tsx: a shard whose payload carries `anim` moves in a real
 * R3F root (test/r3fRoot.ts) on the paced clock: the group above it carries
 * the motion's pose at β, a world shard's pose turn is folded round it, it
 * holds still while β is not known and eases into place when it becomes
 * known, a malformed `anim` draws the shard exactly as before, and reduced
 * motion holds it at phase 0 (stepPhases). The clock is fed by hand
 * (pacedSource feedPaced); nothing is fetched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { Group, Matrix4, Vector3, type Object3D } from 'three'
import { newShard, toRender, type ShardModel } from 'sno-core/shards'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { ShardMesh } from '../ShardMesh'
import { feedPaced, readPaced, resetPaced } from '../../lib/pacedSource'
import { EPOCH_END_TIME, pacedHeight } from '../../lib/pacedClock'
import { phaseAt, readAnim } from '../../lib/anim'
import { newPhaseState, stepPhases } from '../animMotion'
import { applyPose, frameAt, poseMatrix, type Pose } from '../../lib/pose'

const A482 = 1_793_300_370
const ENDS = [EPOCH_END_TIME, A482]
/** 2026-11-10 04:11:02 UTC, the note's worked example. */
const T = Date.UTC(2026, 10, 10, 4, 11, 2)
const TIP = { height: 975_255, time: T / 1000 - 300 }

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

/** Where the group puts render point (1, 0, 0), i.e. model +X. */
const carried = (g: Group): Vector3 => new Vector3(1, 0, 0).applyMatrix4(g.matrix)

let r: R3fRoot | null = null
beforeEach(() => {
  resetPaced()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T)
  // Eases are timed by the monotonic clock; here it runs with the faked wall clock.
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - T + 1000)
})
afterEach(async () => {
  await r?.unmount()
  r = null
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetPaced()
})

describe('a shard with anim in the scene', () => {
  it('turns to its pose at β: the note\'s 100-per-block platform at 162.5 degrees', async () => {
    feedPaced({ ends: ENDS, tip: TIP })
    r = await r3fRoot()
    await r.render(createElement(ShardMesh, { shard: hoop([['turn', 'y', 100, 1, 0]]), world: true }))
    await r.frame()
    const g = motionGroup(r.state().scene)
    expect(g).not.toBeNull()
    // The frame gate leaves its every-frame motion out of what counts as activity (lib/frameGate.ts).
    expect(g!.userData.ambientMotion).toBe(true)
    const beta = pacedHeight(T / 1000, ENDS)
    const angle = phaseAt({ c: 100, b: 1, phi: 0 }, beta) * 2 * Math.PI
    const p = carried(g!)
    // Model +X turned right-handed about +Y by θ: (cos θ, 0, −sin θ) in the model, z negated in the render frame.
    expect(p.x).toBeCloseTo(Math.cos(angle), 6)
    expect(p.z).toBeCloseTo(Math.sin(angle), 6)
    expect(angle * 180 / Math.PI).toBeCloseTo(162.4647, 2)
    // A second later it is further round: 100 / T_482 of a turn a second.
    vi.setSystemTime(T + 1000)
    await r.frame()
    const angle2 = phaseAt({ c: 100, b: 1, phi: 0 }, pacedHeight(T / 1000 + 1, ENDS)) * 2 * Math.PI
    expect(carried(g!).x).toBeCloseTo(Math.cos(angle2), 6)
    expect(Math.abs(angle2 - angle)).toBeGreaterThan(0.1)
  })

  it('holds still while β is not known, then eases into its pose when it is', async () => {
    r = await r3fRoot()
    await r.render(createElement(ShardMesh, { shard: hoop([['turn', 'y', 100, 1, 0]]), world: true }))
    await r.frame()
    const g = motionGroup(r.state().scene)!
    expect(g.matrix.equals(new Matrix4())).toBe(true)
    vi.setSystemTime(T + 50)
    await r.frame()
    expect(g.matrix.equals(new Matrix4())).toBe(true)
    // The window ends and the tip arrive: an ease from rest, not a snap, and in place within 3 s.
    feedPaced({ ends: ENDS, tip: TIP })
    vi.setSystemTime(T + 100)
    await r.frame()
    const truth = phaseAt({ c: 100, b: 1, phi: 0 }, pacedHeight((T + 100) / 1000, ENDS)) * 2 * Math.PI
    expect(carried(g).x).not.toBeCloseTo(Math.cos(truth), 3)
    vi.setSystemTime(T + 3200)
    await r.frame()
    const later = phaseAt({ c: 100, b: 1, phi: 0 }, pacedHeight((T + 3200) / 1000, ENDS)) * 2 * Math.PI
    expect(carried(g).x).toBeCloseTo(Math.cos(later), 6)
    expect(carried(g).z).toBeCloseTo(Math.sin(later), 6)
  })

  it('folds a world shard\'s pose round its motion: G · A · Gᵀ, against the posed vertex turned in the model', async () => {
    feedPaced({ ends: ENDS, tip: TIP })
    // A shard standing on the Earth somewhere, facing 40 degrees: no symmetry to hide a swapped conjugation.
    const pose: Pose = poseMatrix(frameAt(37, -122), 40)
    r = await r3fRoot()
    await r.render(createElement(ShardMesh, { shard: hoop([['turn', 'y', 100, 1, 0]]), world: true, pose }))
    await r.frame()
    const g = motionGroup(r.state().scene)!
    const th = phaseAt({ c: 100, b: 1, phi: 0 }, pacedHeight(T / 1000, ENDS)) * 2 * Math.PI
    for (const v of [[120, 0, 0], [0, 0, 120], [37, 55, -80]] as Array<[number, number, number]>) {
      // Ground truth: turn the model vertex right-handed about model +Y, then pose it, then the render mapping.
      const turned: [number, number, number] = [v[0] * Math.cos(th) + v[2] * Math.sin(th), v[1], -v[0] * Math.sin(th) + v[2] * Math.cos(th)]
      const want = toRender(applyPose(pose, turned))
      // What is drawn: the posed vertex (the geometry ShardMesh builds), through the motion group.
      const drawn = new Vector3(...toRender(applyPose(pose, v))).applyMatrix4(g.matrix)
      expect(drawn.x).toBeCloseTo(want[0], 9)
      expect(drawn.y).toBeCloseTo(want[1], 9)
      expect(drawn.z).toBeCloseTo(want[2], 9)
    }
  })

  it('a malformed or unknown anim draws the shard exactly as before, with no motion group', async () => {
    feedPaced({ ends: ENDS, tip: TIP })
    r = await r3fRoot()
    await r.render(createElement(ShardMesh, { shard: hoop([['spin', 'y', 3, 1, 0], ['turn', 'q', 1, 1, 0], 'x']), world: true }))
    await r.frame()
    expect(motionGroup(r.state().scene)).toBeNull()
    expect(r.state().scene.getObjectByName('shard-faces')).toBeDefined()
  })

  it('still (the bench while editing, the feed\'s pictures) draws it as written', async () => {
    feedPaced({ ends: ENDS, tip: TIP })
    r = await r3fRoot()
    await r.render(createElement(ShardMesh, { shard: hoop([['turn', 'y', 100, 1, 0]]), world: true, still: true }))
    await r.frame()
    expect(motionGroup(r.state().scene)).toBeNull()
  })
})

describe('stepPhases', () => {
  const motions = readAnim([['turn', 'y', 100, 1, 0], ['slide', 'x', 120, 7, 1, 45]])
  const reading = (nowMs: number) => ({ ...readPaced({}, nowMs, nowMs, nowMs) })

  it('reduced motion holds every motion at phase 0, with no ease', () => {
    feedPaced({ ends: ENDS, tip: TIP })
    const st = newPhaseState(motions.length)
    stepPhases(motions, reading(T), false, st)
    expect(st.shown[0]).toBeGreaterThan(0)
    stepPhases(motions, reading(T + 16), true, st)
    expect([...st.shown]).toEqual([0, 0])
  })

  it('the first frame draws the true phase at once', () => {
    feedPaced({ ends: ENDS, tip: TIP })
    const st = newPhaseState(motions.length)
    const r0 = reading(T)
    stepPhases(motions, r0, false, st)
    expect(st.shown[0]).toBeCloseTo(phaseAt(motions[0], r0.beta), 9)
    expect(st.shown[1]).toBeCloseTo(phaseAt(motions[1], r0.beta), 9)
  })

  it('a clock change eases the shortest way round', () => {
    feedPaced({ ends: ENDS, tip: TIP })
    const st = newPhaseState(motions.length)
    stepPhases(motions, reading(T), false, st)
    // A skew of 10 s arrives: the true phase jumps; the shown one starts where it was.
    const before = st.shown[1]
    feedPaced({ skewMs: 10_000 })
    const r1 = reading(T + 16)
    stepPhases(motions, r1, false, st)
    expect(Math.abs(st.shown[1] - before)).toBeLessThan(0.01)
    expect(Math.abs(st.err[1])).toBeLessThanOrEqual(0.5)
  })
})
