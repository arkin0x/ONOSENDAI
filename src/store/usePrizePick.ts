/**
 * usePrizePick.ts - the player's hand on the prizes a smash made: the toy
 * whose card is open (tap a toy: its name, its maker, TAKE), the picker for
 * the prizes past the ring ("+N more"), and the toys flying to ITEMS as they
 * are taken (owner, 2026-11-27).
 */

import { create } from 'zustand'

/** One toy on its way to ITEMS: where it starts on screen, its colour, its name. */
export interface Flight { id: number; x: number; y: number; colour: string; name: string; born: number }

interface PrizePickState {
  /** The toy whose card is open, by row key. */
  open: string | null
  /** The picker of every waiting prize here is open. */
  picker: boolean
  flights: Flight[]
  /** A toy being taken this moment (walking through it fires once). */
  taking: string | null
  select: (key: string | null) => void
  setPicker: (open: boolean) => void
  /** Send a toy flying to ITEMS from where it stands on screen. */
  fly: (key: string) => void
  /** Where a toy stands on screen now, for a flight started after it is taken. */
  measure: (key: string) => { x: number; y: number; colour: string; name: string } | null
  flyFrom: (key: string, from: { x: number; y: number; colour: string; name: string } | null) => void
  land: (id: number) => void
}

/** Where a toy stands on screen now (CSS pixels), set by the scene each frame (scene/PrizeToys.tsx). */
let project: ((key: string) => { x: number; y: number; colour: string; name: string } | null) | null = null
export function setToyProjector(fn: typeof project): void { project = fn }

let nextId = 1

export const usePrizePick = create<PrizePickState>((set, get) => ({
  open: null,
  picker: false,
  flights: [],
  taking: null,
  select: (key) => set({ open: key }),
  setPicker: (open) => set({ picker: open }),
  fly: (key) => {
    set({ taking: key })
    const p = project?.(key)
    if (p) set({ flights: [...get().flights, { id: nextId++, ...p, born: performance.now() }] })
    if (get().open === key) set({ open: null })
  },
  measure: (key) => project?.(key) ?? null,
  flyFrom: (key, p) => {
    set({ taking: key })
    if (p) set({ flights: [...get().flights, { id: nextId++, ...p, born: performance.now() }] })
    if (get().open === key) set({ open: null })
  },
  land: (id) => set({ flights: get().flights.filter((f) => f.id !== id) }),
}))

/** What a prize is called: the shard's own name, or the tool's. The blueprint it came from is said beside it. */
export function prizeName(toy: { prize: { type: string; payload?: { name?: unknown } }; name: string }): string {
  if (toy.prize.type === 'tool') return 'The Compiler'
  const n = toy.prize.payload?.name
  return typeof n === 'string' && n.trim() ? n.trim() : toy.name
}
