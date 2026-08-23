/**
 * useShards.ts — deploying shards, and everything visible in the world.
 *
 * Deploy is its own small mode: pick a shard, aim the cursor, choose a height
 * to hide it at, and place. The height is the discovery radius (spec §7.3):
 * height 0 is a single gibson, so only someone at that exact point finds it;
 * higher hides it across a wider aligned cube that costs more to compute. What
 * gets published is a kind 33330 event whose ciphertext only opens to the
 * region key, so the coordinate never leaves this device in the clear.
 *
 * Two sources feed the world. `mine` is what this device deployed, kept with
 * its key so it always renders regardless of scanning: you can always see your
 * own chalk. `discovered` is what a background scan turned up near you and
 * managed to decrypt. Both persist their inputs, not their positions, so a
 * reload re-derives everything honestly.
 */

import { create } from 'zustand'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from './useCyberspace'
import { publishMany, SHARD_RELAYS } from '../lib/relay'
import { deployTemplate, type DecodedShard } from '../lib/shardEvents'
import { bytesToHex, hexToBytes } from '../lib/events'
import { useWorkshop } from './useWorkshop'
import type { ShardModel } from '../lib/shards'
import type { Plane } from 'cyberspace-core'
import type { Position } from '../lib/space'

/** What this device put out there: enough to re-render and re-publish it. */
export interface MyDeployment {
  eventId: string
  shard: ShardModel
  at: { x: string; y: string; z: string }
  plane: Plane
  height: number
  lookupId: string
  keyHex: string
  createdAt: number
  published: boolean
}

/** A shard placed in the world, ready to draw. */
export interface WorldShard {
  key: string
  shard: ShardModel
  at: Position
  plane: Plane
  height: number
  mine: boolean
}

/** The realistic ceiling for interactive scanning (spec §7.3 says 0..16). */
export const SCAN_MAX_HEIGHT = 12

export type DeployStatus = 'idle' | 'working' | 'done' | 'error'

interface ShardsState {
  /** Which shard is being deployed, or null. */
  deployId: string | null
  deployHeight: number
  deployStatus: DeployStatus
  deployError: string | null
  mine: MyDeployment[]
  /** Discovered shards keyed by event id. */
  discovered: Record<string, DecodedShard>

  startDeploy: (shardId: string) => void
  setDeployHeight: (h: number) => void
  cancelDeploy: () => void
  deploy: () => Promise<void>
  undeploy: (eventId: string) => void
  addDiscovered: (shards: DecodedShard[]) => void
  deployShard: () => ShardModel | null
  worldShards: () => WorldShard[]
}

const MINE_KEY = 'onosendai:deployments'

function loadMine(): MyDeployment[] {
  try {
    const raw = localStorage.getItem(MINE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.filter((d) => d && d.eventId && d.shard) : []
  } catch { return [] }
}

function saveMine(mine: MyDeployment[]): void {
  try { localStorage.setItem(MINE_KEY, JSON.stringify(mine)) } catch { /* quota or private mode */ }
}

export const useShards = create<ShardsState>((set, get) => ({
  deployId: null,
  deployHeight: 0,
  deployStatus: 'idle',
  deployError: null,
  mine: loadMine(),
  discovered: {},

  startDeploy: (shardId) => set({ deployId: shardId, deployStatus: 'idle', deployError: null }),
  setDeployHeight: (h) => set({ deployHeight: Math.max(0, Math.min(SCAN_MAX_HEIGHT, Math.round(h))) }),
  cancelDeploy: () => set({ deployId: null, deployStatus: 'idle', deployError: null }),

  deploy: async () => {
    const { deployId, deployHeight } = get()
    const shard = useWorkshop.getState().shards.find((s) => s.id === deployId)
    if (!shard || shard.vertices.length === 0) return
    set({ deployStatus: 'working', deployError: null })

    const cs = useCyberspace.getState()
    // The cursor is where you aimed; the plane is the one you are in.
    const at: Position = { ...cs.cursor }
    const plane = cs.plane
    const createdAt = Math.floor(Date.now() / 1000)

    try {
      const { template, lookupId, key } = await deployTemplate({ shard, at, plane, height: deployHeight, createdAt, maxComputeHeight: MAX_COMPUTE_HEIGHT })
      const event = cs.sign(template)
      const live = cs.live
      const result = live ? await publishMany(SHARD_RELAYS, event) : { ok: true as const }

      const deployment: MyDeployment = {
        eventId: event.id,
        shard,
        at: { x: at.x.toString(), y: at.y.toString(), z: at.z.toString() },
        plane,
        height: deployHeight,
        lookupId,
        keyHex: bytesToHex(key),
        createdAt,
        published: live && result.ok,
      }
      const mine = [...get().mine, deployment]
      set({ mine, deployStatus: 'done', deployId: null })
      saveMine(mine)
    } catch (err) {
      set({ deployStatus: 'error', deployError: err instanceof Error ? err.message : String(err) })
    }
  },

  undeploy: (eventId) => {
    // Local only: a published event cannot be unpublished, but it can be
    // dropped from what this device draws and re-derives.
    const mine = get().mine.filter((d) => d.eventId !== eventId)
    set({ mine }); saveMine(mine)
  },

  addDiscovered: (shards) => {
    if (shards.length === 0) return
    const discovered = { ...get().discovered }
    let changed = false
    for (const s of shards) if (!discovered[s.id]) { discovered[s.id] = s; changed = true }
    if (changed) set({ discovered })
  },

  deployShard: () => useWorkshop.getState().shards.find((s) => s.id === get().deployId) ?? null,

  worldShards: () => {
    const out: WorldShard[] = []
    const seen = new Set<string>()
    for (const d of get().mine) {
      seen.add(d.eventId)
      out.push({ key: d.eventId, shard: d.shard, at: { x: BigInt(d.at.x), y: BigInt(d.at.y), z: BigInt(d.at.z) }, plane: d.plane, height: d.height, mine: true })
    }
    for (const d of Object.values(get().discovered)) {
      if (seen.has(d.id)) continue
      out.push({ key: d.id, shard: d.shard, at: d.at, plane: d.plane, height: d.height, mine: false })
    }
    return out
  },
}))

/** The key bytes for one of my deployments, for republish or re-derivation. */
export function keyBytes(hex: string): Uint8Array {
  return hexToBytes(hex)
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __shards?: unknown }).__shards = useShards
}
