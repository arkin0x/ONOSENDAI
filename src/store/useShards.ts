/**
 * useShards.ts — hiding things at a location, and everything visible in the world.
 *
 * A hidden thing is a shard or a text message: a signed inner event, kept in a
 * region BAG — one location-encrypted kind:33330 envelope per (author, region,
 * height), holding every item that author hid there. Deploying reads the bag,
 * appends the new item, and rewrites it (spec §8.6: keyed by d=lookup_id, and
 * addressable, so the newer bag replaces the old). One envelope, many items, no
 * per-item tags. Height is the discovery radius (spec §7.3): 0 is a single
 * gibson; higher hides it across a wider aligned cube that costs more to find.
 *
 * `mine` is what this device deployed, kept with each item's signed inner event
 * so a bag can be rebuilt without the relay; `discovered` is what a scan turned
 * up near you and could decrypt and verify.
 */

import { create } from 'zustand'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from './useCyberspace'
import { publishMany, query, relaySet } from '../lib/relay'
import { bytesToHex, hexToBytes, type NostrEvent } from '../lib/events'
import { regionKeyAt } from '../lib/shardCrypto'
import {
  HIDDEN_KIND,
  bagInners,
  bagTemplate,
  messageInnerTemplate,
  shardInnerTemplate,
  unbag,
  type Hidden,
  type HiddenType,
} from '../lib/hidden'
import { useWorkshop } from './useWorkshop'
import type { ShardModel } from '../lib/shards'
import type { Plane } from 'cyberspace-core'
import type { Position } from '../lib/space'

/** One item this device hid. Its identity is its inner event id. */
export interface MyDeployment {
  /** The item's stable identity: its signed inner event id. */
  eventId: string
  /** The signed inner event, so the region bag can be rebuilt from here. */
  inner: NostrEvent
  /** The envelope currently holding it; changes when the bag is rewritten. */
  bagId: string
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
  testDiscovery: (eventId: string) => Promise<boolean>
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
    return Array.isArray(list) ? list.filter((d) => d && d.eventId && d.inner && (d.shard || d.text)) : []
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

function positionOf(d: { at: { x: string; y: string; z: string } }): Position {
  return { x: BigInt(d.at.x), y: BigInt(d.at.y), z: BigInt(d.at.z) }
}

/** Union of inner events by id, order preserved. */
function mergeInners(a: NostrEvent[], b: NostrEvent[]): NostrEvent[] {
  const seen = new Set(a.map((e) => e.id))
  const out = a.slice()
  for (const e of b) if (!seen.has(e.id)) { seen.add(e.id); out.push(e) }
  return out
}

/**
 * A per-region clock so each rewrite of a bag is strictly newer than the last,
 * which is what makes the relay keep the new one (addressable replacement takes
 * the greatest created_at). Session-local; seeded from what is already on disk.
 */
const bagClock = new Map<string, number>()
function nextBagAt(lookupId: string): number {
  const now = Math.floor(Date.now() / 1000)
  const at = Math.max(now, (bagClock.get(lookupId) ?? 0) + 1)
  bagClock.set(lookupId, at)
  return at
}

export const useShards = create<ShardsState>((set, get) => {
  const cyber = () => useCyberspace.getState()

  /** Build and publish the region bag. */
  async function publishBag(inners: NostrEvent[], key: Uint8Array, lookupId: string, height: number, live: boolean): Promise<{ event: NostrEvent; published: boolean }> {
    const createdAt = nextBagAt(lookupId)
    const event = cyber().sign(await bagTemplate(inners, key, lookupId, height, createdAt))
    const result = live ? await publishMany(relaySet(), event) : { ok: true as const }
    return { event, published: live && result.ok }
  }

  /** The author's current bag inners for a region: relay (authoritative) + local. */
  async function gatherInners(lookupId: string, key: Uint8Array, live: boolean): Promise<NostrEvent[]> {
    const local = get().mine.filter((d) => d.lookupId === lookupId).map((d) => d.inner)
    if (!live) return local
    try {
      const events = await query({ kinds: [HIDDEN_KIND], authors: [cyber().identity.pubkey], '#d': [lookupId] })
      const newest = events.sort((a, b) => b.created_at - a.created_at)[0]
      const relay = newest ? await bagInners(newest, key) : []
      return mergeInners(relay, local)
    } catch {
      return local
    }
  }

  return {
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
      const cs = cyber()
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
        const existing = await gatherInners(rk.lookupId, rk.key, live)
        const allInners = mergeInners(existing, [inner])
        const { event, published } = await publishBag(allInners, rk.key, rk.lookupId, deployHeight, live)

        const item: MyDeployment = {
          eventId: inner.id,
          inner,
          bagId: event.id,
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
          published,
        }
        // Every item now in this region's bag shares its new envelope and status.
        const mine = [
          ...get().mine.map((d) => (d.lookupId === rk.lookupId ? { ...d, bagId: event.id, published } : d)),
          item,
        ]
        set({ mine, deployStatus: 'done', pending: null })
        saveMine(mine)
      } catch (err) {
        set({ deployStatus: 'error', deployError: err instanceof Error ? err.message : String(err) })
      }
    },

    deleteInstance: async (eventId) => {
      const item = get().mine.find((d) => d.eventId === eventId)
      if (!item) return
      const cs = cyber()
      const key = hexToBytes(item.keyHex)
      const remaining = get().mine.filter((d) => d.lookupId === item.lookupId && d.eventId !== eventId)

      let mine: MyDeployment[]
      if (remaining.length > 0) {
        // Rewrite the region bag without this item; the newer bag replaces it.
        const { event, published } = await publishBag(remaining.map((d) => d.inner), key, item.lookupId, item.height, cs.live)
        mine = get().mine
          .filter((d) => d.eventId !== eventId)
          .map((d) => (d.lookupId === item.lookupId ? { ...d, bagId: event.id, published } : d))
      } else {
        // The last thing in the region: delete the envelope itself (NIP-09).
        if (cs.live && item.published) {
          const del = cs.sign({
            kind: 5,
            created_at: Math.floor(Date.now() / 1000),
            content: 'hidden content removed',
            tags: [['e', item.bagId], ['k', String(HIDDEN_KIND)]],
          })
          try { await publishMany(item.relays ?? relaySet(), del) } catch { /* best effort */ }
        }
        mine = get().mine.filter((d) => d.eventId !== eventId)
      }

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
      const item = get().mine.find((d) => d.eventId === eventId)
      if (!item || !item.published) return false
      // Region key derived fresh from the coordinate, as a stranger would.
      const rk = regionKeyAt(positionOf(item), item.height, MAX_COMPUTE_HEIGHT)
      const events = await query({ kinds: [HIDDEN_KIND], '#d': [rk.lookupId] })
      for (const ev of events) {
        const items = await unbag(ev, rk.key)
        if (items.some((h) => h.eventId === eventId)) return true
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
  }
})

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __shards?: unknown }).__shards = useShards
}
