/**
 * useRecentAvatars.ts — who has moved lately, newest first.
 *
 * One query for the newest v2 actions on the relay, folded to the newest per
 * pubkey, then a live subscription so anyone who hops while the panel is open
 * rises to the top. The relay cannot group by author, so the fold is ours;
 * the limit is generous because one busy avatar can own most of the newest
 * few hundred events.
 */

import { useEffect, useState } from 'react'
import { fetchRecent, latestByPubkey, mergeEvents, watchRecent } from '../lib/chains'
import type { ActionEvent, NostrEvent } from '../lib/events'

export interface RecentAvatars {
  avatars: ActionEvent[]
  status: 'loading' | 'ready' | 'error'
}

export function useRecentAvatars(): RecentAvatars {
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [status, setStatus] = useState<RecentAvatars['status']>('loading')

  useEffect(() => {
    let alive = true
    const since = Math.floor(Date.now() / 1000) - 60
    const close = watchRecent(since, (ev) => {
      if (alive) setEvents((prev) => mergeEvents(prev, [ev]))
    })
    fetchRecent(400).then(
      (fetched) => {
        if (!alive) return
        setEvents((prev) => mergeEvents(fetched, prev))
        setStatus('ready')
      },
      () => { if (alive) setStatus('error') },
    )
    return () => { alive = false; close() }
  }, [])

  return { avatars: latestByPubkey(events), status }
}
