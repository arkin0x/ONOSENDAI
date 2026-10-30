/**
 * DoorCeremony.tsx: a door opening where it stands (lib/ceremony.ts has the
 * timeline; arkinox, 2026-10-30, door A: "the door slab decodes away upward
 * with the house static; WALK lets you through immediately; the room's
 * contents appear with the existing reveal effect; no loot float").
 *
 * The closed slab decodes away upward (ShardMesh `dissolve`), fading as it
 * goes, as if it slid up into the lintel; the open look, the slab's bottom
 * rail, settles out of static as a found shard does (ShardMesh `birth`). By
 * then WALK has long let the walker through (store/walkWalls.ts), and what
 * is behind the door is appearing with the find ceremony where it stands
 * (hud/ItemRows openChestHere). The calm path fades one into the other.
 * Drawn in the door's own frame (LookMark); the camera never moves.
 */

import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { DOOR_DISSOLVE_MS, DOOR_OPEN_AT, dissolveShare } from '../lib/ceremony'
import type { Look } from '../lib/looks'
import { CalmSwap, fadeAll } from './ChestCeremony'
import { ShardMesh } from './ShardMesh'

export function DoorCeremony({ look, at, calm }: { look: Look; at: number; calm: boolean }): JSX.Element {
  if (calm || !look.open) return <CalmSwap from={look.closed} to={look.open ?? look.closed} at={at} />
  return <SlabAway look={look} at={at} />
}

function SlabAway({ look, at }: { look: Look; at: number }): JSX.Element {
  const slab = useRef<Group>(null)
  const [gone, setGone] = useState(() => performance.now() - at >= DOOR_DISSOLVE_MS)
  useEffect(() => {
    if (gone) return
    const t = window.setTimeout(() => setGone(true), Math.max(0, at + DOOR_DISSOLVE_MS - performance.now()))
    return () => window.clearTimeout(t)
  }, [gone, at])
  useFrame(() => {
    // Faded as a ghost's materials are, so the static thins out as it rises.
    const t = dissolveShare(performance.now() - at)
    fadeAll(slab.current, 1 - t * t)
  })
  return (
    <>
      {!gone && <group ref={slab}><ShardMesh shard={look.closed} world ghost dissolve={at} /></group>}
      <ShardMesh shard={look.open!} world birth={at + DOOR_OPEN_AT} />
    </>
  )
}
