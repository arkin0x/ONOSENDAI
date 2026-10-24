/**
 * WorldShards.tsx — the shards placed in cyberspace, drawn where they sit.
 *
 * Each shard renders at its own coordinate, at its own unit scale: one model
 * unit is 2^unit gibsons, which at the current zoom is 2^(unit - scaleExp)
 * render cells. So a shard hidden at a fine unit is a speck until you zoom in
 * to it, and a monument at a coarse unit fills the view from far off, which is
 * the honest picture. Culled past the same reach as Earth and the spawn mark.
 */

import { useCallback, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, Material, Object3D } from 'three'
import { GRID_RADIUS, itemCentre, type Position, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useCeremony } from '../store/useCeremony'
import { editingId, useShards, type WorldItem } from '../store/useShards'
import { WALL_BREATH_SECONDS } from './Rooms'
import { ShardMesh } from './ShardMesh'
import { GHOST_OPACITY } from './shardFaces'
import { regionBox, type Box } from '../lib/clip'
import { placedPose, type Pose } from '../lib/pose'
import type { ShardModel } from 'sno-core/shards'
import { TapTarget, farCullDoublings } from './TapTarget'
import { useMutes } from '../store/useMutes'

const REACH = GRID_RADIUS * 8
/** Past this many doublings out from its unit, a shard with no placed objects can never be seen (TapTarget farCullDoublings). */
const FAR_CULL = farCullDoublings()

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
  w: Pick<WorldItem, 'key' | 'at' | 'height' | 'plane'> & { shard?: ShardModel },
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
  return { key: w.key, shard, centre, scale, clip, pose }
}

/**
 * The shards of `items` that can be drawn from here: in the view's plane, not
 * too small to show a pixel at any distance, and in reach. Placed in the
 * render frame anchored at `anchor`. Cyberspace TV draws its own finds with
 * this (TvFinds).
 */
export function drawableShards(items: Array<Pick<WorldItem, 'key' | 'type' | 'at' | 'height' | 'plane'> & { shard?: ShardModel }>, anchor: Position, plane: number, scaleExp: number, axes: ViewAxes): PlacedShardDraw[] {
  const origin = alignedOrigin(anchor, scaleExp)
  return items
    .filter((w) => w.type === 'shard' && w.shard && w.plane === plane)
    // Not drawn at all once it cannot show a pixel at any distance; a shard
    // with placed objects is exempt, since they can be far larger than it.
    .filter((w) => (w.shard!.parts?.length ?? 0) > 0 || scaleExp - w.shard!.unit < FAR_CULL)
    .map((w) => placeShard(w, origin, scaleExp, axes))
    .filter((w) => Number.isFinite(w.scale) && Math.hypot(...w.centre) <= REACH)
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

  const fresh = useMemo(() => {
    return drawableShards(useShards.getState().worldItems(), anchor, anchorPlane, scaleExp, axes)
    // mine and discovered are what worldShards reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, anchorPlane, scaleExp, axes, mine, discovered, curated, muted])
  // A move keeps each shard's cut and GPU buffers: only its place changes (steadied).
  const placed = useSteadied(fresh)

  if (placed.length === 0) return null

  return (
    <>
      {placed.map((w) => <PlacedShard key={w.key} w={w} birth={births[w.key]} moving={w.key === moving} />)}
    </>
  )
}

/**
 * One shard in the world, and the tap target that is exactly what it draws:
 * measured from the drawn group, and off while it is too small to see
 * (TapTarget; arkinox, 2026-09-30). Cyberspace TV's have no tap target, and
 * hand their drawn group to TV, which sets how they look each frame (TvFinds).
 */
export function PlacedShard({ w, birth, moving = false, tappable = true, drawnRef }: { w: PlacedShardDraw; birth: number | undefined; moving?: boolean; tappable?: boolean; drawnRef?: (g: Group | null) => void }): JSX.Element {
  const drawn = useRef<Group | null>(null)
  const setDrawn = useCallback((g: Group | null) => { drawn.current = g; drawnRef?.(g) }, [drawnRef])
  // Moving (EDIT): drawn as a ghost is, with ordinary blending, since a world
  // face writes its colour opaque whatever its opacity (ShardMesh TAG_BLEND),
  // and every material's opacity follows the breath each frame.
  useFrame((state) => {
    if (!moving || !drawn.current) return
    breath = movingOpacity(state.clock.elapsedTime)
    drawn.current.traverse(breathe)
  })
  return (
    <group position={w.centre}>
      <group ref={setDrawn}>
        <ShardMesh shard={w.shard} scale={w.scale} birth={birth} world ghost={moving} clip={w.clip} pose={w.pose} />
      </group>
      {/* Not tappable while it moves: the ghost is the one being aimed. */}
      {!moving && tappable && <TapTarget measure={drawn} onTap={() => useShards.getState().selectSecret(w.key)} />}
    </group>
  )
}
