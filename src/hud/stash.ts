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
import type { FeedObject } from 'sno-core/feed'

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
  /** The SHARD FEED window: everyone's published objects, outside the Builder. */
  feed: boolean
  /** A deploy was started from the Models modal: cancelling it reopens the modal. */
  returnToModels: boolean
  /** A deploy was started from the SHARD FEED window (USE IN BUILDER): cancelling it reopens the window. */
  returnToFeed: boolean
  /** The PLACE OBJECT tab last picked from, so a cancelled deploy comes back to it. */
  pickTab: 'mine' | 'feed' | null
  /** USE IN BUILDER from the SHARD FEED window: the object lined up, the window back on a cancel. */
  useFromFeed: (object: FeedObject) => void
  openModels: () => void
  openBags: () => void
  openBag: (lookupId: string) => void
  /** Write a message to hide at the build cursor. */
  openMessage: () => void
  /** Browse the Shard Feed. */
  openFeed: () => void
  close: () => void
  /** Start deploying a model from the Models modal. */
  deployModel: (id: string) => void
  /** Line up an object from the Shard Feed at the build cursor, as a copy. */
  deployObject: (object: FeedObject) => void
}

export const useStash = create<StashModals>((set) => ({
  models: false,
  bags: false,
  bag: null,
  message: false,
  feed: false,
  returnToModels: false,
  returnToFeed: false,
  pickTab: null,
  openModels: () => set({ models: true, bags: false, bag: null, message: false, feed: false }),
  openBags: () => set({ bags: true, models: false, bag: null, message: false, feed: false }),
  openBag: (lookupId) => set({ bag: lookupId, models: false, message: false, feed: false }),
  openMessage: () => set({ message: true, models: false, bags: false, bag: null, feed: false }),
  openFeed: () => set({ feed: true, models: false, bags: false, bag: null, message: false }),
  close: () => set({ models: false, bags: false, bag: null, message: false, feed: false }),
  deployModel: (id) => {
    set({ models: false, returnToModels: true, pickTab: 'mine' })
    useShards.getState().startDeployShard(id)
  },
  deployObject: (object) => {
    set({ models: false, returnToModels: true, pickTab: 'feed' })
    useShards.getState().startDeployObject(object)
  },
  useFromFeed: (object) => {
    set({ feed: false, returnToFeed: true })
    useShards.getState().startDeployObject(object)
  },
}))

// A deploy that ends without placing anything, started from the Models
// modal, returns to it; one that places, or any other ending, forgets.
useShards.subscribe((s, prev) => {
  if (prev.pending === null || s.pending !== null) return
  const { returnToModels, returnToFeed } = useStash.getState()
  if (returnToFeed) { useStash.setState({ returnToFeed: false, feed: s.deployStatus !== 'done' }); return }
  if (!returnToModels) return
  useStash.setState({ returnToModels: false, models: s.deployStatus !== 'done' })
})
