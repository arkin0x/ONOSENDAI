/**
 * usePersonCard.ts: whose profile card is open, from a tap on their avatar in
 * the scene (PersonModal; arkinox, 2026-10-11: "I should be able to tap on his
 * avatar to see his profile modal overlay plus an avatar preview and copy to
 * workshop button").
 *
 * Also what COPY TO WORKSHOP does with an avatar: the shard goes into the
 * workshop as a copy that credits its author, as every other copy of someone
 * else's object does (sno-core withCredit). An avatar is a kind 11333,
 * replaceable, so its address is `11333:<pubkey>:` (NIP-01's replaceable
 * address, an empty `d`), which names the author for creditAuthor.
 */

import { create } from 'zustand'
import type { Credit } from 'sno-core/feed'
import type { ShardModel } from 'sno-core/shards'
import { AVATAR_KIND } from '../lib/avatar'
import { useWorkshop } from './useWorkshop'

interface PersonCardState {
  /** The pubkey whose card is up, null when none is. */
  pubkey: string | null
  open: (pubkey: string) => void
  close: () => void
}

export const usePersonCard = create<PersonCardState>((set) => ({
  pubkey: null,
  open: (pubkey) => set({ pubkey }),
  close: () => set({ pubkey: null }),
}))

/** The credit a copy of `pubkey`'s avatar carries: their avatar event's address. */
export function avatarCredit(pubkey: string): Credit {
  return { address: `${AVATAR_KIND}:${pubkey}:` }
}

/**
 * Copy `pubkey`'s avatar shard into your workshop, credited to them; the new
 * model's id. Your own (`me`) comes in uncredited: you do not credit yourself.
 */
export function copyAvatarToWorkshop(shard: ShardModel, pubkey: string, me?: string): string {
  return useWorkshop.getState().importShard(shard, pubkey === me ? undefined : avatarCredit(pubkey))
}
