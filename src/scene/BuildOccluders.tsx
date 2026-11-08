/**
 * BuildOccluders.tsx - in build mode, the shards between the camera and the
 * build cursor are dimmed, so what is being placed inside or around a
 * structure can be seen (arkinox, 2026-11-08).
 *
 * Only while the Builder is on (useBuilder `active`, BUILD and DEPLOY alike),
 * never in WALK or the ordinary view. Which shards block is lib/occluders.ts:
 * rays from the camera to the cursor's cell, its centre and its corners,
 * against the shards' own faces. Asked at most every RECOMPUTE_MS, and only
 * when the camera, the cursor, the zoom, the view or the set of shards has
 * changed, a frame after the change so every matrix it reads has been drawn.
 *
 * A blocking shard is drawn at DIM of its own opacity through ShardMesh's
 * `dim`, see-through as a shard of that opacity is (shardFaces.ts). The dim
 * prop changes only at the two ends of a fade, which is the one re-render;
 * the FADE_MS between is written straight onto the materials, from the share
 * ShardMesh keeps on each (`userData.share`, as WorldShards' EDIT breath reads
 * it), so no geometry, buffer or material is made again while it fades. A
 * shard comes back only after HOLD_MS of not blocking (occluders settleDimmed),
 * so it does not flicker as the cursor steps along an edge.
 *
 * Taps are left as they were: a dimmed shard still takes its own tap.
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3, type Group, type Material, type Object3D } from 'three'
import { aimCentres, type ViewAxes } from '../lib/space'
import { cubeAt } from '../lib/buildCursor'
import { cellPoints, fadeToward, nineVectors, pickOccluders, settleDimmed } from '../lib/occluders'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { occluderTargets, occluderVersion, registerOccluder, setDimmed, useBuildDim } from '../store/useBuildDim'

/** The share of its own opacity a blocking shard is drawn at. */
export const DIM = 0.2
/** How long a shard takes to dim, or to come back, ms. */
export const FADE_MS = 150
/** How long a shard keeps dimmed after it stops blocking, ms: the hysteresis. */
export const HOLD_MS = 120
/** The most often the blocking shards are worked out, ms. */
export const RECOMPUTE_MS = 50
/** How far the camera may drift, in render cells, before the rays are cast again. */
const EYE_EPSILON = 1e-3

/**
 * Whether the scene dims what blocks the cursor now: the Builder on, and not
 * in WALK, where the cursor is the eye itself.
 */
export function dimsOccluders(builderActive: boolean, walking: boolean): boolean {
  return builderActive && !walking
}

/** This fade step's multiplier, read by `fadeOne`; hoisted, so a frame allocates nothing. */
let fadeK = 1

function fadeObject(obj: Object3D): void {
  const m = (obj as { material?: Material | Material[] }).material
  if (!m) return
  if (Array.isArray(m)) m.forEach(fadeOne)
  else fadeOne(m)
}

function fadeOne(one: Material): void {
  fadeMaterial(one, fadeK)
}

/**
 * One material of a shard mid-fade, at `k` times what ShardMesh drew it at.
 *
 * Faces and lines carry their own share (`userData.share`, the opacity
 * ShardMesh gave them, dim included), so nothing is cached on them and the
 * last step lands exactly where the next render puts them. The points' disc
 * shader keeps its opacity in a uniform (pointDisc.ts) and its material is
 * made again whenever the dim changes, so the value it was made with is held
 * on it once. A material with neither (a placeholder's cube) is left alone.
 */
export function fadeMaterial(one: Material, k: number): void {
  const u = (one as { uniforms?: Record<string, { value: unknown }> }).uniforms?.uOpacity
  if (u) {
    one.userData.dimBase ??= u.value as number
    u.value = (one.userData.dimBase as number) * k
    return
  }
  const share = one.userData.share
  if (typeof share === 'number') one.opacity = Math.min(1, share * k)
}

/**
 * A shard that may block the build cursor: registers `group` under `key`
 * while `key` is given, and answers the `dim` to draw it at, fading the
 * materials in between. No key (a shard EDIT is moving, a door mid-ceremony),
 * no dimming at all.
 */
export function useBuildDimmed(key: string | undefined, group: RefObject<Object3D | null>): number {
  useEffect(() => {
    const g = group.current
    return key !== undefined && g ? registerOccluder(key, g) : undefined
  }, [key, group])
  const dimmed = useBuildDim((s) => key !== undefined && s.dimmed.has(key))
  // Kept dimmed while it fades back, so the fade runs on see-through materials.
  const [holding, setHolding] = useState(false)
  const dim = key !== undefined && (dimmed || holding) ? DIM : 1
  // What the materials were last drawn with: a fade waits for the dim to land.
  const drawnAt = useRef(1)
  useLayoutEffect(() => { drawnAt.current = dim }, [dim])
  const wanted = useRef(dimmed)
  wanted.current = dimmed
  const held = useRef(holding)
  held.current = holding
  const level = useRef(1)
  useEffect(() => {
    if (dimmed) setHolding(true)
    if (key === undefined) { setHolding(false); level.current = 1 }
  }, [dimmed, key])

  useFrame((_, delta) => {
    if (key === undefined) return
    const target = wanted.current ? DIM : 1
    // At rest. Back at full and still held (it stopped blocking before it was ever drawn dim): let go.
    if (level.current === target) { if (target === 1 && held.current) setHolding(false); return }
    // Not drawn see-through yet: the dim lands on the next render.
    if (drawnAt.current !== DIM) { if (target === 1) level.current = 1; return }
    const g = group.current
    if (!g) return
    level.current = fadeToward(level.current, target, delta * 1000, FADE_MS, 1 - DIM)
    fadeK = level.current / DIM
    g.traverse(fadeObject)
    // Back to full: drawn opaque again on the next render, where it already stands.
    if (target === 1 && level.current === 1) setHolding(false)
  })
  return dim
}

// Hoisted: nothing below allocates while nothing moves.
const eye = new Vector3()
const lastEye = new Vector3(NaN, NaN, NaN)
const cell = new Vector3()
const points = nineVectors()

/** Works out, while the Builder is on, which shards block the build cursor (lib/occluders.ts). */
export function BuildOccluders({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const active = useBuilder((s) => s.active)
  const walking = useCyberspace((s) => s.walking)
  const on = dimsOccluders(active, walking)
  const frame = useRef<Group>(null)
  const seen = useRef(new Map<string, number>())
  const last = useRef({ cursor: null as unknown, anchor: null as unknown, scaleExp: NaN, axes: null as unknown, version: -1, computed: -Infinity, dirtyAt: -1, frames: 0, recheck: Infinity })

  useEffect(() => {
    if (on) return
    seen.current.clear()
    last.current.cursor = null
    lastEye.set(NaN, NaN, NaN)
    setDimmed(new Set())
  }, [on])

  useFrame((state) => {
    const g = frame.current
    if (!on || !g) return
    const l = last.current
    l.frames++
    const s = useCyberspace.getState()
    const live = cubeAt(s, true)
    eye.setFromMatrixPosition(state.camera.matrixWorld)
    const now = performance.now()
    const moved = live !== l.cursor || s.anchor !== l.anchor || s.scaleExp !== l.scaleExp || axes !== l.axes || occluderVersion() !== l.version || Number.isNaN(lastEye.x) || eye.distanceToSquared(lastEye) > EYE_EPSILON * EYE_EPSILON
    if (moved) {
      l.cursor = live; l.anchor = s.anchor; l.scaleExp = s.scaleExp; l.axes = axes; l.version = occluderVersion()
      lastEye.copy(eye)
      // Cast a frame later, once this frame's render has moved every matrix to match.
      if (l.dirtyAt < 0) l.dirtyAt = l.frames
    }
    const due = (l.dirtyAt >= 0 && l.frames > l.dirtyAt) || now >= l.recheck
    if (!due || now - l.computed < RECOMPUTE_MS) return
    l.dirtyAt = -1
    l.computed = now
    const c = aimCentres(live, alignedOrigin(s.anchor, s.scaleExp), s.scaleExp, axes).cell
    cell.set(c[0], c[1], c[2]).applyMatrix4(g.matrixWorld)
    cellPoints(cell, points)
    const blocking = pickOccluders(occluderTargets(), eye, points)
    const dimmed = settleDimmed(seen.current, blocking, now, HOLD_MS)
    // A shard held past its blocking needs one more look once its hold is up.
    l.recheck = dimmed.size > blocking.size ? now + HOLD_MS + 1 : Infinity
    setDimmed(dimmed)
  })

  // The render frame's own group, so the cell is carried into world space as the shards are.
  return on ? <group ref={frame} /> : null
}
