/**
 * WorldShards.tsx — the shards placed in cyberspace, drawn where they sit.
 *
 * Each shard renders at its own coordinate, at its own unit scale: one model
 * unit is 2^unit gibsons, which at the current zoom is 2^(unit - scaleExp)
 * render cells. So a shard hidden at a fine unit is a speck until you zoom in
 * to it, and a monument at a coarse unit fills the view from far off, which is
 * the honest picture. Culled past the same reach as Earth and the spawn mark.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { followsVersion, onFollows, readFollows, trustedPlacement } from '../lib/trust'
import { useFrame } from '@react-three/fiber'
import type { Group, Material, Object3D } from 'three'
import { GRID_RADIUS, itemCentre, type Position, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useCeremony } from '../store/useCeremony'
import { editingId, useShards, type WorldItem } from '../store/useShards'
import { WALL_BREATH_SECONDS } from './Rooms'
import { WalkContactHint } from './WalkContactHint'
import { glowReachDoublings } from '../lib/pointLook'
import { ShardMesh } from './ShardMesh'
import { GHOST_OPACITY } from './shardFaces'
import { regionBox, type Box } from '../lib/clip'
import { placedPose, type Pose } from '../lib/pose'
import { neededExtent, type ShardModel } from 'sno-core/shards'
import { CULL_EXTENT_MIN, TapTarget, farCullDoublings } from './TapTarget'
import { drawnByMark, passesTaps } from '../tutorial/guideBags'
import { useMutes } from '../store/useMutes'
import { useBuildDimmed } from './BuildOccluders'
import { useDrawReach } from './buildZoom'
import { GhostGlow } from './PointBillboards'
import { softModel } from './softPick'

const REACH = GRID_RADIUS * 8
/** Past this many doublings out from its unit, a shard of the usual size with no placed objects can never be seen (TapTarget farCullDoublings). */
const FAR_CULL = farCullDoublings()

/**
 * How far a shard really reaches from its origin, in its own units. Its declared
 * `extent` is advisory (DECK-0003 §1.8), so a tiny object declaring 4,096 would
 * otherwise stay in the draw list thousands of cells out. Its points are what
 * count, and a walk over them is kept for as long as the model is.
 */
const reaches = new WeakMap<ShardModel, number>()
function drawnExtent(shard: ShardModel): number {
  let r = reaches.get(shard)
  if (r === undefined) reaches.set(shard, (r = Math.min(shard.extent, neededExtent(shard))))
  return r
}

/** How far a shard can stretch from its centre in the render frame: the corner of what it holds, at its scale. */
export function shardReach(shard: ShardModel, scale: number): number {
  return Math.sqrt(3) * drawnExtent(shard) * scale
}

/**
 * How near the render origin a placed shard can come: its centre's distance
 * less its reach. The centre alone is not enough on a large grid: standing
 * inside a shard 4,096 units across, its centre can be far past the reach
 * while the shard stands all around you (review of #555).
 */
export function nearEdge(w: Pick<PlacedShardDraw, 'centre' | 'shard' | 'scale'>): number {
  return Math.max(0, Math.hypot(...w.centre) - shardReach(w.shard, w.scale))
}

/** The far cull for this shard: its own bound past the usual size (TapTarget farCullDoublings). */
function farCullFor(shard: ShardModel): number {
  const e = drawnExtent(shard)
  return e > CULL_EXTENT_MIN ? farCullDoublings(e) : FAR_CULL
}

/**
 * A shard being moved by EDIT stays where it stands while the ghost shows
 * where it is going, breathing between these opacities on the WALK walls'
 * cycle (Rooms.tsx WALL_BREATH_SECONDS), so the two are never confused
 * (arkinox, 2026-10-16: "fades in and out slowly, same speed as grid during
 * WALK mode").
 */
const MOVING_LOW = 0.08
/** ShardMesh's opacity for a ghost, which the moving shard is drawn as. */
const MOVING_HIGH = 0.7

/** This frame's opacity for the moving shard, read by `breathe`. */
let breath = MOVING_HIGH

/** One object of the moving shard at this frame's breath; hoisted, so a frame allocates nothing. */
function breathe(obj: Object3D): void {
  const m = (obj as { material?: Material | Material[] }).material
  if (!m) return
  if (Array.isArray(m)) m.forEach(breatheOne)
  else breatheOne(m)
}

function breatheOne(one: Material): void {
  breatheMaterial(one, breath)
}

/**
 * One material of a moving shard at breath `b`.
 *
 * The points' disc shader has its own opacity uniform (pointDisc.ts), dimmer
 * for the dots on a solid or lined shard: that ratio is kept. Its material is
 * made again whenever its shard's opacity changes, so the ratio it holds is
 * never stale.
 *
 * Faces and lines keep their materials across edits, so nothing is cached on
 * them: each breathes at its own shard's opacity (DECK-0003 §1.11), which
 * ShardMesh writes on the material as `userData.share`. Its own shard, not the
 * moving one: the traverse reaches every placed part, and a 30% water part in
 * a solid room breathes at 30% of the breath, never at the room's (review of
 * #452). A material without one (a placeholder) breathes at the breath.
 */
export function breatheMaterial(one: Material, b: number): void {
  const u = (one as { uniforms?: Record<string, { value: unknown }> }).uniforms?.uOpacity
  if (u) {
    one.userData.baseOpacity ??= u.value as number
    u.value = b * ((one.userData.baseOpacity as number) / GHOST_OPACITY)
  } else {
    const share = one.userData.share
    one.opacity = b * (typeof share === 'number' ? share : 1)
  }
}

/** The moving shard's opacity at `seconds`: a raised cosine, as the walls breathe. */
export function movingOpacity(seconds: number): number {
  const breath = 0.5 - 0.5 * Math.cos((2 * Math.PI * seconds) / WALL_BREATH_SECONDS)
  return MOVING_LOW + (MOVING_HIGH - MOVING_LOW) * breath
}

interface Props {
  axes: ViewAxes
}

/** One shard as the scene draws it: where, how big, sealed to what, and turned how. */
export interface PlacedShardDraw {
  key: string
  shard: ShardModel
  /** Whose object it draws (the object's author, else the bag's). */
  author?: string
  /** Who put it there: the bag's signer. The scene's budget trusts a shard only when both are trusted (lib/trust.ts). */
  container?: string
  centre: [number, number, number]
  scale: number
  clip: ReturnType<typeof regionBox>
  pose: Pose
}

/**
 * Where and how a hidden shard is drawn, in the render frame anchored at
 * `origin` and turned to the view frame `axes`.
 *
 * Every part of the answer goes through `axes`: the place (itemCentre), the
 * clip box (regionBox) and the shape (placedPose). A view turn therefore
 * turns the whole scene as one rigid thing. The shape used to skip it unless
 * the shard stood on the Earth, so a turn moved each shard's place but left
 * its shape facing the old way (pose.ts placedPose).
 */
export function placeShard(
  w: Pick<WorldItem, 'key' | 'at' | 'height' | 'plane'> & Partial<Pick<WorldItem, 'author'>> & { shard?: ShardModel },
  origin: Position, scaleExp: number, axes: ViewAxes,
): PlacedShardDraw {
  const shard = w.shard!
  // At its true place, at every zoom (itemCentre): a scene of many
  // shards keeps its layout as you zoom out.
  const centre = itemCentre(w.at, origin, scaleExp, axes)
  // 2^(unit - scaleExp) render cells per model unit, in fixed point so
  // the ratio survives past a double at large separations of the two.
  const exp = shard.unit - scaleExp
  const scale = exp >= 0 ? Number(1n << BigInt(exp)) : 1 / Number(1n << BigInt(-exp))
  // Sealed to one cube of side 2^height: nothing of it is drawn outside.
  // In the shard's own frame, so the cut, and the shape, is the same
  // at every zoom; the ghost is sealed the same way.
  const clip = regionBox(w.at, w.height, shard.unit, axes)
  // Standing on the ground, if that is how it was hidden. The pose is
  // derived from the bag's own position, so every finder computes the
  // same one without anything extra on the wire beyond `up` and `spin`.
  // Dataspace only: cyberspace has no planet to stand on. Either way in
  // the view frame, so the shape turns with its place.
  const pose = placedPose(axes, shard.up && w.plane === 0 ? { at: w.at, spin: shard.spin } : undefined)
  const author = shard.author ?? w.author
  return { key: w.key, shard, ...(author ? { author } : {}), ...(w.author ? { container: w.author } : {}), centre, scale, clip, pose }
}

/**
 * The shards of `items` that can be drawn from here: in the view's plane, not
 * too small to show a pixel at any distance, and within `reach` of the render
 * origin (REACH, or further as the fog's end needs). Placed in the
 * render frame anchored at `anchor`. Cyberspace TV draws its own finds with
 * this (TvFinds).
 */
export function drawableShards(items: Array<Pick<WorldItem, 'key' | 'type' | 'at' | 'height' | 'plane'> & Partial<Pick<WorldItem, 'author'>> & { shard?: ShardModel }>, anchor: Position, plane: number, scaleExp: number, axes: ViewAxes, reach = REACH): PlacedShardDraw[] {
  const origin = alignedOrigin(anchor, scaleExp)
  return items
    .filter((w) => w.type === 'shard' && w.shard && w.plane === plane)
    // Not drawn at all once it cannot show a pixel at any distance; a shard
    // with placed objects is exempt, since they can be far larger than it.
    // A glow reaches past its points (DECK-0003 §1.16 SHOULD keep it visible): its radius widens the cull.
    .filter((w) => (w.shard!.parts?.length ?? 0) > 0 || scaleExp - w.shard!.unit < farCullFor(w.shard!) + glowReachDoublings(w.shard!))
    .map((w) => placeShard(w, origin, scaleExp, axes))
    .filter((w) => Number.isFinite(w.scale) && nearEdge(w) <= reach)
}

/** Two clip boxes that cut the same. */
export function sameBox(a: Box, b: Box): boolean {
  return a.min[0] === b.min[0] && a.min[1] === b.min[1] && a.min[2] === b.min[2] && a.max[0] === b.max[0] && a.max[1] === b.max[1] && a.max[2] === b.max[2]
}

/** Two poses that turn a shape the same. */
export function samePose(a: Pose, b: Pose): boolean {
  if (a === b) return true
  for (let i = 0; i < 9; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * The placements again, each keeping the very clip box and pose it was given
 * last time while they are the same in value (2026-10-23).
 *
 * Every move of your own (a WALK step, a HOP that lands, a spectated jump)
 * changes the anchor, and placing the shards again made a new box and a new
 * pose object for every one of them, equal to the old ones: neither depends on
 * the anchor, only on where the shard sits and the view's axes. ShardMesh
 * keys its cut (clipMesh), its winding and all its GPU buffers on those two
 * objects, so every shard in reach was cut again and sent to the GPU again on
 * every step: about 110 buffers and 0.8 MB a step among the Maze Kit rooms,
 * with 150 to 450 ms of main thread stopped each time, and 218 KB of garbage
 * a frame while walking (arkinox, 2026-10-23: "I'm getting some freezes
 * intermittently while just navigating through onosendai"). Only where it is
 * drawn (`centre`) follows the anchor, and that is a transform, not a cut.
 */
export function steadied(prev: ReadonlyMap<string, PlacedShardDraw>, fresh: readonly PlacedShardDraw[]): PlacedShardDraw[] {
  return fresh.map((w) => {
    const was = prev.get(w.key)
    if (!was || was.shard !== w.shard) return w
    const clip = sameBox(was.clip, w.clip) ? was.clip : w.clip
    const pose = samePose(was.pose, w.pose) ? was.pose : w.pose
    return clip === w.clip && pose === w.pose ? w : { ...w, clip, pose }
  })
}

/** `steadied` against what this component placed last time. */
export function useSteadied(fresh: readonly PlacedShardDraw[]): PlacedShardDraw[] {
  const kept = useRef<ReadonlyMap<string, PlacedShardDraw>>(new Map())
  return useMemo(() => {
    const out = steadied(kept.current, fresh)
    kept.current = new Map(out.map((w) => [w.key, w]))
    return out
  }, [fresh])
}

export function WorldShards({ axes }: Props): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  // Subscribed so the set re-renders when a deploy or a discovery lands.
  const mine = useShards((s) => s.mine)
  const discovered = useShards((s) => s.discovered)
  // The tour's district shows only its curators' things (DemoScene.curated).
  const curated = useShards((s) => s.curated)
  // A block or a mute hides what it names (store/useMutes).
  const muted = useMutes((s) => s.muted)
  const births = useCeremony((s) => s.births)
  const moving = useShards((s) => editingId(s.pending))
  // Whom you follow: the scene's budget trusts them as yours (scene/meshBudget.ts).
  useSyncExternalStore(onFollows, followsVersion)
  // Read again for whoever is signed in: a login after this mounted, or another identity.
  const me = useCyberspace((s) => s.identity.pubkey)
  useEffect(() => { readFollows() }, [me])

  // As far as the fog's end needs (buildZoom.ts).
  const reach = useDrawReach((s) => Math.max(REACH, s.reach))
  // Kept as far as the reach went lately (keptReach): a shard past the reach
  // now is hidden, not taken down, so coming back into reach shows it again
  // with nothing built.
  const keep = useKeptReach(reach)
  const fresh = useMemo(() => {
    return drawableShards(useShards.getState().drawnItems(), anchor, anchorPlane, scaleExp, axes, keep)
    // mine and discovered are what worldShards reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, anchorPlane, scaleExp, axes, mine, discovered, curated, muted, keep])
  // Past the reach, only what is mounted already stays: nothing new is built
  // where it cannot be seen (review: new shards out to the kept reach would
  // be built hidden, and the edge where shards are built and taken down
  // would only move outwards).
  const mounted = useRef<ReadonlySet<string>>(new Set())
  // A move keeps each shard's cut and GPU buffers: only its place changes (steadied).
  const placed = useSteadied(useMemo(() => keptWithin(fresh, reach, KEEP_HIDDEN_MAX, mounted.current), [fresh, reach]))
  useEffect(() => { mounted.current = new Set(placed.map((w) => w.key)) }, [placed])

  if (placed.length === 0) return null

  return (
    <>
      {placed.map((w) => <PlacedShard key={w.key} w={w} birth={births[w.key]} moving={w.key === moving} occludes hidden={nearEdge(w) > reach} />)}
    </>
  )
}

/**
 * How long a reach the draw went out to is kept for: shards out to it stay
 * mounted, hidden, while the reach is smaller.
 *
 * The reach follows the camera (Scene.tsx SceneFog): out in an orbit, in at
 * the eye in WALK. Going into WALK took every shard past WALK's reach down,
 * and coming out built them all again; on the owner's phone that was the
 * scene going from 2,477 objects to 959 and back, megabytes of buffers sent
 * to the GPU again and long frames each time (diag of 2026-11-22). Walking,
 * a shard at the edge of the reach was taken down and built again at every
 * crossing of it.
 */
export const KEEP_MS = 300_000
/** The most shards kept hidden past the reach, nearest first: the GPU memory they hold is bounded. */
export const KEEP_HIDDEN_MAX = 400

/**
 * The reach to keep shards mounted to: the largest one this went out to, held
 * for KEEP_MS from the moment the reach first fell below it (`since`), never
 * less than `reach`. From the fall, not from the last render: the scene does
 * not render while you sit still, and five idle minutes in an orbit would
 * otherwise let it go at WALK's first render.
 */
export interface KeptReach { reach: number; since: number | null }
export function keptReach(was: KeptReach | null, reach: number, now: number): KeptReach {
  if (!was || reach >= was.reach) return { reach, since: null }
  if (was.since === null) return { reach: was.reach, since: now }
  return now - was.since > KEEP_MS ? { reach, since: null } : was
}

function useKeptReach(reach: number): number {
  const kept = useRef<KeptReach | null>(null)
  kept.current = keptReach(kept.current, reach, Date.now())
  return kept.current.reach
}

/**
 * Every shard within `reach`, and up to `max` more past it, nearest first,
 * of those already mounted (`mounted`, by key). A shard past the reach keeps
 * its place in the scene's budget (meshBudget, nearest first): it is further
 * than every shard on show, so it is served after them.
 */
export function keptWithin(placed: PlacedShardDraw[], reach: number, max: number, mounted: ReadonlySet<string>): PlacedShardDraw[] {
  const near: PlacedShardDraw[] = []
  const far: Array<{ w: PlacedShardDraw; d: number }> = []
  for (const w of placed) {
    const d = nearEdge(w)
    if (d <= reach) near.push(w)
    else if (mounted.has(w.key)) far.push({ w, d })
  }
  if (far.length === 0 && near.length === placed.length) return placed
  if (far.length === 0) return near
  if (far.length > max) far.sort((a, b) => a.d - b.d).length = max
  const keep = new Set<PlacedShardDraw>(near)
  for (const f of far) keep.add(f.w)
  return placed.filter((w) => keep.has(w))
}

/**
 * One shard in the world, and the tap target that is exactly what it draws:
 * measured from the drawn group, and off while it is too small to see
 * (TapTarget; arkinox, 2026-09-30). Cyberspace TV's have no tap target, and
 * hand their drawn group to TV, which sets how they look each frame (TvFinds).
 * The world's own (`occludes`) dim while they block the build cursor
 * (BuildOccluders), except the one EDIT is moving, and take no taps while
 * dimmed, so a tap reaches what is behind them.
 */
export function PlacedShard({ w, birth, moving = false, tappable = true, drawnRef, occludes = false, hidden: farHidden = false }: { w: PlacedShardDraw; birth: number | undefined; moving?: boolean; tappable?: boolean; drawnRef?: (g: Group | null) => void; occludes?: boolean; hidden?: boolean }): JSX.Element {
  // Step 1's green box is drawn by the tour's own mark in its place (scene/TutorialTarget.tsx).
  const hidden = farHidden || drawnByMark(w.key)
  // A landing moves the anchor, and with it every shard's centre: only this
  // group's position follows it. What the shard draws keeps its props, so
  // React skips it (PlacedShardBody), as it skips its GPU buffers (steadied).
  // Written during render on purpose: the same value every time for a shard
  // that places nothing, and this render's centre for one that does.
  const told = useRef(w.centre)
  told.current = budgetCentre(told.current, w.centre, w.shard)
  return (
    // Hidden: past the reach, kept mounted (WorldShards keptReach) and drawn nowhere, taking no taps.
    <group position={w.centre} visible={!hidden}>
      <PlacedShardBody shardKey={w.key} shard={w.shard} trusted={trustedPlacement(w.container, w.author)} scale={w.scale} clip={w.clip} pose={w.pose} centre={told.current} birth={birth} moving={moving} tappable={tappable && !hidden && !passesTaps(w.key)} drawnRef={drawnRef} occludes={occludes && !hidden} />
    </group>
  )
}

/**
 * The centre a world shard tells the scene's budget (ShardMesh `budget`),
 * kept from `was` while it changes nothing there (arkinox, 2026-11-19: WALK
 * "unbearable" on his phone). Every landing moves the anchor and so every
 * shard's centre, and a new centre re-rendered every shard in the world, its
 * mesh, wall hint and tap target, two or three times a landing: at a spot of
 * a hundred shards that was most of what a landing cost the page. The budget
 * reads the centre only for placed objects: how near the shard is, to share
 * the scene's placements out nearest first, and where each of its own
 * placements stands, to keep the nearest (scene/meshBudget.ts, ShardMesh
 * budgeted). A shard that places nothing asks the budget for nothing, so the
 * distance it reports from its first centre, stale after a move, is never
 * read; one that places objects always has the new centre.
 */
export function budgetCentre(was: [number, number, number], now: [number, number, number], shard: ShardModel): [number, number, number] {
  return (shard.parts?.length ?? 0) > 0 ? now : was
}

interface PlacedShardBodyProps {
  shardKey: string
  shard: ShardModel
  /** Whether its placed objects draw from the trusted share (lib/trust.ts trustedPlacement): asked by the parent on each of its renders, as whom you follow changes. */
  trusted: boolean
  scale: number
  clip: Box
  pose: Pose
  /** Where it stands in the render frame, as its budget is told (budgetCentre). */
  centre: [number, number, number]
  birth: number | undefined
  moving: boolean
  /** It takes taps: false for TV's finds, and for a shard the tutorial lets taps through (passesTaps). */
  tappable: boolean
  drawnRef?: (g: Group | null) => void
  occludes: boolean
}

/** What a placed shard draws, at the place its parent group puts it: re-rendered only when one of its own props changes. */
const PlacedShardBody = memo(function PlacedShardBody({ shardKey, shard, trusted, scale, clip, pose, centre, birth, moving, tappable, drawnRef, occludes }: PlacedShardBodyProps): JSX.Element {
  const drawn = useRef<Group | null>(null)
  const setDrawn = useCallback((g: Group | null) => { drawn.current = g; drawnRef?.(g) }, [drawnRef])
  const dim = useBuildDimmed(occludes && !moving ? shardKey : undefined, drawn)
  // Its placed objects are drawn within the scene's budget, by trust and nearest first (scene/meshBudget.ts).
  const budget = useMemo(() => ({ key: shardKey, trusted, centre, scale }), [shardKey, trusted, centre, scale])
  const tap = useCallback(() => useShards.getState().selectSecret(shardKey), [shardKey])
  const softMoving = useMemo(() => moving && softModel(shard), [moving, shard])
  // Moving (EDIT): drawn as a ghost is, with ordinary blending, since a world
  // face writes its colour opaque whatever its opacity (ShardMesh TAG_BLEND),
  // and every material's opacity follows the breath each frame.
  useFrame((state) => {
    if (!moving || !drawn.current) return
    breath = movingOpacity(state.clock.elapsedTime)
    drawn.current.traverse(breathe)
  })
  return (
    <>
      <group ref={setDrawn}>
        {/* Moving a shard that is only points, fog or glow: its glow always drawn and its box outlined over everything, as the placing ghost's (softPick.tsx). */}
        <GhostGlow always={moving && softMoving}>
          <ShardMesh shard={shard} scale={scale} birth={birth} world ghost={moving} noBloom={moving} softOutline={moving} clip={clip} pose={pose} budget={budget} dim={moving ? 1 : dim} />
        </GhostGlow>
      </group>
      {/* A wall you cannot see, outlined for a moment after it stopped your walk (store/wallHint.ts). */}
      <WalkContactHint shardKey={shardKey} shard={shard} scale={scale} clip={clip} pose={pose} />
      {/* Not tappable while it moves: the ghost is the one being aimed. */}
      {/* Dimmed in build mode, a tap passes through it (BuildOccluders tapsPassThrough). */}
      {!moving && tappable && <TapTarget measure={drawn} occluder={occludes ? shardKey : undefined} onTap={tap} />}
    </>
  )
})
