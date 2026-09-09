/**
 * useChatFeed.ts — listen for what is said where you stand.
 *
 * One live subscription for ephemeral envelopes (kind 23330) filed under any
 * of the regions the passive scan says you are in, reopened whenever that set
 * changes. There is nothing to backfill: the relay keeps none of these, so a
 * line said before you were listening is gone, which is what ephemeral means.
 */

import { useEffect } from 'react'
import { subscribe } from '../lib/relay'
import { CHAT_BAG_KIND } from '../lib/hidden'
import { useChat } from '../store/useChat'
import { useSecrets } from '../store/useSecrets'

export function useChatFeed(): void {
  const current = useSecrets((s) => s.current)
  const regions = Object.keys(current).sort().join(',')

  useEffect(() => {
    if (regions === '') return
    const ids = regions.split(',')
    const stop = subscribe({ kinds: [CHAT_BAG_KIND], '#d': ids }, (ev) => { void useChat.getState().receive(ev) })
    return stop
  }, [regions])
}
