/**
 * animMotion.ts: an object's `anim` drawn on the shared paced clock
 * (lib/anim.ts for the motions, lib/pacedClock.ts and lib/pacedSource.ts for
 * the clock). Used by ShardMesh, so a shard moves wherever it is drawn: in
 * the world, as a part of another object, as the model an item wears, and in
 * a card's turning preview (inside its turntable).
 *
 * Each frame: one shared clock reading, each motion's phase, the per-object
 * ease when what the clock knows changes (§2.4), the motions composed into
 * one matrix, and that matrix written into a group above the mesh. The
 * motion is in the object's own model frame; a world shard's geometry is
 * already turned by its pose (ShardMesh `pose`, lib/pose.ts renderPose G),
 * so the group carries G · A · Gᵀ, which moves the posed geometry exactly as
 * A moves the unposed one. Nothing is allocated per frame.
 *
 * Holds still at phase 0 (the motion's rest pose; for turn, swing, slide and
 * lift that is the object as written) whenever the viewer prefers reduced
 * motion, or β is not known yet (pacedSource: never guess). Leaving either
 * eases into the true pose, the shortest way round, as a clock change does.
 */

import { createElement, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Plane, Vector3, type Group } from 'three'
import { composeRender, motionPose, newPose, phaseAt, smoothstep, type Motion, type MotionPose } from '../lib/anim'
import { easeSeconds, wrapHalf } from '../lib/pacedClock'
import { noteMoving, readPaced, type PacedReading } from '../lib/pacedSource'
import type { Box } from '../lib/clip'

// ---- reduced motion, one listener for the whole page -------------------------

let reducedQuery: MediaQueryList | null | undefined
let reduced = false
/** Whether the viewer prefers reduced motion, read each frame: one media query and one listener for the whole page. */
export function reducedMotionNow(): boolean {
  if (reducedQuery === undefined) {
    try { reducedQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null } catch { reducedQuery = null }
    reduced = reducedQuery?.matches ?? false
    reducedQuery?.addEventListener?.('change', () => { reduced = reducedQuery?.matches ?? false })
  }
  return reduced
}

// ---- who is moving, per canvas ---------------------------------------------------

const moving = new WeakMap<object, number>()

/**
 * How many objects with motion this canvas (its renderer) has mounted. A
 * canvas that draws on demand (the workshop's bench) asks for every frame
 * while this is above zero.
 */
export function movingOn(gl: object): number {
  return moving.get(gl) ?? 0
}

// ---- per-object phases with the ease -------------------------------------------

/** One object's phase state, allocated once per mounted object. */
export interface PhaseState {
  shown: Float64Array
  err: Float64Array
  start: Float64Array
  len: Float64Array
  /** What the phases were last worked from: the clock's version, whether known, whether held by reduced motion; -1 before the first frame. */
  version: number
  known: boolean
  held: boolean
}

export function newPhaseState(n: number): PhaseState {
  return { shown: new Float64Array(n), err: new Float64Array(n), start: new Float64Array(n), len: new Float64Array(n), version: -1, known: false, held: false }
}

/**
 * The phase each motion is shown at, written into `st.shown`. Pure but for
 * `st`: the eases live there.
 *
 * - Reduced motion: phase 0 at once, no ease (holding still is the point).
 * - β not known: phase 0, eased into from wherever it was.
 * - Otherwise the true phase, eased into whenever the clock's version or
 *   knowledge changed since the last frame (§2.4): the error wrapped to the
 *   shortest way round, over min(3 s, max(0.5 s, |e| × P)).
 * - The first frame draws the true pose at once.
 */
export function stepPhases(motions: readonly Motion[], r: PacedReading, reduced: boolean, st: PhaseState): void {
  const n = motions.length
  if (reduced) {
    for (let i = 0; i < n; i++) { st.shown[i] = 0; st.err[i] = 0; st.len[i] = 0 }
    st.held = true
    st.version = r.version
    st.known = r.known
    return
  }
  const first = st.version === -1
  const changed = !first && (st.version !== r.version || st.known !== r.known || st.held)
  for (let i = 0; i < n; i++) {
    const m = motions[i]
    const truth = r.known && !m.tooFast ? phaseAt(m, r.beta) : 0
    if (changed) {
      const e = wrapHalf(truth - st.shown[i])
      const period = m.c !== 0 ? (r.secondsPerBlock * m.b) / Math.abs(m.c) : 0
      st.err[i] = e
      st.start[i] = r.nowS
      st.len[i] = e === 0 ? 0 : easeSeconds(e, period)
    }
    let shown = truth
    if (st.len[i] > 0) {
      const tau = (r.nowS - st.start[i]) / st.len[i]
      if (tau >= 1 || tau < 0) st.len[i] = 0
      else shown = truth - st.err[i] * (1 - smoothstep(tau))
    }
    shown -= Math.floor(shown)
    st.shown[i] = shown
  }
  st.version = r.version
  st.known = r.known
  st.held = false
}

// ---- the matrix ------------------------------------------------------------------

/** c = a · b, 4x4 column-major, into `out` (which may not alias a or b). */
function mul4(a: ArrayLike<number>, b: ArrayLike<number>, out: Float64Array): void {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  }
}

/**
 * The matrix an object's group carries for these shown phases: the motions
 * composed in the render frame (lib/anim.ts composeRender), conjugated by the
 * pose turn `g` (column-major, a pure turn) when there is one.
 */
export function animMatrix(motions: readonly Motion[], phases: ArrayLike<number>, poses: MotionPose[], g: ArrayLike<number> | null, gT: ArrayLike<number> | null, scratch: Scratch, out: Float64Array | number[]): void {
  for (let i = 0; i < motions.length; i++) motionPose(motions[i], phases[i], poses[i])
  if (!g || !gT) { composeRender(poses, motions.length, out); return }
  composeRender(poses, motions.length, scratch.a)
  mul4(g, scratch.a, scratch.b)
  mul4(scratch.b, gT, scratch.c)
  for (let k = 0; k < 16; k++) out[k] = scratch.c[k]
}

/** Three 4x4s of working space, made once per object. */
export interface Scratch { a: Float64Array; b: Float64Array; c: Float64Array }
export function newScratch(): Scratch {
  return { a: new Float64Array(16), b: new Float64Array(16), c: new Float64Array(16) }
}

/** A box's six walls as planes that keep its inside, in its own frame. */
function wallsOf(b: Box): Plane[] {
  const out: Plane[] = []
  for (let k = 0; k < 3; k++) {
    const n = [0, 0, 0]
    n[k] = 1
    out.push(new Plane(new Vector3(n[0], n[1], n[2]), -b.min[k]))
    n[k] = -1
    out.push(new Plane(new Vector3(n[0], n[1], n[2]), b.max[k]))
  }
  return out
}

/** A region box's walls, in the frame it is given in, and their world-space twins the materials read (kept current by AnimGroups). */
export interface ClipWalls { local: Plane[]; world: Plane[] }
export function clipWalls(b: Box): ClipWalls {
  const local = wallsOf(b)
  return { local, world: local.map((p) => p.clone()) }
}

/**
 * The two groups above a moving object, and the per-frame work that moves
 * it. Mounted by ShardMesh only for an object with motion, so a still one
 * pays nothing. `pose` is the render-frame turn its geometry was drawn with
 * (column-major), or null; `walls` its region box (in the frame of the outer
 * group) as planes, which this keeps current in world space: a moving object
 * is cut where it is at each moment, on the GPU, not once where it rests.
 *
 * The inner group is marked `ambientMotion`, so the main view's frame gate
 * (lib/frameGate.ts) does not take its every-frame motion for activity: a
 * spinner moves at the idle rate.
 */
export function AnimGroups({ motions, pose, walls, children }: { motions: readonly Motion[]; pose: ArrayLike<number> | null; walls: ClipWalls | null; children: ReactNode }): JSX.Element {
  const outer = useRef<Group>(null)
  const inner = useRef<Group>(null)
  const n = motions.length
  const st = useMemo(() => newPhaseState(n), [n, motions])
  const poses = useMemo(() => Array.from({ length: n }, newPose), [n])
  const scratch = useMemo(newScratch, [])
  const g = useMemo(() => (pose ? Float64Array.from(pose) : null), [pose])
  const gT = useMemo(() => {
    if (!g) return null
    const t = new Float64Array(16)
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[c * 4 + r] = g[r * 4 + c]
    return t
  }, [g])
  const gl = useThree((s) => s.gl)
  useEffect(() => { if (walls) gl.localClippingEnabled = true }, [gl, walls])
  useEffect(() => {
    noteMoving(1)
    moving.set(gl, movingOn(gl) + 1)
    return () => { noteMoving(-1); moving.set(gl, Math.max(0, movingOn(gl) - 1)) }
  }, [gl])
  useFrame((state) => {
    const group = inner.current
    if (!group) return
    const r = readPaced(state.clock, state.clock.elapsedTime)
    stepPhases(motions, r, reducedMotionNow(), st)
    animMatrix(motions, st.shown, poses, g, gT, scratch, group.matrix.elements)
    group.matrixWorldNeedsUpdate = true
    if (walls && outer.current) {
      outer.current.updateWorldMatrix(true, false)
      for (let i = 0; i < walls.local.length; i++) walls.world[i].copy(walls.local[i]).applyMatrix4(outer.current.matrixWorld)
    }
  })
  return createElement('group', { ref: outer }, createElement('group', { ref: inner, matrixAutoUpdate: false, 'userData-ambientMotion': true }, children))
}
