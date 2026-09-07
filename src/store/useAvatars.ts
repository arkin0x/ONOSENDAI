/**
 * useAvatars.ts - who looks like what.
 *
 * Every avatar drawn asks here for its shape: the kind 33331 event of that
 * pubkey (lib/avatar), fetched once and refreshed now and then, null meaning
 * the dodecahedron. Your own is kept in localStorage as well, so it is on
 * screen before the relay answers, and adopting a shard signs and publishes
 * the event and keeps the copy.
 */

import { useEffect } from 'react'
import { create } from 'zustand'
import { AVATAR_D, AVATAR_KIND, avatarFromEvent, avatarTemplate } from '../lib/avatar'
import { publish, query } from '../lib/relay'
import { fromPayload, toPayload, type ShardModel } from '../lib/shards'
import { useCyberspace } from './useCyberspace'

const MINE_KEY = 'onosendai:avatar'
const REFRESH_MS = 5 * 60_000

interface AvatarsState {
  /** By pubkey: the shard, null for the dodecahedron; absent until asked. */
  shards: Record<string, ShardModel | null>
  /** When each pubkey was last asked for, so the relay is not asked per frame. */
  asked: Record<string, number>
  /** Look a pubkey's avatar up, once per refresh window. */
  ensure: (pubkey: string) => void
  /** Publish this shard as your avatar (null for the dodecahedron); true when a relay took it. */
  adopt: (shard: ShardModel | null) => Promise<boolean>
  /** Your own from localStorage, before the relay answers. */
  loadMine: () => void
}

export const useAvatars = create<AvatarsState>((set, get) => ({
  shards: {},
  asked: {},

  ensure: (pubkey) => {
    const now = Date.now()
    const last = get().asked[pubkey] ?? 0
    if (now - last < REFRESH_MS) return
    set({ asked: { ...get().asked, [pubkey]: now } })
    query({ kinds: [AVATAR_KIND], authors: [pubkey], '#d': [AVATAR_D] })
      .then((events) => {
        const newest = [...events].sort((a, b) => b.created_at - a.created_at)[0]
        const shard = newest ? avatarFromEvent(newest) : null
        set({ shards: { ...get().shards, [pubkey]: shard } })
        if (pubkey === useCyberspace.getState().identity.pubkey) remember(shard)
      })
      .catch(() => { if (!(pubkey in get().shards)) set({ shards: { ...get().shards, [pubkey]: null } }) })
  },

  adopt: async (shard) => {
    const cs = useCyberspace.getState()
    const me = cs.identity.pubkey
    let event
    try {
      event = await cs.signEvent(avatarTemplate(shard, Math.floor(Date.now() / 1000)))
    } catch {
      return false
    }
    const result = await publish(event)
    if (!result.ok) return false
    set({ shards: { ...get().shards, [me]: shard }, asked: { ...get().asked, [me]: Date.now() } })
    remember(shard)
    return true
  },

  loadMine: () => {
    const me = useCyberspace.getState().identity.pubkey
    try {
      const raw = localStorage.getItem(MINE_KEY)
      if (!raw) return
      const kept = JSON.parse(raw) as { pubkey?: string; payload?: unknown }
      if (kept.pubkey !== me) return
      const shard = kept.payload ? fromPayload(kept.payload, `avatar:${me}`) : null
      set({ shards: { ...get().shards, [me]: shard } })
    } catch { /* nothing kept */ }
  },
}))

function remember(shard: ShardModel | null): void {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify({ pubkey: useCyberspace.getState().identity.pubkey, payload: shard ? toPayload(shard) : null }))
  } catch { /* private mode */ }
}

/** The shard a pubkey is drawn as, or null for the dodecahedron; asks the relay as needed. */
export function useAvatarShard(pubkey: string): ShardModel | null {
  const shard = useAvatars((s) => s.shards[pubkey])
  useEffect(() => { if (pubkey) useAvatars.getState().ensure(pubkey) }, [pubkey])
  return shard ?? null
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __avatars?: unknown }).__avatars = useAvatars
}
