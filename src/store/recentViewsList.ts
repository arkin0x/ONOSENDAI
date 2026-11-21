/**
 * recentViewsList.ts: the View panel's recent places, one identity's own
 * (store/personalLists.ts): a new identity starts with none, and each finds
 * its own again when it logs back in on this device (owner ruling,
 * 2026-11-19). The list itself is held in lib/viewAt.ts, which the panel and
 * addRecentView read at once.
 */

import { cleanRecentViews, legacyRecentViews, rememberView, setRecentViewsPersister, showRecentViews, type RecentView } from '../lib/viewAt'
import { personalList } from './personalLists'

export const RECENT_VIEWS_LIST = 'view-recent'

export const recentViewsList = personalList<RecentView[]>({
  name: RECENT_VIEWS_LIST,
  legacy: legacyRecentViews,
  clean: cleanRecentViews,
  empty: [],
  // A place remembered before the read answered goes in front of what was read.
  merge: (stored, early) => early.reduceRight((list, entry) => rememberView(list, entry), stored),
  show: (list) => showRecentViews(list),
})

setRecentViewsPersister((list) => recentViewsList.save(list))
