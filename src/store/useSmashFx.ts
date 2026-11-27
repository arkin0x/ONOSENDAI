/**
 * useSmashFx.ts - the smash on screen: the blocks a Compiler strike took,
 * when it landed, and what the compile found (block-uses §4.3). The
 * Compiler's code starts a show at the moment of impact and resolves it when
 * the lookup answers; the scene's SmashFx draws it (scene/SmashFx.tsx). One
 * show at a time: a new smash replaces the old one, which ends its effect.
 */

import { create } from 'zustand'

export interface SmashShow {
  /** Bumped per smash. */
  id: number
  /** The blocks smashed, in the TERRAIN field's frame: cs offsets from the field's origin (a cell d spans d to d + 1), with their block ids. */
  blocks: ReadonlyArray<{ at: readonly [number, number, number]; id: number }>
  /** The middle of the smashed blocks, in the same frame (continuous). */
  centre: readonly [number, number, number]
  /** performance.now() at the moment of impact. */
  struck: number
  /** What the compile found: still working, a match (a toy appears), or nothing. */
  outcome: 'pending' | 'match' | 'miss'
  /** performance.now() when the outcome became known, or null while pending. */
  resolvedAt: number | null
}

interface SmashFxState {
  show: SmashShow | null
  /** A smash lands: its show starts, pending. Returns its id. */
  start: (s: Omit<SmashShow, 'id' | 'outcome' | 'resolvedAt'>) => number
  /** What the compile found, for the show with this id (a later smash's show is left alone). */
  resolve: (id: number, outcome: 'match' | 'miss') => void
  clear: () => void
}

let nextId = 0

export const useSmashFx = create<SmashFxState>((set, get) => ({
  show: null,
  start: (s) => {
    const id = ++nextId
    set({ show: { ...s, id, outcome: 'pending', resolvedAt: null } })
    return id
  },
  resolve: (id, outcome) => {
    const show = get().show
    if (!show || show.id !== id) return
    set({ show: { ...show, outcome, resolvedAt: performance.now() } })
  },
  clear: () => set({ show: null }),
}))
