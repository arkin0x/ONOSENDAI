/**
 * BuildOccluders.tsx - in build mode, the shards between the camera and the
 * build cursor are dimmed, so what is being placed inside or around a
 * structure can be seen (arkinox, 2026-11-08).
 *
 * Only while the Builder is on (useBuilder `active`, BUILD and DEPLOY alike),
 * never in WALK or the ordinary view. Which shards block is lib/occluders.ts:
 * rays from the camera to the cursor's cell, its centre and its corners,
 * against the shards' own faces, within PICK_BUDGET_MS. Asked at most every RECOMPUTE_MS, and only
 * when the camera, the cursor, the zoom, the view or the set of shards has
 * changed, or an avatar has moved, a frame after the change so every matrix
 * it reads has been drawn.
 *
 * A blocking shard is drawn at DIM of its own opacity through ShardMesh's
 * `dim`, see-through as a shard of that opacity is (shardFaces.ts). The dim
 * prop changes only at the two ends of a fade, a render at each and none
 * between;
 * the FADE_MS between is written straight onto the materials, from the share
 * ShardMesh keeps on each (`userData.share`, as WorldShards' EDIT breath reads
 * it), so no geometry, buffer or material is made again while it fades. A
 * shard comes back only after HOLD_MS of not blocking (occluders settleDimmed),
 * so it does not flicker as the cursor steps along an edge.
 *
 * Taps pass through a dimmed shard (arkinox, 2026-11-09): while it is dimmed
 * in BUILD or DEPLOY its tap target takes no rays (TapTarget `occluder`,
 * tapsPassThrough), so a tap reaches whatever is behind it: a shard, a chest,
 * an item, an avatar, or nothing, which toggles the controls as any empty tap
 * does. Asked at the tap from the store, never held in React state, so there
 * is no render to flicker and nothing left over when the Builder closes. Not
 * dimmed, it takes its taps as before.
 *
 * Avatars, yours and everyone else's, dim the same way while they block the
 * cursor (Avatar, OtherAvatar): the same picker, DIM and fade. They register
 * only while the Builder is on, since outside it an avatar is never
 * see-through (ShardMesh `ignoreOpacity`, DECK-0003 §3.3), and as movers,
 * since one may glide or turn with nothing else changing (useBuildDim
 * occludersMoved). An avatar drawn as the marker, a cage of lines, never
 * blocks, as lines never do.
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3, type Group, type Material, type Object3D } from 'three'
import { aimCentres, type ViewAxes } from '../lib/space'
import { cubeAt } from '../lib/buildCursor'
import { cellPoints, fadeToward, nineVectors, pickWithin, settleDimmed, type OccluderTarget } from '../lib/occluders'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { occluderTargets, occludersMoved, occluderVersion, registerOccluder, setDimmed, useBuildDim } from '../store/useBuildDim'

/** The share of its own opacity a blocking shard is drawn at. */
export const DIM = 0.2
/** How long a shard takes to dim, or to come back, ms. */
export const FADE_MS = 150
/** How long a shard keeps dimmed after it stops blocking, ms: the hysteresis. */
export const HOLD_MS = 120
/** The most often the blocking shards are worked out, ms. */
export const RECOMPUTE_MS = 50
/**
 * The most one cast may take, ms: a backstop, far over what a cast costs
 * (well under a millisecond with several 5,000 face shards round the line of
 * sight, lib/occluders.ts). Past it, the rest waits for the next cast.
 */
export const PICK_BUDGET_MS = 3
/** How far the camera may drift, in render cells, before the rays are cast again. */
const EYE_EPSILON = 1e-3

/**
 * Whether the scene dims what blocks the cursor now: the Builder on, and not
 * in WALK, where the cursor is the eye itself.
 */
export function dimsOccluders(builderActive: boolean, walking: boolean): boolean {
  return builderActive && !walking
}

/**
 * Whether a tap passes through the target registered under `key` now: it is
 * dimmed, and the scene dims at all. Read at the tap, from the stores, so a
 * dimmed set left behind by a Builder that has closed (or a key never
 * dimmed) takes its taps as ever.
 */
export function tapsPassThrough(key: string | undefined): boolean {
  if (key === undefined || !useBuildDim.getState().dimmed.has(key)) return false
  return dimsOccluders(useBuilder.getState().active, useCyberspace.getState().walking)
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
 * no dimming at all. `moves`: it glides or turns on its own (an avatar), so
 * the picker watches it move (useBuildDim occludersMoved).
 *
 * Two renders a cycle and no more: one when it starts to block (drawn at DIM,
 * see-through), one when it has faded back to full (drawn opaque again).
 * Whether it blocks is followed by a subscription into a ref, not a selector,
 * so stopping blocking re-renders nothing: the fade back runs on the frame.
 */
export function useBuildDimmed(key: string | undefined, group: RefObject<Object3D | null>, moves = false): number {
  useEffect(() => {
    const g = group.current
    return key !== undefined && g ? registerOccluder(key, g, moves) : undefined
  }, [key, group, moves])
  // Drawn at DIM: from when it starts to block until it is back at full.
  const [drawDim, setDrawDim] = useState(false)
  const drawing = useRef(drawDim)
  drawing.current = drawDim
  const dim = key !== undefined && drawDim ? DIM : 1
  // What the materials were last drawn with: a fade waits for the dim to land.
  const drawnAt = useRef(1)
  useLayoutEffect(() => { drawnAt.current = dim }, [dim])
  // Whether it blocks now, and how far its fade has got.
  const wanted = useRef(false)
  const level = useRef(1)
  useEffect(() => {
    if (key === undefined) { wanted.current = false; level.current = 1; setDrawDim(false); return }
    const follow = (s: { dimmed: ReadonlySet<string> }): void => {
      wanted.current = s.dimmed.has(key)
      if (wanted.current) setDrawDim(true)
    }
    follow(useBuildDim.getState())
    return useBuildDim.subscribe(follow)
  }, [key])

  useFrame((_, delta) => {
    if (key === undefined) return
    const target = wanted.current ? DIM : 1
    // At rest. Back at full and still drawn dim (it stopped blocking before it was ever drawn dim): let go.
    if (level.current === target) { if (target === 1 && drawing.current) setDrawDim(false); return }
    // Not drawn see-through yet: the dim lands on the next render.
    if (drawnAt.current !== DIM) { if (target === 1) level.current = 1; return }
    const g = group.current
    if (!g) return
    level.current = fadeToward(level.current, target, delta * 1000, FADE_MS, 1 - DIM)
    fadeK = level.current / DIM
    g.traverse(fadeObject)
    // Back to full: drawn opaque again on the next render, where it already stands.
    if (target === 1 && level.current === 1) setDrawDim(false)
  })
  return dim
}

/**
 * An avatar that may block the build cursor: registered as `avatar:<name>`,
 * a mover, only while the scene dims (the Builder on, not in WALK) and a
 * name is given, and the `dim` to draw it at. Anywhere else no key, so an
 * avatar is never see-through outside the Builder (DECK-0003 §3.3). The key
 * goes to its tap target too, so a dimmed avatar is tapped through.
 */
export function useAvatarOccluder(name: string | undefined, drawn: RefObject<Object3D | null>): { occluder: string | undefined; dim: number } {
  const building = useBuilder((s) => s.active)
  const walking = useCyberspace((s) => s.walking)
  const occluder = name !== undefined && dimsOccluders(building, walking) ? `avatar:${name}` : undefined
  const dim = useBuildDimmed(occluder, drawn, true)
  return { occluder, dim }
}

/** When to cast: the frame count, the frame a change was first seen (-1 for none), the last cast and a recheck time. */
export interface CastClock {
  frames: number
  dirtyAt: number
  computed: number
  recheck: number
}

/**
 * Whether to cast on this frame, `moved` saying whether anything the cast
 * reads changed since the last one, and the clock moved on. A change is cast
 * a frame after it is seen, once a render has moved every matrix to match; a
 * cast on a frame that itself moved read the matrices of the frame before, so
 * it leaves the clock dirty for one more (review of #618). At most one cast
 * per `everyMs`; a pending recheck (a hold running out) casts on its own.
 */
export function castNow(c: CastClock, moved: boolean, now: number, everyMs: number): boolean {
  c.frames++
  if (moved && c.dirtyAt < 0) c.dirtyAt = c.frames
  const due = (c.dirtyAt >= 0 && c.frames > c.dirtyAt) || now >= c.recheck
  if (!due || now - c.computed < everyMs) return false
  c.dirtyAt = moved ? c.frames : -1
  c.computed = now
  c.recheck = Infinity
  return true
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
  const last = useRef({ cursor: null as unknown, anchor: null as unknown, scaleExp: NaN, axes: null as unknown, version: -1, targets: [] as OccluderTarget[], next: 0, blocking: new Set<string>() as ReadonlySet<string>, computed: -Infinity, dirtyAt: -1, frames: 0, recheck: Infinity })

  useEffect(() => {
    // Unmounted while on: nothing is left dimmed behind it.
    if (on) return () => setDimmed(new Set())
    seen.current.clear()
    last.current.cursor = null
    last.current.blocking = new Set()
    lastEye.set(NaN, NaN, NaN)
    setDimmed(new Set())
  }, [on])

  useFrame((state) => {
    const g = frame.current
    if (!on || !g) return
    const l = last.current
    const s = useCyberspace.getState()
    const live = cubeAt(s, true)
    eye.setFromMatrixPosition(state.camera.matrixWorld)
    const now = performance.now()
    const version = occluderVersion()
    // Movers first, so each frame's look at them is taken whatever else moved.
    const glided = occludersMoved()
    const moved = glided || live !== l.cursor || s.anchor !== l.anchor || s.scaleExp !== l.scaleExp || axes !== l.axes || version !== l.version || Number.isNaN(lastEye.x) || eye.distanceToSquared(lastEye) > EYE_EPSILON * EYE_EPSILON
    if (moved) {
      l.cursor = live; l.anchor = s.anchor; l.scaleExp = s.scaleExp; l.axes = axes
      lastEye.copy(eye)
    }
    if (version !== l.version) { l.version = version; l.targets = [...occluderTargets()] }
    if (!castNow(l, moved, now, RECOMPUTE_MS)) return
    const c = aimCentres(live, alignedOrigin(s.anchor, s.scaleExp), s.scaleExp, axes).cell
    cell.set(c[0], c[1], c[2]).applyMatrix4(g.matrixWorld)
    cellPoints(cell, points)
    // Within a budget: past it, the shards not reached keep what they were, and the next cast starts where this one stopped.
    const picked = pickWithin(l.targets, eye, points, { budgetMs: PICK_BUDGET_MS, start: l.next, carry: l.blocking })
    l.next = picked.next
    l.blocking = picked.blocking
    if (!picked.done && l.dirtyAt < 0) l.dirtyAt = l.frames
    const dimmed = settleDimmed(seen.current, picked.blocking, now, HOLD_MS)
    // A shard held past its blocking needs one more look once its hold is up.
    l.recheck = dimmed.size > picked.blocking.size ? now + HOLD_MS + 1 : Infinity
    setDimmed(dimmed)
  })

  // The render frame's own group, so the cell is carried into world space as the shards are.
  return on ? <group ref={frame} /> : null
}
