/**
 * useCeremony.ts — the moment a key opens a bag.
 *
 * Finding is a decryption, so the scene shows one: items born from a scan
 * carry a birth time here, and the shard and message renderers read it to run
 * their decode. The HUD shows a chip with how many were found, which stays
 * until tapped and opens the Nearby Loot list. A DEV
 * trigger fabricates a found bag beside the avatar so the ceremony can be
 * watched without hiding anything first.
 */

import { create } from 'zustand'
import type { Plane } from 'cyberspace-core'
import { hiddenLabel, type Hidden } from '../lib/hidden'
import { regionLabel } from '../lib/loot'
import { GRID_HALF, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from './useCyberspace'
import { findHidden, useShards } from './useShards'
import { useMutes } from './useMutes'

export interface FoundChip {
  id: string
  /** What was found last, for the decoding line: a message preview or a shard name. */
  label: string
  /** Region size of the last find. */
  meta: string
  /** Everything found since the chip was last tapped away. */
  count: number
  at: number
  /** The finds counted, newest first, each with the line and region size the chip would give it. */
  finds: ChipFind[]
  /**
   * Those counted that left the finds because a room they stand in was closed
   * (CLOSE, store/rooms closeDoor): out of the count until they are found again,
   * which OPEN on the door does (arkinox, 2026-11-09). See chipCount.
   */
  away: string[]
}

/** One find the chip counts: its id, and its line and region size as the chip shows them. */
export interface ChipFind { id: string; label: string; meta: string }

/** How many the chip says were found here: everything since the last tap, less what stands in a room closed since. */
export function chipCount(chip: FoundChip | null): number {
  return chip ? chip.count - chip.away.length : 0
}

/**
 * What the chip's lines name: the newest find still in the world, not one standing in
 * a room closed since (arkinox, 2026-11-09). With that room open again, the newest of
 * all again. Null when every find counted is closed away (the chip is not drawn then).
 */
export function chipLine(chip: FoundChip | null): { label: string; meta: string } | null {
  if (!chip) return null
  if (chip.away.length === 0) return { label: chip.label, meta: chip.meta }
  const away = new Set(chip.away)
  const here = chip.finds.find((f) => !away.has(f.id))
  return here ? { label: here.label, meta: here.meta } : null
}

interface CeremonyState {
  /** Item key -> performance.now() when this client first opened it. */
  births: Record<string, number>
  chip: FoundChip | null
  /**
   * Finds opened in the other plane than the one the view is in: one bag
   * holds a region and its twin (spec §7.6 Planes), so a scan opens both
   * planes' entries. Each waits here for its own plane, and gets its
   * ceremony when the view goes there (watchPlane).
   */
  pending: Hidden[]
  /** Items just opened by a scan; starts their decode and raises the chip. */
  mark: (items: Hidden[]) => void
  /** These finds left with a room closed (CLOSE): out of the chip's count, kept to come back. */
  leave: (ids: Iterable<string>) => void
  dismiss: () => void
  /** DEV: fabricate a found bag beside the avatar and run the ceremony on it. */
  preview: () => void
  clearPreview: () => void
}

/**
 * A find that left with a closed room is back in the count the moment it is among
 * the finds again: OPEN on the door fills its room again (store/rooms fillRoom),
 * and a chest opened in it before restores what it held. Nothing is marked again,
 * so no find ceremony plays a second time and the chip's line does not decode anew.
 * Watched from the first close on (useShards is still loading when this module is).
 */
let watching = false
function watchReturns(): void {
  if (watching) return
  watching = true
  useShards.subscribe((s, prev) => {
    if (s.discovered === prev.discovered) return
    const chip = useCeremony.getState().chip
    if (!chip || chip.away.length === 0) return
    const away = chip.away.filter((id) => !s.discovered[id])
    if (away.length !== chip.away.length) useCeremony.setState({ chip: { ...chip, away } })
  })
}

/**
 * A find waiting in `pending` gets its ceremony when the view enters its
 * plane, if it is still among the finds (a delete or a retraction since
 * leaves it out). Watched from the first find set aside.
 */
let watchingPlane = false
function watchPlane(): void {
  if (watchingPlane) return
  watchingPlane = true
  useCyberspace.subscribe((s, prev) => {
    if (s.anchorPlane === prev.anchorPlane) return
    const pending = useCeremony.getState().pending
    if (pending.length === 0) return
    const discovered = useShards.getState().discovered
    const ready = pending.filter((h) => h.plane === s.anchorPlane)
    useCeremony.setState({ pending: pending.filter((h) => h.plane !== s.anchorPlane) })
    const still = ready.filter((h) => discovered[h.eventId])
    if (still.length > 0) useCeremony.getState().mark(still)
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
  chip: null,
  pending: [],

  mark: (opened) => {
    // A find in the other plane is not here: no decode, no chip, until the
    // view is in its plane (watchPlane). An entry with no C took the plane
    // it was read from, so it is here.
    const { here: found, elsewhere } = byViewPlane(opened, useCyberspace.getState().anchorPlane)
    if (elsewhere.length > 0) {
      const waiting = new Set(get().pending.map((h) => h.eventId))
      set({ pending: [...get().pending, ...elsewhere.filter((h) => !waiting.has(h.eventId))] })
      watchPlane()
    }
    // The tour's district shows only its curators' things (useShards
    // curated): a stranger's find there raises no chip, whose line is the
    // find's own text, and gets no decode (review of #364).
    const curated = useShards.getState().curated
    // Nor does anything the mute list hides (store/useMutes).
    const muted = useMutes.getState().muted
    const me = useCyberspace.getState().identity.pubkey
    const items = (curated ? found.filter((h) => curated.includes(h.author)) : found).filter((h) => !findHidden(h, muted, me))
    if (items.length === 0) return
    const now = performance.now()
    const births = { ...get().births }
    for (const h of items) births[h.eventId] = now
    const first = items[0]
    const label = hiddenLabel(first, 40)
    // Finds pile onto a chip nobody has tapped yet: the count is everything
    // since the last tap, and the chip stays until it is.
    const was = get().chip
    const count = (was?.count ?? 0) + items.length
    // Newest first: this mark's first find is the one the chip names.
    const finds = [...items.map((h, i) => ({ id: h.eventId, label: i === 0 ? label : hiddenLabel(h, 40), meta: regionLabel(h.height) })), ...(was?.finds ?? [])]
    set({ births, chip: { id: `${now}`, label, meta: regionLabel(first.height), count, at: now, finds, away: was?.away ?? [] } })
  },

  leave: (gone) => {
    const chip = get().chip
    if (!chip) return
    const counted = new Set(chip.finds.map((f) => f.id))
    const away = new Set(chip.away)
    for (const id of gone) if (counted.has(id)) away.add(id)
    if (away.size === chip.away.length) return
    watchReturns()
    set({ chip: { ...chip, away: [...away] } })
  },

  dismiss: () => set({ chip: null }),

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
