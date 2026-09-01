/**
 * useLoot.ts — the relay's bags, fetched once and kept live.
 *
 * Same shape as useRecentAvatars: one backfill query for every kind:33330
 * envelope, one live subscription for new or rewritten ones, merged by bag key
 * so a republished bag replaces its older self instead of appearing twice.
 */

import { useEffect, useState } from 'react'
import { HIDDEN_KIND } from '../lib/hidden'
import { mergeLoot, summarizeBag, type LootItem } from '../lib/loot'
import { query, subscribe } from '../lib/relay'

export interface Loot {
  items: LootItem[]
  status: 'loading' | 'ready' | 'error'
}

/** The relay holds a few dozen bags today; this leaves room without paging. */
export const LOOT_BACKFILL = 500

export function useLoot(): Loot {
  const [items, setItems] = useState<LootItem[]>([])
  const [status, setStatus] = useState<Loot['status']>('loading')

  useEffect(() => {
    let alive = true
    const since = Math.floor(Date.now() / 1000) - 60
    const close = subscribe({ kinds: [HIDDEN_KIND], since }, (ev) => {
      const item = summarizeBag(ev)
      if (alive && item) setItems((prev) => mergeLoot(prev, [item]))
    })
    query({ kinds: [HIDDEN_KIND], limit: LOOT_BACKFILL }).then(
      (events) => {
        if (!alive) return
        const found = events.map(summarizeBag).filter((x): x is LootItem => x !== null)
        setItems((prev) => mergeLoot(prev, found))
        setStatus('ready')
      },
      () => { if (alive) setStatus('error') },
    )
    return () => { alive = false; close() }
  }, [])

  return { items, status }
}
