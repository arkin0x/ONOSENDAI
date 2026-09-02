/**
 * useCeremony.ts — the moment a key opens a bag.
 *
 * Finding is a decryption, so the scene shows one: items born from a scan
 * carry a birth time here, and the shard and message renderers read it to run
 * their decode. The HUD shows a KEY FOUND chip for the newest find. A DEV
 * trigger fabricates a found bag beside the avatar so the ceremony can be
 * watched without hiding anything first.
 */

import { create } from 'zustand'
import type { Plane } from 'cyberspace-core'
import { messagePreview, type Hidden } from '../lib/hidden'
import { regionLabel } from '../lib/loot'
import type { ShardModel } from '../lib/shards'
import { useCyberspace } from './useCyberspace'
import { useShards } from './useShards'

export interface FoundChip {
  id: string
  /** What was found, for the decoding line: a message preview or a shard name. */
  label: string
  /** Region size and item count. */
  meta: string
  at: number
}

interface CeremonyState {
  /** Item key -> performance.now() when this client first opened it. */
  births: Record<string, number>
  chip: FoundChip | null
  /** Items just opened by a scan; starts their decode and raises the chip. */
  mark: (items: Hidden[]) => void
  dismiss: () => void
  /** DEV: fabricate a found bag beside the avatar and run the ceremony on it. */
  preview: () => void
  clearPreview: () => void
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
    mode: 'lines',
    vertices: path.map((p, i) => ({ p, c: i < 16 ? [0, 0.9, 1] : [0.97, 0.58, 0.1] })),
    faces: [],
    updatedAt: Math.floor(Date.now() / 1000),
  }
}

export const useCeremony = create<CeremonyState>((set, get) => ({
  births: {},
  chip: null,

  mark: (items) => {
    if (items.length === 0) return
    const now = performance.now()
    const births = { ...get().births }
    for (const h of items) births[h.eventId] = now
    const first = items[0]
    const label = first.type === 'message' ? messagePreview(first.text ?? '', 40) : first.shard?.name ?? 'shard'
    set({ births, chip: { id: `${now}`, label, meta: `${regionLabel(first.height)} · ${items.length} ${items.length === 1 ? 'item' : 'items'}`, at: now } })
  },

  dismiss: () => set({ chip: null }),

  preview: () => {
    get().clearPreview()
    const cs = useCyberspace.getState()
    const { anchor, anchorPlane, scaleExp } = cs
    const cell = 1n << BigInt(scaleExp)
    const plane: Plane = anchorPlane
    const now = Math.floor(Date.now() / 1000)
    const base = { bagId: `preview-bag-${now}`, author: PREVIEW_AUTHOR, plane, height: 5, createdAt: now }
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
}
