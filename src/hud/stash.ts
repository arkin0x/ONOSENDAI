/**
 * stash.ts - bags, and the Stash's three modals (Models, Bags, Bag Contents).
 *
 * A bag is everything this identity hid at one place: the items sealed to one
 * region at one height travel as one event (spec §7.6), filed under one lookup
 * id. The deployment list is per item; the Stash shows bags, so the items are
 * grouped here by lookup id, newest bag first.
 *
 * The modals live in their own small store, mounted at the app root, because
 * the panel they open from closes while a deploy runs, and a deploy started
 * from the Models modal and then cancelled comes back to it (arkinox,
 * 2026-09-26).
 */

import { create } from 'zustand'
import type { MyDeployment } from '../store/useShards'
import { useShards } from '../store/useShards'
import { useCyberspace } from '../store/useCyberspace'
import { messagePreview } from '../lib/hidden'

export interface Bag {
  lookupId: string
  items: MyDeployment[]
  height: number
  plane: 0 | 1
  /** Newest item's created_at: what orders bags. */
  at: number
  /** Every item is on a relay. */
  published: boolean
}

/** The deployments grouped into bags by lookup id, newest bag first, newest item first inside each. */
export function bagsOf(mine: MyDeployment[]): Bag[] {
  const by = new Map<string, MyDeployment[]>()
  for (const d of mine) {
    const list = by.get(d.lookupId)
    if (list) list.push(d)
    else by.set(d.lookupId, [d])
  }
  const bags: Bag[] = []
  for (const [lookupId, items] of by) {
    items.sort((a, b) => b.createdAt - a.createdAt)
    bags.push({
      lookupId,
      items,
      height: items[0].height,
      plane: items[0].plane as 0 | 1,
      at: items[0].createdAt,
      published: items.every((d) => d.published),
    })
  }
  return bags.sort((a, b) => b.at - a.at)
}

export function depName(d: MyDeployment): string {
  return d.type === 'message' ? messagePreview(d.text ?? '', 24) : d.shard?.name ?? 'object'
}

/** Fly the scene to one deployment and open its record: what tapping one has always done. */
export function goToDeployment(d: MyDeployment): void {
  useShards.getState().inspect(d.eventId)
  const unit = d.type === 'shard' ? d.shard?.unit ?? 0 : 0
  useCyberspace.getState().focusItem({ x: BigInt(d.at.x), y: BigInt(d.at.y), z: BigInt(d.at.z) }, d.plane, depName(d), unit)
}

interface StashModals {
  models: boolean
  bags: boolean
  /** The bag whose contents are open, by lookup id. */
  bag: string | null
  /** The Builder's HIDE MESSAGE composer. */
  message: boolean
  /** A deploy was started from the Models modal: cancelling it reopens the modal. */
  returnToModels: boolean
  openModels: () => void
  openBags: () => void
  openBag: (lookupId: string) => void
  /** Write a message to hide at the build cursor. */
  openMessage: () => void
  close: () => void
  /** Start deploying a model from the Models modal. */
  deployModel: (id: string) => void
}

export const useStash = create<StashModals>((set) => ({
  models: false,
  bags: false,
  bag: null,
  message: false,
  returnToModels: false,
  openModels: () => set({ models: true, bags: false, bag: null, message: false }),
  openBags: () => set({ bags: true, models: false, bag: null, message: false }),
  openBag: (lookupId) => set({ bag: lookupId, models: false, message: false }),
  openMessage: () => set({ message: true, models: false, bags: false, bag: null }),
  close: () => set({ models: false, bags: false, bag: null, message: false }),
  deployModel: (id) => {
    set({ models: false, returnToModels: true })
    useShards.getState().startDeployShard(id)
  },
}))

// A deploy that ends without placing anything, started from the Models
// modal, returns to it; one that places, or any other ending, forgets.
useShards.subscribe((s, prev) => {
  if (prev.pending === null || s.pending !== null) return
  const { returnToModels } = useStash.getState()
  if (!returnToModels) return
  useStash.setState({ returnToModels: false, models: s.deployStatus !== 'done' })
})
