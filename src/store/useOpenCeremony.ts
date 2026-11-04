/**
 * useOpenCeremony.ts: the OPEN ceremonies playing now, by identity and chest
 * (lib/ceremony.ts has the timeline; arkinox, 2026-10-30).
 *
 * OPEN starts one when it opened a chest this identity had not opened by
 * hand before, and the chest stands in the world to be seen: the card it
 * was opened from closes (and any list it was in), and the chest plays its
 * ceremony where it stands (scene/ChestCeremony). Nothing here moves the
 * camera, takes anything, or opens anything: TAKE stays in the card, which
 * a tap on the chest opens again.
 *
 * A ceremony ends by itself once its timeline has run; the chest is then
 * simply open, which is what a reload shows too (store/useOpenedChests).
 */

import { create } from 'zustand'
import { VANISH_MS, afterOpen, calmVanish, ceremonyLength, type CeremonyKind } from '../lib/ceremony'
import { ceremonyFeedback } from '../lib/ceremonySound'
import { openedKey } from './useOpenedChests'
import { useLootView } from './useLootView'
import { useShards } from './useShards'
import { useCyberspace } from './useCyberspace'

/** One ceremony playing: what plays, from when (performance.now() at the decrypt's return), and whether on the calm path. */
export interface Playing {
  kind: CeremonyKind
  at: number
  calm: boolean
}

interface OpenCeremonyState {
  /** By openedKey(identity, chest id). */
  playing: Record<string, Playing>
  begin: (me: string, chestId: string, kind: CeremonyKind, calm: boolean, at?: number) => void
  end: (key: string) => void
}

export const useOpenCeremony = create<OpenCeremonyState>((set, get) => ({
  playing: {},
  begin: (me, chestId, kind, calm, at = performance.now()) => {
    const key = openedKey(me, chestId)
    set({ playing: { ...get().playing, [key]: { kind, at, calm } } })
    setTimeout(() => { if (get().playing[key]?.at === at) get().end(key) }, ceremonyLength(kind, calm) + 50)
  },
  end: (key) => {
    if (!get().playing[key]) return
    const playing = { ...get().playing }
    delete playing[key]
    set({ playing })
  },
}))

/** Which chests the world draws as their look right now (scene/ChestLooks keeps it). */
const drawnNow = new Set<string>()

/** ChestLooks says which chests it draws. */
export function setDrawnLooks(ids: Iterable<string>): void {
  drawnNow.clear()
  for (const id of ids) drawnNow.add(id)
}

/** Whether the world draws this chest as its look now. */
export function lookDrawn(chestId: string): boolean {
  return drawnNow.has(chestId)
}

/** Close every card and list a chest can be opened from, so the world is seen. */
export function yieldToWorld(): void {
  const shards = useShards.getState()
  if (shards.selectedSecret !== null) shards.selectSecret(null)
  if (shards.nearbyOpen) shards.setNearbyOpen(false)
  if (useLootView.getState().selected) useLootView.getState().select(null)
}

/**
 * After OPEN opened a chest: the card yields and the ceremony plays when
 * this is the first time and the chest is drawn, and the sound and the buzz
 * are offered (each gated), the chime as the loot lands (`landMs`) only
 * when the loot is seen rising. Returns what it did, for the caller and tests.
 */
export function celebrateOpen(o: { me: string; chestId: string; kind: CeremonyKind; first: boolean; calm: boolean; landMs?: number }): ReturnType<typeof afterOpen> {
  const plan = afterOpen(o.first, lookDrawn(o.chestId))
  if (plan.yieldCards) yieldToWorld()
  if (plan.ceremony) useOpenCeremony.getState().begin(o.me, o.chestId, o.kind, o.calm)
  if (plan.feedback) ceremonyFeedback(o.kind, Date.now(), plan.ceremony ? o.landMs : undefined)
  return plan
}

/** One item going out of the world after TAKE: from when, and whether on the calm path. */
export interface Vanishing {
  at: number
  calm: boolean
}

interface TakeVanishState {
  /** By openedKey(identity, item id). Never kept: a reload draws a held item as its box at once. */
  playing: Record<string, Vanishing>
  begin: (me: string, id: string, calm: boolean, at?: number) => void
}

export const useTakeVanish = create<TakeVanishState>((set, get) => ({
  playing: {},
  begin: (me, id, calm, at = performance.now()) => {
    const key = openedKey(me, id)
    set({ playing: { ...get().playing, [key]: { at, calm } } })
    setTimeout(() => {
      if (get().playing[key]?.at !== at) return
      const playing = { ...get().playing }
      delete playing[key]
      set({ playing })
    }, (calm ? calmVanish() : VANISH_MS) + 50)
  },
}))

/**
 * TAKE on an item where it stands (arkinox, 2026-11-01): held, the list or the
 * card it was tapped in closes, and the item fades out where it stands
 * (scene/ItemVanish). A bag record stays open: it may be far from the item.
 */
export function takeAndVanish(id: string, calm: boolean): void {
  const shards = useShards.getState()
  if (shards.takeFound([id]).length === 0) return
  useTakeVanish.getState().begin(useCyberspace.getState().identity.pubkey, id, calm)
  if (shards.selectedSecret !== null) shards.selectSecret(null)
  if (shards.nearbyOpen) shards.setNearbyOpen(false)
}
