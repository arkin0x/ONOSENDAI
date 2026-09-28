/**
 * useSocialUi: which chain action's reactions and comments are open.
 *
 * One modal at the app root (ActionModal), opened from the chain explorer's
 * Comments button and, later, from a notification. It holds the action
 * itself rather than an index, so it stays right while the chain grows.
 */

import { create } from 'zustand'
import type { ActionEvent } from '../lib/events'

interface SocialUi {
  action: ActionEvent | null
  openAction: (action: ActionEvent) => void
  closeAction: () => void
}

export const useSocialUi = create<SocialUi>((set) => ({
  action: null,
  openAction: (action) => set({ action }),
  closeAction: () => set({ action: null }),
}))
