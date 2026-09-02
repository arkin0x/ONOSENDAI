/**
 * useLootView.ts — which bag the Loot list has open.
 *
 * The list lives in a panel and the detail is a modal at the App root, so the
 * selection has to live outside both. Same reason SecretModal reads its
 * selection from the shards store rather than from the panel that opened it:
 * a modal rendered inside a panel is trapped under its sibling panels.
 */

import { create } from 'zustand'
import type { LootItem } from '../lib/loot'

interface LootViewState {
  selected: LootItem | null
  select: (item: LootItem | null) => void
}

export const useLootView = create<LootViewState>((set) => ({
  selected: null,
  select: (item) => set({ selected: item }),
}))
