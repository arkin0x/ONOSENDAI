/**
 * savedChunksUi.ts - whether SAVED CHUNKS is open, and which saved chunk it
 * shows (terrain/SavedChunks.tsx draws it; store/starredChunks.ts keeps the
 * list). MINING's SAVED CHUNKS button opens the list; the survey card's
 * "Saved" line opens it at that chunk.
 */

import { create } from 'zustand'

interface SavedChunksUi {
  open: boolean
  /** The saved chunk being viewed (its key), or null for the list. */
  view: string | null
}

export const useSavedChunksUi = create<SavedChunksUi>(() => ({ open: false, view: null }))

/** Open SAVED CHUNKS: the list, or one saved chunk's view. */
export function openSavedChunks(view: string | null = null): void {
  useSavedChunksUi.setState({ open: true, view })
}

/** Back from a saved chunk's view to the list. */
export function backToList(): void {
  useSavedChunksUi.setState({ view: null })
}

export function closeSavedChunks(): void {
  if (useSavedChunksUi.getState().open) useSavedChunksUi.setState({ open: false, view: null })
}
