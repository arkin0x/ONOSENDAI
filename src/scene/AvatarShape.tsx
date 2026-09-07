/**
 * AvatarShape.tsx - what an avatar looks like: their shard, or the dodecahedron.
 *
 * Every place an avatar is drawn (you, a target, the one being spectated)
 * asks useAvatars for the pubkey's shard and draws it in the dodecahedron's
 * cell, unlit under the bloom as deployed shards are; without one, the
 * wireframe icosahedron in the colour the caller gives.
 */

import { useMemo } from 'react'
import { EdgesGeometry, IcosahedronGeometry } from 'three'
import { avatarScale } from '../lib/avatar'
import { useAvatarShard } from '../store/useAvatars'
import { ShardMesh } from './ShardMesh'

interface Props {
  pubkey: string
  color: string
  renderOrder?: number
  depthTest?: boolean
}

export function AvatarShape({ pubkey, color, renderOrder = 0, depthTest = true }: Props): JSX.Element {
  const shard = useAvatarShard(pubkey)
  const geometry = useMemo(() => new EdgesGeometry(new IcosahedronGeometry(0.5, 1)), [])
  if (shard && shard.vertices.length > 0) {
    const k = avatarScale(shard)
    return (
      <group scale={[k, k, k]}>
        <ShardMesh shard={shard} world />
      </group>
    )
  }
  return (
    <lineSegments geometry={geometry} frustumCulled={false} renderOrder={renderOrder}>
      <lineBasicMaterial color={color} toneMapped={false} depthTest={depthTest} />
    </lineSegments>
  )
}
