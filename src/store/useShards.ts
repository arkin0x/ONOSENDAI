/**
 * useShards.ts — hiding things at a location, and everything visible in the world.
 *
 * A hidden thing is a shard or a text message, wrapped as a signed inner event
 * inside a location-encrypted kind:33330 envelope (see lib/hidden). Deploy is
 * one small mode for both: choose the content, aim the cursor, pick a height to
 * hide it at, and place. Height is the discovery radius (spec §7.3): height 0
 * is a single gibson, so only someone at that exact point finds it; higher
 * hides it across a wider aligned cube that costs more to compute.
 *
 * Two sources feed the world. `mine` is what this device deployed, kept with
 * its key so it always renders: you can always see your own chalk. `discovered`
 * is what a background scan turned up near you and could decrypt and verify.
 */

import { create } from 'zustand'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from './useCyberspace'
import { publishMany, query, relaySet } from '../lib/relay'
import { bytesToHex, hexToBytes } from '../lib/events'
import { regionKeyAt } from '../lib/shardCrypto'
import {
  HIDDEN_KIND,
  REGION_TAG,
  hideTemplate,
  messageInnerTemplate,
  shardInnerTemplate,
  unhide,
  type Hidden,
  type HiddenType,
} from '../lib/hidden'
import { useWorkshop } from './useWorkshop'
import type { ShardModel } from '../lib/shards'
import type { Plane } from 'cyberspace-core'
import type { Position } from '../lib/space'

/** What this device put out there: enough to re-render, re-publish, or delete it. */
export interface MyDeployment {
  eventId: string
  type: HiddenType
  shard?: ShardModel
  text?: string
  at: { x: string; y: string; z: string }
  plane: Plane
  height: number
  lookupId: string
  keyHex: string
  relays: string[]
  createdAt: number
  published: boolean
  /** Whether it went out with the NIP-70 author-only mark. */
  protectedEvent: boolean
}

/** Something placed in the world, ready to draw. */
export interface WorldItem {
  key: string
  type: HiddenType
  at: Position
  plane: Plane
  height: number
  mine: boolean
  author?: string
  shard?: ShardModel
  text?: string
}

/** What a deploy is placing, before it lands. */
export type DeployPending =
  | { type: 'shard'; shardId: string }
  | { type: 'message'; text: string }

/** The realistic ceiling for interactive scanning (spec §7.3 says 0..16). */
export const SCAN_MAX_HEIGHT = 12

export type DeployStatus = 'idle' | 'working' | 'done' | 'error'

interface ShardsState {
  pending: DeployPending | null
  deployHeight: number
  deployStatus: DeployStatus
  deployError: string | null
  mine: MyDeployment[]
  discovered: Record<string, Hidden>
  deleted: Record<string, true>
  inspecting: string | null
  /** A background scan is in flight. */
  scanning: boolean

  startDeployShard: (shardId: string) => void
  startDeployMessage: (text: string) => void
  setDeployHeight: (h: number) => void
  cancelDeploy: () => void
  deploy: () => Promise<void>
  deleteInstance: (eventId: string) => Promise<void>
  inspect: (eventId: string | null) => void
  addDiscovered: (items: Hidden[]) => void
  setScanning: (scanning: boolean) => void
  /** Freshly derive the region key and confirm the relay returns and opens it. */
  testDiscovery: (eventId: string) => Promise<boolean>
  /** The shard being deployed, when a shard is pending. */
  pendingShard: () => ShardModel | null
  worldItems: () => WorldItem[]
}

const MINE_KEY = 'onosendai:deployments'
const DELETED_KEY = 'onosendai:deployments-deleted'

function loadMine(): MyDeployment[] {
  try {
    const raw = localStorage.getItem(MINE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.filter((d) => d && d.eventId && (d.shard || d.text)) : []
  } catch { return [] }
}

function saveMine(mine: MyDeployment[]): void {
  try { localStorage.setItem(MINE_KEY, JSON.stringify(mine)) } catch { /* quota or private mode */ }
}

function loadDeleted(): Record<string, true> {
  try {
    const raw = localStorage.getItem(DELETED_KEY)
    if (!raw) return {}
    const list = JSON.parse(raw)
    const out: Record<string, true> = {}
    if (Array.isArray(list)) for (const id of list) if (typeof id === 'string') out[id] = true
    return out
  } catch { return {} }
}

function saveDeleted(deleted: Record<string, true>): void {
  try { localStorage.setItem(DELETED_KEY, JSON.stringify(Object.keys(deleted))) } catch { /* quota or private mode */ }
}

function positionOf(d: MyDeployment): Position {
  return { x: BigInt(d.at.x), y: BigInt(d.at.y), z: BigInt(d.at.z) }
}

export const useShards = create<ShardsState>((set, get) => ({
  pending: null,
  deployHeight: 0,
  deployStatus: 'idle',
  deployError: null,
  mine: loadMine(),
  discovered: {},
  deleted: loadDeleted(),
  inspecting: null,
  scanning: false,

  startDeployShard: (shardId) => set({ pending: { type: 'shard', shardId }, deployStatus: 'idle', deployError: null }),
  startDeployMessage: (text) => set({ pending: { type: 'message', text }, deployStatus: 'idle', deployError: null }),
  setDeployHeight: (h) => set({ deployHeight: Math.max(0, Math.min(SCAN_MAX_HEIGHT, Math.round(h))) }),
  cancelDeploy: () => set({ pending: null, deployStatus: 'idle', deployError: null }),

  deploy: async () => {
    const { pending, deployHeight } = get()
    if (!pending) return
    const cs = useCyberspace.getState()
    const at: Position = { ...cs.cursor }
    const plane = cs.plane
    const createdAt = Math.floor(Date.now() / 1000)

    let shard: ShardModel | undefined
    let text: string | undefined
    let innerTemplate
    if (pending.type === 'shard') {
      shard = useWorkshop.getState().shards.find((s) => s.id === pending.shardId)
      if (!shard || shard.vertices.length === 0) return
      innerTemplate = shardInnerTemplate(shard, at, plane, createdAt)
    } else {
      text = pending.text.trim()
      if (!text) return
      innerTemplate = messageInnerTemplate(text, at, plane, createdAt)
    }

    set({ deployStatus: 'working', deployError: null })
    try {
      const rk = regionKeyAt(at, deployHeight, MAX_COMPUTE_HEIGHT)
      const inner = cs.sign(innerTemplate)
      const live = cs.live

      // Prefer the protected (author-only) form. A relay that blocks it rather
      // than auth-gating it is common, so fall back to an unprotected copy so
      // the content still lands and can be discovered.
      let protectedEvent = true
      let event = cs.sign(await hideTemplate(inner, rk.key, rk.lookupId, deployHeight, true))
      let result = live ? await publishMany(relaySet(), event) : { ok: true as const, reason: undefined }
      if (live && !result.ok && /protect|blocked/i.test((result as { reason?: string }).reason ?? '')) {
        protectedEvent = false
        event = cs.sign(await hideTemplate(inner, rk.key, rk.lookupId, deployHeight, false))
        result = await publishMany(relaySet(), event)
      }

      const deployment: MyDeployment = {
        eventId: event.id,
        type: pending.type,
        shard,
        text,
        at: { x: at.x.toString(), y: at.y.toString(), z: at.z.toString() },
        plane,
        height: deployHeight,
        lookupId: rk.lookupId,
        keyHex: bytesToHex(rk.key),
        relays: relaySet(),
        createdAt,
        published: live && result.ok,
        protectedEvent: protectedEvent && (!live || result.ok),
      }
      const mine = [...get().mine, deployment]
      set({ mine, deployStatus: 'done', pending: null })
      saveMine(mine)
    } catch (err) {
      set({ deployStatus: 'error', deployError: err instanceof Error ? err.message : String(err) })
    }
  },

  deleteInstance: async (eventId) => {
    const dep = get().mine.find((d) => d.eventId === eventId)
    if (!dep) return
    const cs = useCyberspace.getState()
    // NIP-09: a kind 5 naming the event tells relays to drop it. Only meaningful
    // if it was published; a local instance never left the device.
    if (cs.live && dep.published) {
      const del = cs.sign({
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        content: 'hidden content removed',
        tags: [['e', eventId], ['k', String(HIDDEN_KIND)]],
      })
      try { await publishMany(dep.relays ?? relaySet(), del) } catch { /* best effort */ }
    }
    const mine = get().mine.filter((d) => d.eventId !== eventId)
    const deleted = { ...get().deleted, [eventId]: true as const }
    const discovered = { ...get().discovered }
    delete discovered[eventId]
    const wasInspecting = get().inspecting === eventId
    set({ mine, deleted, discovered, inspecting: wasInspecting ? null : get().inspecting })
    if (wasInspecting) cs.clearFocus()
    saveMine(mine); saveDeleted(deleted)
  },

  inspect: (eventId) => set({ inspecting: eventId }),

  addDiscovered: (items) => {
    if (items.length === 0) return
    const { deleted } = get()
    const discovered = { ...get().discovered }
    let changed = false
    for (const h of items) if (!discovered[h.eventId] && !deleted[h.eventId]) { discovered[h.eventId] = h; changed = true }
    if (changed) set({ discovered })
  },

  setScanning: (scanning) => set({ scanning }),

  testDiscovery: async (eventId) => {
    const dep = get().mine.find((d) => d.eventId === eventId)
    if (!dep || !dep.published) return false
    // Derive the region key fresh from the coordinate, as a stranger would,
    // rather than trusting the stored one: this proves the region gate, not
    // just that we kept the key.
    const rk = regionKeyAt(positionOf(dep), dep.height, MAX_COMPUTE_HEIGHT)
    const events = await query({ kinds: [HIDDEN_KIND], [`#${REGION_TAG}`]: [rk.lookupId] })
    for (const ev of events) {
      const got = await unhide(ev, rk.key)
      if (got && got.eventId === eventId) return true
    }
    return false
  },

  pendingShard: () => {
    const { pending } = get()
    if (pending?.type !== 'shard') return null
    return useWorkshop.getState().shards.find((s) => s.id === pending.shardId) ?? null
  },

  worldItems: () => {
    const out: WorldItem[] = []
    const seen = new Set<string>()
    for (const d of get().mine) {
      seen.add(d.eventId)
      out.push({ key: d.eventId, type: d.type, at: positionOf(d), plane: d.plane, height: d.height, mine: true, shard: d.shard, text: d.text })
    }
    for (const h of Object.values(get().discovered)) {
      if (seen.has(h.eventId)) continue
      out.push({ key: h.eventId, type: h.type, at: h.at, plane: h.plane, height: h.height, mine: false, author: h.author, shard: h.shard, text: h.text })
    }
    return out
  },
}))

/** The key bytes for one of my deployments. */
export function keyBytes(hex: string): Uint8Array {
  return hexToBytes(hex)
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __shards?: unknown }).__shards = useShards
}
