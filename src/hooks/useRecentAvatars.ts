/**
 * useRecentAvatars.ts — who has moved lately, newest first.
 *
 * The list is kept by store/useRoster.ts for the whole session and across
 * reloads; this only reads it. Mounting the panel starts the roster once
 * (a catch-up and the live feed, which then run until the page closes) and,
 * on a later open, catches up if the last catch-up is old. Unmounting stops
 * nothing, so a closed menu keeps the list current. Each one is placed where
 * their chain really stands when that is known (lib/neighborChains.ts
 * standingOf).
 */

import { useEffect } from 'react'
import type { ActionEvent } from '../lib/events'
import { standingOf } from '../lib/neighborChains'
import { refreshRoster, rosterStatus, startRoster, useRoster } from '../store/useRoster'

export interface RecentAvatars {
  avatars: ActionEvent[]
  status: 'loading' | 'ready' | 'error'
  /** A catch-up is under way: the rows are what is in hand meanwhile. */
  updating: boolean
}

export function useRecentAvatars(): RecentAvatars {
  const list = useRoster((s) => s.list)
  const status = useRoster(rosterStatus)
  const updating = useRoster((s) => s.asking > 0)

  useEffect(() => {
    startRoster()
    refreshRoster()
  }, [])

  // Someone whose chain is known to be broken stands where it froze, by the
  // same cached chain reads presence makes (lib/neighborChains.ts); this list
  // never asks the relays for a chain itself.
  return { avatars: list.map(standingOf), status, updating }
}
