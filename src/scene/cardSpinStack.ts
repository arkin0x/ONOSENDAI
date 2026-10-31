/**
 * cardSpinStack.ts: who holds the one turning preview a card can show.
 *
 * A card that opens over another takes the canvas and hands it back when it
 * closes. No DOM here, so a test can hold the order.
 */

import { create } from 'zustand'
import type { ShardModel } from 'sno-core/shards'

/** One card asking to show a shard, in the element it gave. */
export interface SpinClaim {
  id: number
  shard: ShardModel | null
  ignoreOpacity: boolean
  size: number
  slot: HTMLElement
}

interface SpinStack {
  claims: SpinClaim[]
  /** Which making of the canvas this is: a new number makes it again (CardSpin's boundary). */
  made: number
  /** Make the canvas again: it threw, or its context is lost for good. */
  remake: () => void
  claim: (c: Omit<SpinClaim, 'id'>) => number
  update: (id: number, c: Partial<Omit<SpinClaim, 'id'>>) => void
  release: (id: number) => void
}

let nextId = 1

export const useSpinStack = create<SpinStack>((set) => ({
  claims: [],
  made: 0,
  remake: () => set((s) => ({ made: s.made + 1 })),
  claim: (c) => {
    const id = nextId++
    set((s) => ({ claims: [...s.claims, { ...c, id }] }))
    return id
  },
  update: (id, c) => set((s) => ({ claims: s.claims.map((x) => (x.id === id ? { ...x, ...c } : x)) })),
  release: (id) => set((s) => ({ claims: s.claims.filter((x) => x.id !== id) })),
}))

/** The claim on top: the last card to open, which is the one that can be seen. */
export function topClaim(claims: readonly SpinClaim[]): SpinClaim | null {
  return claims[claims.length - 1] ?? null
}
