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
import type { ChestDraft, MyDeployment } from '../store/useShards'
import { useShards } from '../store/useShards'
import { useCyberspace } from '../store/useCyberspace'
import { hiddenLabel } from '../lib/hidden'
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
  return d.type === 'shard' ? d.shard?.name ?? 'object' : hiddenLabel(d, 24)
}

/**
 * Fly the scene to one deployment and open it as a tap on it in the scene
 * would: the item modal (SecretModal), which names its kind correctly and
 * stands at the top of the screen (arkinox, 2026-10-10: the record called a
 * key a shard and sat at the bottom). The wire record (DeploymentDetail) is
 * one tap further, WIRE RECORD in that modal. The bag modal closes so the
 * item modal is what is seen.
 */
export function goToDeployment(d: MyDeployment): void {
  const unit = d.type === 'shard' ? d.shard?.unit ?? 0 : 0
  useStash.setState(NONE_OPEN)
  useCyberspace.getState().focusItem({ x: BigInt(d.at.x), y: BigInt(d.at.y), z: BigInt(d.at.z) }, d.plane, depName(d), unit)
  useShards.getState().selectSecret(d.eventId)
}

interface StashModals {
  models: boolean
  bags: boolean
  /** The bag whose contents are open, by lookup id. */
  bag: string | null
  /** The Builder's HIDE MESSAGE composer. */
  message: boolean
  /** The FORGE A KEY composer (Keys and Chests B1 §3.1). */
  key: boolean
  /** The SEAL A CHEST composer. */
  chest: boolean
  /** The SHARD FEED window: everyone's published objects, outside the Builder. */
  feed: boolean
  /** A deploy was started from the Models modal: cancelling it reopens the modal. */
  returnToModels: boolean
  /** A deploy was started from the SHARD FEED window (USE IN BUILDER): cancelling it reopens the window. */
  returnToFeed: boolean
  /**
   * A shard is being aimed into a chest from the SEAL A CHEST composer
   * (arkinox, 2026-10-10): the composer comes back when the aim ends,
   * signed or canceled alike, with the draft (useBuilder `itemDraft`).
   */
  returnToChest: boolean
  /** The PLACE OBJECT tab last picked from, so a cancelled deploy comes back to it. */
  pickTab: 'mine' | 'feed' | null
  /** USE IN BUILDER from the SHARD FEED window: the object lined up, the window back on a cancel. */
  useFromFeed: (object: FeedObject) => void
  /** AIM on a shard in the chest composer: the composer closes, the shard is lined up, the composer comes back after. */
  aimIntoChest: (draft: ChestDraft, contentIndex: number) => void
  openModels: () => void
  openBags: () => void
  openBag: (lookupId: string) => void
  /** Write a message to hide at the build cursor. */
  openMessage: () => void
  /** Forge a key to hide at the build cursor. */
  openKey: () => void
  /** Seal a chest to hide at the build cursor. */
  openChest: () => void
  /** Browse the Shard Feed. */
  openFeed: () => void
  close: () => void
  /** Start deploying a model from the Models modal. */
  deployModel: (id: string) => void
  /** Line up an object from the Shard Feed at the build cursor, as a copy. */
  deployObject: (object: FeedObject) => void
}

/** Every modal closed: what each open sets before opening its own. */
const NONE_OPEN = { models: false, bags: false, bag: null, message: false, key: false, chest: false, feed: false }

export const useStash = create<StashModals>((set) => ({
  models: false,
  bags: false,
  bag: null,
  message: false,
  key: false,
  chest: false,
  feed: false,
  returnToModels: false,
  returnToFeed: false,
  returnToChest: false,
  pickTab: null,
  openModels: () => set({ ...NONE_OPEN, models: true }),
  openBags: () => set({ ...NONE_OPEN, bags: true }),
  openBag: (lookupId) => set({ ...NONE_OPEN, bag: lookupId }),
  openMessage: () => set({ ...NONE_OPEN, message: true }),
  openKey: () => set({ ...NONE_OPEN, key: true }),
  openChest: () => set({ ...NONE_OPEN, chest: true }),
  openFeed: () => set({ ...NONE_OPEN, feed: true }),
  close: () => set(NONE_OPEN),
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
  aimIntoChest: (draft, contentIndex) => {
    set({ chest: false, returnToChest: true })
    useShards.getState().startDeployIntoChest(draft, contentIndex)
  },
}))

// A deploy that ends without placing anything, started from the Models
// modal, returns to it; one that places, or any other ending, forgets. An
// aim into a chest returns to the composer either way: it placed nothing
// in the world, and the chest is still to be hidden.
useShards.subscribe((s, prev) => {
  if (prev.pending === null || s.pending !== null) return
  const { returnToModels, returnToFeed, returnToChest } = useStash.getState()
  if (returnToChest) { useStash.setState({ ...NONE_OPEN, returnToChest: false, chest: true }); return }
  if (returnToFeed) { useStash.setState({ returnToFeed: false, feed: s.deployStatus !== 'done' }); return }
  if (!returnToModels) return
  useStash.setState({ returnToModels: false, models: s.deployStatus !== 'done' })
})
