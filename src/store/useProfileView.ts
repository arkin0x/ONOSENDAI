/**
 * useProfileView.ts: whose profile is open (hud/ProfileView), from a tap on a
 * profile picture or a name anywhere they are shown (arkinox, 2026-10-20),
 * and whether your own profile's editor is open (hud/ProfileModal), which the
 * Identity panel's PROFILE and the view's EDIT PROFILE both open.
 */

import { create } from 'zustand'

interface ProfileViewState {
  /** The pubkey whose profile is shown, or null. */
  pubkey: string | null
  /** Whether your own profile's editor is open. */
  editing: boolean
  open: (pubkey: string) => void
  close: () => void
  /** Open your own profile's editor, in place of the view. */
  edit: () => void
  stopEditing: () => void
}

export const useProfileView = create<ProfileViewState>((set) => ({
  pubkey: null,
  editing: false,
  open: (pubkey) => set({ pubkey }),
  close: () => set({ pubkey: null }),
  edit: () => set({ pubkey: null, editing: true }),
  stopEditing: () => set({ editing: false }),
}))
