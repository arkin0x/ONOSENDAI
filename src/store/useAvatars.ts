/**
 * useAvatars.ts - who looks like what.
 *
 * Every avatar drawn asks here for its shape: the kind 33331 event of that
 * pubkey (lib/avatar), fetched once and refreshed now and then, null meaning
 * the dodecahedron. An avatar is drawn only when it has paid its work (spec
 * 8.10, cyberspace-core's verifyAvatarWork); one that has not is the
 * dodecahedron to everyone. Your own is kept in localStorage as well, so it
 * is on screen before the relay answers, and adopting a shard prices it,
 * mines the nonce off the main thread with progress and cancel, signs (with
 * a long patience, since a person is reading the prompt), publishes the
 * event and keeps the copy. `phase` says which of those is happening, so the
 * workshop can keep the button down and say where things are.
 */

import { useEffect } from 'react'
import { create } from 'zustand'
import { avatarWork, verifyAvatarWork } from 'cyberspace-core'
import { AVATAR_D, AVATAR_KIND, avatarFromEvent, avatarTemplate } from '../lib/avatar'
import { nonceTagged } from '../lib/avatarMine'
import { MineCancelled, mineInWorker, type AvatarMiner } from '../lib/avatarWorker'
import { publish, query } from '../lib/relay'
import { fromPayload, toPayload, type ShardModel } from '../lib/shards'
import { useCyberspace } from './useCyberspace'

const MINE_KEY = 'onosendai:avatar'
const REFRESH_MS = 5 * 60_000

/** How the work is done; tests swap in an inline loop. */
let miner: AvatarMiner = mineInWorker
export function setAvatarMiner(m: AvatarMiner): void { miner = m }

let current: { cancel: () => void } | null = null

export interface Mining {
  /** Bits the shape owes. */
  required: number
  tries: number
  elapsedMs: number
}

/** Where an adopt is: the work, then the signer, then the relays. */
export type AdoptPhase = 'mining' | 'signing' | 'publishing'

/** How long to wait for a remote signer here: a person is reading the prompt, not a hop. */
export const AVATAR_SIGN_PATIENCE_MS = 120_000

interface AvatarsState {
  /** By pubkey: the shard, null for the dodecahedron; absent until asked. */
  shards: Record<string, ShardModel | null>
  /** When each pubkey was last asked for, so the relay is not asked per frame. */
  asked: Record<string, number>
  /** The job in progress, for the workshop's row. */
  mining: Mining | null
  /** What adopt is doing now, null when idle; the button stays down through all of it. */
  phase: AdoptPhase | null
  /** How long the last mine took, kept through signing and publishing for the row. */
  minedMs: number | null
  /** Why the last adopt failed, for the notice; null when it succeeded or was cancelled. */
  adoptError: string | null
  /** Look a pubkey's avatar up, once per refresh window. */
  ensure: (pubkey: string) => void
  /** Publish this shard as your avatar (null for the dodecahedron); true when a relay took it. */
  adopt: (shard: ShardModel | null) => Promise<boolean>
  /** Stop the mining in progress; adopt resolves false. */
  cancelAdopt: () => void
  /** Your own from localStorage, before the relay answers. */
  loadMine: () => void
}

export const useAvatars = create<AvatarsState>((set, get) => ({
  shards: {},
  asked: {},
  mining: null,
  phase: null,
  minedMs: null,
  adoptError: null,

  ensure: (pubkey) => {
    const now = Date.now()
    const last = get().asked[pubkey] ?? 0
    if (now - last < REFRESH_MS) return
    set({ asked: { ...get().asked, [pubkey]: now } })
    query({ kinds: [AVATAR_KIND], authors: [pubkey], '#d': [AVATAR_D] })
      .then((events) => {
        const newest = [...events].sort((a, b) => b.created_at - a.created_at)[0]
        // An empty answer says nothing: a relay that is down, or has not seen
        // the event yet, must not turn a known avatar back into the dodecahedron.
        if (!newest) {
          if (!(pubkey in get().shards)) set({ shards: { ...get().shards, [pubkey]: null } })
          return
        }
        const shard = paidShard(newest)
        set({ shards: { ...get().shards, [pubkey]: shard } })
        if (pubkey === useCyberspace.getState().identity.pubkey) remember(shard)
      })
      .catch(() => { if (!(pubkey in get().shards)) set({ shards: { ...get().shards, [pubkey]: null } }) })
  },

  adopt: async (shard) => {
    // One adopt at a time, through mining, signing and publishing: a second
    // press while the signer's prompt is open would mine and ask again.
    if (get().phase) return false
    const cs = useCyberspace.getState()
    const me = cs.identity.pubkey
    let template = avatarTemplate(shard, Math.floor(Date.now() / 1000))
    set({ adoptError: null, minedMs: null })
    if (shard) {
      const required = avatarWork(toPayload(shard))
      const job = miner({ ...template, pubkey: me }, required, (p) => {
        const m = get().mining
        if (m) set({ mining: { ...m, tries: p.tries, elapsedMs: p.elapsedMs } })
      })
      current = job
      set({ phase: 'mining', mining: { required, tries: 0, elapsedMs: 0 } })
      try {
        const found = await job.done
        template = nonceTagged(template, found.nonce, required)
        set({ minedMs: found.elapsedMs })
      } catch (e) {
        set({ phase: null, mining: null, adoptError: e instanceof MineCancelled ? null : 'The mining failed on this device.' })
        return false
      } finally {
        current = null
      }
      set({ mining: null })
    }
    set({ phase: 'signing' })
    let event
    try {
      event = await cs.signEvent(template, AVATAR_SIGN_PATIENCE_MS)
    } catch {
      set({ phase: null, adoptError: 'The signer did not sign the avatar.' })
      return false
    }
    // The signer must return the event as mined: a changed created_at or tag
    // list is a different id, and the work is gone with it.
    if (shard && !verifyAvatarWork(event).ok) {
      set({ phase: null, adoptError: 'The signer changed the event, so the work no longer covers it. Try again.' })
      return false
    }
    set({ phase: 'publishing' })
    const result = await publish(event)
    if (!result.ok) {
      set({ phase: null, adoptError: 'No relay took the avatar. Try again when one is reachable.' })
      return false
    }
    set({ phase: null, shards: { ...get().shards, [me]: shard }, asked: { ...get().asked, [me]: Date.now() } })
    remember(shard)
    return true
  },

  cancelAdopt: () => { current?.cancel() },

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

/**
 * The shard an event is drawn as: none for an empty content (the dodecahedron,
 * which owes nothing), none for a shape that has not paid its work.
 */
export function paidShard(ev: { kind: number; pubkey: string; content: string; tags: string[][]; id: string }): ShardModel | null {
  if (!ev.content) return null
  if (!verifyAvatarWork(ev).ok) return null
  return avatarFromEvent(ev)
}

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
