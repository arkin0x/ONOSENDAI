/**
 * avatarLift.ts - how far an avatar's drawn group is lifted above where it
 * stands (scene/avatarMarker.ts MARKER_LIFT): the icosahedron onto its
 * lowest vertex, a worn shape not at all. Kept apart from AvatarShape so the
 * places that position an avatar (Avatar.tsx, OtherAvatar.tsx) can ask it.
 */

import { avatarDraw, avatarDrawKept, spectatorScale } from '../lib/avatar'
import { useAvatarShard } from '../store/useAvatars'
import { useCyberspace } from '../store/useCyberspace'
import { useTryEye } from '../store/tryEye'
import { MARKER_LIFT } from './avatarMarker'

/**
 * How far above where it stands an avatar's drawn group goes, in render
 * cells, outside the turn that faces it (scene/avatarMarker.ts MARKER_LIFT):
 * the icosahedron's half height (times its spectator shrink) when the
 * marker is what is drawn, so its lowest vertex is on the ground; 0 for a
 * worn shape, whose origin is its feet.
 */
export function useAvatarLift(pubkey: string, keepShape = false): number {
  const worn = useAvatarShard(pubkey)
  const tried = useTryEye((t) => (t.pubkey === pubkey ? t.shard : null))
  const shard = tried ?? worn
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const spectator = spectatorScale(scaleExp)
  const draw = shard && shard.vertices.length > 0 ? (keepShape ? avatarDrawKept(shard, scaleExp, spectator) : avatarDraw(shard, scaleExp)) : 'marker'
  return draw === 'marker' ? MARKER_LIFT * spectator : 0
}

