/**
 * DoorCeremony.tsx: a door opening where it stands (lib/ceremony.ts has the
 * timeline; arkinox, 2026-10-30, door A: "the door slab decodes away upward
 * with the house static; WALK lets you through immediately; the room's
 * contents appear with the existing reveal effect; no loot float").
 *
 * The closed slab decodes away upward (ShardMesh `dissolve`), its faces
 * thinning first and its glowing points carrying the static up, as if it
 * slid up into the lintel; the open look, the slab's bottom rail, fades in
 * at the top of the doorway as the static clears (RailIn). By
 * then WALK has long let the walker through (store/walkWalls.ts), and what
 * is behind the door is appearing with the find ceremony where it stands
 * (hud/ItemRows openChestHere). The calm path fades one into the other.
 * Drawn in the door's own frame (LookMark); the camera never moves.
 */

import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, Material } from 'three'
import { DOOR_DISSOLVE_MS, DOOR_OPEN_AT, DOOR_RAIL_FADE_MS, dissolveShare } from '../lib/ceremony'
import type { Look } from '../lib/looks'
import { CalmSwap, meshFrame } from './ChestCeremony'
import type { LookFrame } from './LookMark'
import { breatheMaterial } from './WorldShards'
import { ShardMesh } from './ShardMesh'

export function DoorCeremony({ look, at, calm, frame }: { look: Look; at: number; calm: boolean; frame?: LookFrame }): JSX.Element {
  if (calm || !look.open) return <CalmSwap from={look.closed} to={look.open ?? look.closed} at={at} frame={frame} />
  return <SlabAway look={look} at={at} frame={frame} />
}

function SlabAway({ look, at, frame }: { look: Look; at: number; frame?: LookFrame }): JSX.Element {
  const slab = useRef<Group>(null)
  const [gone, setGone] = useState(() => performance.now() - at >= DOOR_DISSOLVE_MS)
  useEffect(() => {
    if (gone) return
    const t = window.setTimeout(() => setGone(true), Math.max(0, at + DOOR_DISSOLVE_MS - performance.now()))
    return () => window.clearTimeout(t)
  }, [gone, at])
  useFrame(() => {
    // The faces thin out first, in the first 40% of the decode; the points,
    // which the bloom lights, carry the static up into the lintel to the end
    // (faded as a ghost's materials are, WorldShards breatheMaterial).
    const t = dissolveShare(performance.now() - at)
    slab.current?.traverse((o) => {
      const m = (o as { material?: Material | Material[] }).material
      if (!m) return
      for (const one of Array.isArray(m) ? m : [m]) {
        const points = !!(one as { uniforms?: Record<string, unknown> }).uniforms?.uOpacity
        breatheMaterial(one, points ? 1 - t * t : Math.max(0, 1 - t / 0.4))
      }
    })
  })
  return (
    <>
      {!gone && <group ref={slab}><ShardMesh shard={look.closed} world ghost dissolve={at} {...meshFrame(frame, 'slab')} /></group>}
      <RailIn look={look} at={at} frame={frame} />
    </>
  )
}

/**
 * The open look fading in where the slab was, once most of the static has
 * risen. Not decoded out of static itself: the house decode throws each
 * point anywhere within the model's reach from its origin, and the rail
 * stands at the top of the doorway, so its static would fill the doorway
 * the slab has just cleared.
 */
function RailIn({ look, at, frame }: { look: Look; at: number; frame?: LookFrame }): JSX.Element | null {
  const rail = useRef<Group>(null)
  const [shown, setShown] = useState(() => performance.now() - at >= DOOR_OPEN_AT)
  useEffect(() => {
    if (shown) return
    const t = window.setTimeout(() => setShown(true), Math.max(0, at + DOOR_OPEN_AT - performance.now()))
    return () => window.clearTimeout(t)
  }, [shown, at])
  useFrame(() => {
    const share = Math.min(1, Math.max(0, (performance.now() - at - DOOR_OPEN_AT) / DOOR_RAIL_FADE_MS))
    rail.current?.traverse((o) => {
      const m = (o as { material?: Material | Material[] }).material
      if (m) for (const one of Array.isArray(m) ? m : [m]) breatheMaterial(one, share)
    })
  })
  // A custom door with no open look is not drawn once opened (lib/looks.ts drawnLook).
  if (!shown || !look.open) return null
  return <group ref={rail}><ShardMesh shard={look.open} world ghost {...meshFrame(frame, 'open')} /></group>
}
