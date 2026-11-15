/**
 * WalkContactHint.tsx - the faint outline of a wall you cannot see, for a
 * moment after it stopped your walk (store/wallHint.ts). Thin accent edges,
 * in and out in well under a second; with reduced motion it shows at once
 * and only fades. Mounted beside each world shard (WorldShards PlacedShard)
 * and drawn only while its own hint is live, so it costs nothing otherwise.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferGeometry, Float32BufferAttribute, type LineBasicMaterial } from 'three'
import { expandFaceColors, type ShardModel } from 'sno-core/shards'
import { faceEdges } from 'sno-core/outline'
import type { Box } from '../lib/clip'
import type { Pose } from '../lib/pose'
import { ACCENT } from '../lib/palette'
import { WALL_HINT_MS, WALL_HINT_OPACITY, useWallHint, wallHintShare } from '../store/wallHint'
import { shardGeometry } from './ShardMesh'
import { reducedMotionNow } from './animMotion'
import { OVERLAY_ORDER } from './shardFaces'

/** The hint for the world shard `shardKey`, while it is live. */
export function WalkContactHint({ shardKey, shard, scale, clip, pose }: { shardKey: string; shard: ShardModel; scale: number; clip?: Box; pose?: Pose }): JSX.Element | null {
  // Mounted while this wall holds the hint; a new stop on it moves the time on (read each frame), never a remount.
  const mine = useWallHint((s) => s.key === shardKey)
  if (!mine) return null
  return <HintOutline shard={shard} scale={scale} clip={clip} pose={pose} />
}

function HintOutline({ shard, scale, clip, pose }: { shard: ShardModel; scale: number; clip?: Box; pose?: Pose }): JSX.Element | null {
  const geometry = useMemo(() => {
    const { positions, faces } = shardGeometry(expandFaceColors(shard), clip, pose)
    const idx = faces.length ? faceEdges(faces) : []
    if (idx.length === 0) return null
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(positions, 3))
    g.setIndex(idx)
    return g
  }, [shard, clip, pose])
  useEffect(() => () => geometry?.dispose(), [geometry])
  const material = useRef<LineBasicMaterial>(null)
  useFrame(() => {
    const m = material.current
    if (!m) return
    const elapsed = performance.now() - useWallHint.getState().at
    m.opacity = WALL_HINT_OPACITY * wallHintShare(elapsed, reducedMotionNow())
    m.visible = elapsed < WALL_HINT_MS
  })
  if (!geometry) return null
  return (
    <group scale={scale}>
      <lineSegments geometry={geometry} frustumCulled={false} renderOrder={OVERLAY_ORDER} raycast={() => null}>
        <lineBasicMaterial ref={material} color={ACCENT} toneMapped={false} transparent opacity={0} depthWrite={false} />
      </lineSegments>
    </group>
  )
}
