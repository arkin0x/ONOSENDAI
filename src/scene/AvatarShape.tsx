/**
 * AvatarShape.tsx - what an avatar looks like: their shard, or the dodecahedron.
 *
 * Every place an avatar is drawn (you, a target, the one being spectated)
 * asks useAvatars for the pubkey's shard and draws it in the dodecahedron's
 * cell, unlit under the bloom as deployed shards are; without one, the
 * wireframe icosahedron in the colour the caller gives.
 *
 * A shard scales with the zoom like everything else, and once it is smaller
 * than the icosahedron it is drawn as the icosahedron, the marker (lib/avatar
 * avatarDraw). The marker is shrunk at the top of the scale ladder (lib/avatar
 * spectatorScale), so an avatar at full zoom out is a mark inside cyberspace
 * rather than an eighth of it. Applied here rather than at the three call
 * sites so you, a target and a spectated avatar cannot disagree about how big
 * anybody is.
 */

import { EdgesGeometry, IcosahedronGeometry } from 'three'
import { avatarDraw, avatarDrawKept, spectatorScale } from '../lib/avatar'
import { useAvatarShard } from '../store/useAvatars'
import { useCyberspace } from '../store/useCyberspace'
import { ShardMesh } from './ShardMesh'

/**
 * The marker's edges, one for every avatar for as long as the page is open.
 * Each avatar made its own, passed as a prop, and r3f disposes only what it
 * made: none was ever freed, and the renderer kept each one's buffers and
 * vertex state. Cyberspace TV mounts the tape's avatars afresh at most cuts,
 * so a long watch added one for every avatar at every cut (arkinox,
 * 2026-10-20: "the perf on /tv on my laptop is not satisfactory").
 */
const MARKER_EDGES = new EdgesGeometry(new IcosahedronGeometry(0.5, 1))

interface Props {
  pubkey: string
  color: string
  renderOrder?: number
  depthTest?: boolean
  /**
   * Seen from inside, in WALK: a shard's faces have their backs culled, and
   * the plain icosahedron, a cage of edges with nothing sticking out of it,
   * is not drawn at all, since from its centre it is only lines across the
   * view.
   */
  firstPerson?: boolean
  /** A faint outline of the icosahedron whatever the avatar is: where you really stand while WALK runs ahead. */
  outline?: boolean
  /** Its own shape at any zoom, never the marker (Cyberspace TV: avatarDrawKept). */
  keepShape?: boolean
}

export function AvatarShape({ pubkey, color, renderOrder = 0, depthTest = true, firstPerson = false, outline = false, keepShape = false }: Props): JSX.Element | null {
  const shard = useAvatarShard(pubkey)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const spectator = spectatorScale(scaleExp)
  const draw = !outline && shard && shard.vertices.length > 0 ? (keepShape ? avatarDrawKept(shard, scaleExp, spectator) : avatarDraw(shard, scaleExp)) : 'marker'
  if (shard && draw !== 'marker') {
    const k = draw.mesh
    return (
      <group scale={[k, k, k]}>
        {/* An avatar is opaque whatever its shard says (DECK-0003 §3.3). */}
        <ShardMesh shard={shard} world cull={firstPerson} ignoreOpacity />
      </group>
    )
  }
  if (firstPerson) return null
  return (
    <group scale={[spectator, spectator, spectator]}>
      <lineSegments geometry={MARKER_EDGES} frustumCulled={false} renderOrder={renderOrder}>
        <lineBasicMaterial color={color} toneMapped={false} depthTest={depthTest} {...(outline ? { transparent: true, opacity: 0.3 } : {})} />
      </lineSegments>
    </group>
  )
}
