/**
 * WorldShards.tsx — the shards placed in cyberspace, drawn where they sit.
 *
 * Each shard renders at its own coordinate, at its own unit scale: one model
 * unit is 2^unit gibsons, which at the current zoom is 2^(unit - scaleExp)
 * render cells. So a shard hidden at a fine unit is a speck until you zoom in
 * to it, and a monument at a coarse unit fills the view from far off, which is
 * the honest picture. Culled past the same reach as Earth and the spawn mark.
 */

import { useMemo, useRef } from 'react'
import type { Group } from 'three'
import { GRID_RADIUS, itemCentre, type Position, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useCeremony } from '../store/useCeremony'
import { useShards, type WorldItem } from '../store/useShards'
import { ShardMesh } from './ShardMesh'
import { regionBox } from '../lib/clip'
import { placedPose, type Pose } from '../lib/pose'
import type { ShardModel } from 'sno-core/shards'
import { TapTarget, farCullDoublings } from './TapTarget'

const REACH = GRID_RADIUS * 8
/** Past this many doublings out from its unit, a shard with no placed objects can never be seen (TapTarget farCullDoublings). */
const FAR_CULL = farCullDoublings()

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

export function WorldShards({ axes }: Props): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  // Subscribed so the set re-renders when a deploy or a discovery lands.
  const mine = useShards((s) => s.mine)
  const discovered = useShards((s) => s.discovered)
  const births = useCeremony((s) => s.births)

  const placed = useMemo(() => {
    const origin = alignedOrigin(anchor, scaleExp)
    return useShards.getState().worldItems()
      .filter((w) => w.type === 'shard' && w.shard && w.plane === anchorPlane)
      // Not drawn at all once it cannot show a pixel at any distance; a shard
      // with placed objects is exempt, since they can be far larger than it.
      .filter((w) => (w.shard!.parts?.length ?? 0) > 0 || scaleExp - w.shard!.unit < FAR_CULL)
      .map((w) => placeShard(w, origin, scaleExp, axes))
      .filter((w) => Number.isFinite(w.scale) && Math.hypot(...w.centre) <= REACH)
    // mine and discovered are what worldShards reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, anchorPlane, scaleExp, axes, mine, discovered])

  if (placed.length === 0) return null

  return (
    <>
      {placed.map((w) => <PlacedShard key={w.key} w={w} birth={births[w.key]} />)}
    </>
  )
}

/**
 * One shard in the world, and the tap target that is exactly what it draws:
 * measured from the drawn group, and off while it is too small to see
 * (TapTarget; arkinox, 2026-09-30).
 */
function PlacedShard({ w, birth }: { w: PlacedShardDraw; birth: number | undefined }): JSX.Element {
  const drawn = useRef<Group>(null)
  return (
    <group position={w.centre}>
      <group ref={drawn}>
        <ShardMesh shard={w.shard} scale={w.scale} birth={birth} world clip={w.clip} pose={w.pose} />
      </group>
      <TapTarget measure={drawn} onTap={() => useShards.getState().selectSecret(w.key)} />
    </group>
  )
}
