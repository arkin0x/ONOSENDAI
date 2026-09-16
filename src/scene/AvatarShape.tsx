/**
 * AvatarShape.tsx - what an avatar looks like: their shard, or the dodecahedron.
 *
 * Every place an avatar is drawn (you, a target, the one being spectated)
 * asks useAvatars for the pubkey's shard and draws it in the dodecahedron's
 * cell, unlit under the bloom as deployed shards are; without one, the
 * wireframe icosahedron in the colour the caller gives.
 *
 * Both are shrunk together at the top of the scale ladder (lib/avatar
 * spectatorScale), so an avatar at full zoom out is a mark inside cyberspace
 * rather than an eighth of it. Applied here rather than at the three call
 * sites so you, a target and a spectated avatar cannot disagree about how big
 * anybody is.
 */

import { useMemo } from 'react'
import { EdgesGeometry, IcosahedronGeometry } from 'three'
import { avatarScale, spectatorScale } from '../lib/avatar'
import { useAvatarShard } from '../store/useAvatars'
import { useCyberspace } from '../store/useCyberspace'
import { ShardMesh } from './ShardMesh'

interface Props {
  pubkey: string
  color: string
  renderOrder?: number
  depthTest?: boolean
}

export function AvatarShape({ pubkey, color, renderOrder = 0, depthTest = true }: Props): JSX.Element {
  const shard = useAvatarShard(pubkey)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const spectator = spectatorScale(scaleExp)
  const geometry = useMemo(() => new EdgesGeometry(new IcosahedronGeometry(0.5, 1)), [])
  if (shard && shard.vertices.length > 0) {
    const k = avatarScale(shard) * spectator
    return (
      <group scale={[k, k, k]}>
        <ShardMesh shard={shard} world />
      </group>
    )
  }
  return (
    <group scale={[spectator, spectator, spectator]}>
      <lineSegments geometry={geometry} frustumCulled={false} renderOrder={renderOrder}>
        <lineBasicMaterial color={color} toneMapped={false} depthTest={depthTest} />
      </lineSegments>
    </group>
  )
}
