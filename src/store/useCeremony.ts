/**
 * useCeremony.ts — the moment a key opens a bag.
 *
 * Finding is a decryption, so the scene shows one: items born from a scan
 * carry a birth time here, and the shard and message renderers read it to run
 * their decode. The HUD counts them on the NEARBY chip, the orange +N, until
 * the Nearby list is opened (store/nearbyNew.ts; owner, 2026-11-26: the
 * FOUND HERE chip it replaced was "always too long"). A DEV
 * trigger fabricates a found bag beside the avatar so the ceremony can be
 * watched without hiding anything first.
 */

import { create } from 'zustand'
import type { Plane } from 'cyberspace-core'
import type { Hidden } from '../lib/hidden'
import { GRID_HALF, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from './useCyberspace'
import { findHidden, useShards } from './useShards'
import { useMutes } from './useMutes'
import { tvIsOn } from './tvOn'
import { addNearbyNew } from './nearbyNew'

interface CeremonyState {
  /** Item key -> performance.now() when this client first opened it. */
  births: Record<string, number>
  /**
   * Finds opened in the other plane than the one the view is in: one bag
   * holds a region and its twin (spec §7.6 Planes), so a scan opens both
   * planes' entries. Each waits here, at most PENDING_MAX of them, and gets
   * its ceremony when the view stands in its region in its plane
   * (releasePending).
   */
  pending: Hidden[]
  /** Items just opened by a scan; starts their decode and counts them new on NEARBY. */
  mark: (items: Hidden[]) => void
  /** DEV: fabricate a found bag beside the avatar and run the ceremony on it. */
  preview: () => void
  clearPreview: () => void
}

/** How many finds wait for their own plane at most; the oldest go first. */
export const PENDING_MAX = 64

/** Whether a view at `anchor` in `plane` stands in a find's region, in its plane. */
function standsIn(h: Pick<Hidden, 'at' | 'height' | 'plane'>, anchor: { x: bigint; y: bigint; z: bigint }, plane: Plane): boolean {
  const s = BigInt(h.height)
  return h.plane === plane && anchor.x >> s === h.at.x >> s && anchor.y >> s === h.at.y >> s && anchor.z >> s === h.at.z >> s
}

/**
 * Give the finds waiting in `pending` their ceremony where they are: when
 * the view stands inside a find's region, in its plane, at your head or in
 * a view you drive. Never while TV is on, whose shots move the view to
 * other people's places, and never spectating or in your history. A find no
 * longer among the finds (deleted or retracted since) is let go silently.
 */
export function releasePending(): void {
  const pending = useCeremony.getState().pending
  if (pending.length === 0 || tvIsOn()) return
  const cs = useCyberspace.getState()
  if (!cs.canDrive()) return
  const ready = pending.filter((h) => standsIn(h, cs.anchor, cs.anchorPlane))
  if (ready.length === 0) return
  useCeremony.setState({ pending: pending.filter((h) => !ready.includes(h)) })
  const discovered = useShards.getState().discovered
  const still = ready.filter((h) => discovered[h.eventId])
  if (still.length > 0) useCeremony.getState().mark(still)
}

/** Watched from the first find set aside: every move of the view may bring one into place. */
let watchingPlane = false
function watchPlane(): void {
  if (watchingPlane) return
  watchingPlane = true
  useCyberspace.subscribe((s, prev) => {
    if (s.anchor === prev.anchor && s.anchorPlane === prev.anchorPlane) return
    releasePending()
  })
}

/** Finds split by plane: those in the plane the view is in, and the rest (spec §7.6 Planes). */
export function byViewPlane(found: readonly Hidden[], plane: Plane): { here: Hidden[]; elsewhere: Hidden[] } {
  return { here: found.filter((h) => h.plane === plane), elsewhere: found.filter((h) => h.plane !== plane) }
}

const PREVIEW_AUTHOR = 'ab'.repeat(32)
let previewKeys: string[] = []

/** A wireframe construct: a cube traced as one line, corner to corner. */
function previewShard(unit: number): ShardModel {
  const path: Array<[number, number, number]> = [
    [-3, -3, -3], [3, -3, -3], [3, 3, -3], [-3, 3, -3], [-3, -3, -3],
    [-3, -3, 3], [3, -3, 3], [3, 3, 3], [-3, 3, 3], [-3, -3, 3],
    [-3, 3, 3], [-3, 3, -3], [3, 3, -3], [3, 3, 3], [3, -3, 3], [3, -3, -3],
    [0, 0, 0], [0, 5, 0], [0, 0, 0], [5, 0, 0], [0, 0, 0], [0, 0, 5],
  ]
  return {
    id: 'preview-construct',
    name: 'Tessier-Ashpool construct',
    unit,
    extent: GRID_HALF,
    // The spawn construct is drawn on cyberspace axes, never stood up.
    up: false,
    spin: 0,
    mode: 'lines',
    vertices: path.map((p, i) => ({ p, c: i < 16 ? [0, 0.9, 1] : [0.97, 0.58, 0.1] })),
    faces: [],
    // Milliseconds, as every other object's edit time is.
    updatedAt: Date.now(),
  }
}

export const useCeremony = create<CeremonyState>((set, get) => ({
  births: {},
  pending: [],

  mark: (opened) => {
    // A find in the other plane is not here: no decode, no +N, until the
    // view stands in its region in its plane (releasePending). An entry with no C took the plane
    // it was read from, so it is here.
    const { here: found, elsewhere } = byViewPlane(opened, useCyberspace.getState().anchorPlane)
    if (elsewhere.length > 0) {
      const waiting = new Set(get().pending.map((h) => h.eventId))
      set({ pending: [...get().pending, ...elsewhere.filter((h) => !waiting.has(h.eventId))].slice(-PENDING_MAX) })
      watchPlane()
    }
    // The tour's district shows only its curators' things (useShards
    // curated): a stranger's find there is not counted new and gets no
    // decode (review of #364).
    const curated = useShards.getState().curated
    // Nor does anything the mute list hides (store/useMutes).
    const muted = useMutes.getState().muted
    const me = useCyberspace.getState().identity.pubkey
    const items = (curated ? found.filter((h) => curated.includes(h.author)) : found).filter((h) => !findHidden(h, muted, me))
    if (items.length === 0) return
    const now = performance.now()
    const births = { ...get().births }
    for (const h of items) births[h.eventId] = now
    set({ births })
    // The orange +N on NEARBY (store/nearbyNew.ts). A find in a room closed
    // since leaves that count by leaving NEARBY's list, and OPEN brings it
    // back without marking it again, so no ceremony plays a second time.
    addNearbyNew(items.map((h) => h.eventId))
  },

  preview: () => {
    get().clearPreview()
    const cs = useCyberspace.getState()
    const { anchor, anchorPlane, scaleExp } = cs
    const cell = 1n << BigInt(scaleExp)
    const plane: Plane = anchorPlane
    const now = Math.floor(Date.now() / 1000)
    const base = { bagId: `preview-bag-${now}`, lookupId: '', author: PREVIEW_AUTHOR, plane, height: 5, createdAt: now }
    const shard: Hidden = {
      ...base,
      eventId: `preview-shard-${now}`,
      at: { x: anchor.x + 4n * cell, y: anchor.y, z: anchor.z },
      type: 'shard',
      shard: previewShard(scaleExp),
    }
    const message: Hidden = {
      ...base,
      eventId: `preview-message-${now}`,
      at: { x: anchor.x - 4n * cell, y: anchor.y + cell, z: anchor.z },
      type: 'message',
      text: 'The sky above the port was the color of television, tuned to a dead channel.',
    }
    previewKeys = [shard.eventId, message.eventId]
    useShards.getState().addDiscovered([shard, message])
    get().mark([message, shard])
  },

  clearPreview: () => {
    if (previewKeys.length === 0) return
    const discovered = { ...useShards.getState().discovered }
    for (const k of previewKeys) delete discovered[k]
    useShards.setState({ discovered })
    previewKeys = []
  },
}))

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __ceremony?: () => void }).__ceremony = () => useCeremony.getState().preview()
  ;(window as unknown as { __ceremonyClear?: () => void }).__ceremonyClear = () => useCeremony.getState().clearPreview()
  ;(window as unknown as { __ceremonyStore?: typeof useCeremony }).__ceremonyStore = useCeremony
}
