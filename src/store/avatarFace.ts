/**
 * avatarFace.ts - how a pubkey's avatar turns as it moves (DECK-0003 §1.18):
 * PATH or UPRIGHT, read from the shard it is drawn as. While SET EYE's TRY
 * WALK runs, your own avatar is the workshop shard (store/tryEye.ts), so its
 * facing is that shard's too, as its shape and eye are (AvatarShape).
 */

import { faceOf, type FaceMode } from '../lib/facing'
import { useAvatars } from './useAvatars'
import { useTryEye } from './tryEye'

/** The facing mode `pubkey`'s avatar is drawn with: "path" for the default avatar and anything unknown. */
export function useAvatarFace(pubkey: string): FaceMode {
  const worn = useAvatars((s) => s.shards[pubkey] ?? null)
  const tried = useTryEye((t) => (t.pubkey === pubkey ? t.shard : null))
  return faceOf(tried ?? worn)
}
