/**
 * useSecrets.ts — the regions you can open.
 *
 * A region key is not a password you are given, it is a number you computed:
 * the Cantor root of an aligned region, hashed once for the key and twice for
 * the lookup id it is published under (spec §7.2). Holding it means two
 * things at once, and only for that exact region: you can ask the relay what
 * is hidden there, and you can read what comes back.
 *
 * Keys are not hierarchical. A key for a region a mile wide tells you nothing
 * about the block inside it: the child has its own root, and sha256 leaves no
 * ladder between them. So this is a list, not a tree, and standing somewhere
 * new adds the nested cubes you now stand in rather than refining an old key.
 *
 * What is kept is small: the key is 32 bytes and the rest is where and when.
 * The regions themselves are never stored, only the numbers that open them.
 */

import { create } from 'zustand'
import type { Plane } from 'cyberspace-core'
import type { HosakaRegionKeyResult } from '../lib/hosaka'
import { cloudClient, useCyberspace } from './useCyberspace'
import { useShards } from './useShards'

/** How many keys are kept before the oldest are dropped. */
export const SECRETS_MAX = 400

const KEY = 'onosendai:secrets'

export interface HeldKey {
  /** What the relay knows the region as: sha256 of the key. */
  lookupId: string
  /** The key itself, 32 bytes as hex. */
  keyHex: string
  /**
   * How wide the region is. A hiding place is a cube, so one height covers it;
   * a movement's region is a box, its three axes at their own crossing
   * heights, and `heights` carries those. `height` is the largest either way.
   */
  height: number
  heights?: { x: number; y: number; z: number }
  /** The region's aligned corner, as decimal strings. */
  base: { x: string; y: string; z: string }
  plane: Plane
  /**
   * How it was come by: a hop of your own, which grants the region it crossed;
   * a scan that opened something where you stood; or a purchase from HOSAKA.
   */
  source: 'hop' | 'scan' | 'cloud'
  /** The action that bought it, for the chain overlay's key marker. */
  eventId?: string
  /** First held, in seconds since the epoch. */
  at: number
}

/** A key being bought: what it is for, and how far along. */
export interface Buying {
  height: number
  status: 'submitting' | 'computing'
  costMsats: number
  /** The provider's own estimate for the job, in seconds. */
  estSeconds: number | null
  startedAt: number
}

interface SecretsState {
  keys: Record<string, HeldKey>
  /** The purchase in flight, or null. */
  buying: Buying | null
  /** The region the list last sent you to look at: drawn bright, the rest dimmed. */
  focused: string | null
  focus: (lookupId: string | null) => void
  /** Why the last purchase did not happen. */
  buyError: string | null
  /** Note a key you now hold; keeps the one already held rather than replacing it. */
  hold: (keys: HeldKey[]) => void
  /** Forget one region. The key is gone; standing there again recomputes it. */
  forget: (lookupId: string) => void
  /** Forget every region. */
  forgetAll: () => void
  load: () => void
  /**
   * Buy the key to the aligned cube of side 2^height around a coordinate.
   *
   * The work is three axis subtrees at that height, which is a hop's work and
   * is priced as one; this machine can do the small ones for itself as it
   * moves, so this is for the heights it cannot. Paid from the HOSAKA balance:
   * with nothing in it the purchase stops and says so, since topping up is the
   * Cloud panel's business and not a thing to do behind a modal.
   */
  buy: (at: { x: bigint; y: bigint; z: bigint }, plane: Plane, height: number) => Promise<boolean>
}

/** Roughly what one entry costs in local storage. */
export function bytesOf(k: HeldKey): number {
  return JSON.stringify(k).length
}

/** The regions held, newest first. */
export function heldList(keys: Record<string, HeldKey>): HeldKey[] {
  return Object.values(keys).sort((a, b) => b.at - a.at || b.height - a.height)
}

export const useSecrets = create<SecretsState>((set, get) => ({
  keys: {},
  buying: null,
  buyError: null,
  focused: null,

  hold: (incoming) => {
    if (incoming.length === 0) return
    const keys = { ...get().keys }
    let changed = false
    for (const k of incoming) {
      if (keys[k.lookupId]) continue
      keys[k.lookupId] = k
      changed = true
    }
    if (!changed) return
    const trimmed = trim(keys)
    set({ keys: trimmed })
    save(trimmed)
  },

  forget: (lookupId) => {
    if (!get().keys[lookupId]) return
    const keys = { ...get().keys }
    delete keys[lookupId]
    set({ keys })
    save(keys)
  },

  forgetAll: () => {
    set({ keys: {} })
    save({})
  },

  focus: (lookupId) => set({ focused: lookupId }),

  buy: async (at, plane, height) => {
    if (get().buying) return false
    const cs = useCyberspace.getState()
    const client = cloudClient(cs.cloudPrefs.apiUrl)
    set({ buying: { height, status: 'submitting', costMsats: 0, estSeconds: null, startedAt: Date.now() }, buyError: null })
    try {
      const job = await client.submitRegionKey(at, height)
      if (job.payment_required) {
        set({ buying: null, buyError: `HOSAKA wants ${Math.ceil((job.amount_due_msats ?? job.cost_msats) / 1000)} sats for a 2^${height} key and your balance is short. Top up in the Cloud panel.` })
        return false
      }
      if (!job.poll_token) {
        set({ buying: null, buyError: 'HOSAKA took the job but gave no way to follow it.' })
        return false
      }
      set({ buying: { height, status: 'computing', costMsats: job.cost_msats, estSeconds: null, startedAt: Date.now() } })
      const done = await client.waitForJob(job.id, job.poll_token)
      if (done.status !== 'completed' || !done.result) {
        set({ buying: null, buyError: done.error ? `HOSAKA could not compute it: ${done.error}` : 'HOSAKA could not compute it.' })
        return false
      }
      const r = done.result as HosakaRegionKeyResult
      if (!r.secret_key || !r.lookup_id) {
        set({ buying: null, buyError: 'HOSAKA returned no key.' })
        return false
      }
      get().hold([{
        lookupId: r.lookup_id,
        keyHex: r.secret_key,
        height: r.height ?? height,
        base: {
          x: String(r.base?.x ?? (at.x >> BigInt(height)) << BigInt(height)),
          y: String(r.base?.y ?? (at.y >> BigInt(height)) << BigInt(height)),
          z: String(r.base?.z ?? (at.z >> BigInt(height)) << BigInt(height)),
        },
        plane,
        source: 'cloud',
        at: Math.floor(Date.now() / 1000),
      }])
      set({ buying: null })
      // What was bought is worth looking in at once.
      void useShards.getState().rescan(r.lookup_id, r.secret_key)
      return true
    } catch (err) {
      set({ buying: null, buyError: err instanceof Error ? err.message : String(err) })
      return false
    }
  },

  load: () => {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object') return
      const keys: Record<string, HeldKey> = {}
      for (const [id, v] of Object.entries(parsed as Record<string, HeldKey>)) {
        if (v && typeof v.keyHex === 'string' && typeof v.height === 'number' && v.base) keys[id] = v
      }
      set({ keys })
    } catch { /* nothing kept */ }
  },
}))

function trim(keys: Record<string, HeldKey>): Record<string, HeldKey> {
  const list = heldList(keys)
  if (list.length <= SECRETS_MAX) return keys
  const out: Record<string, HeldKey> = {}
  for (const k of list.slice(0, SECRETS_MAX)) out[k.lookupId] = k
  return out
}

function save(keys: Record<string, HeldKey>): void {
  try { localStorage.setItem(KEY, JSON.stringify(keys)) } catch { /* private mode */ }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __secrets?: unknown }).__secrets = useSecrets
}

/** Whether a chain action left you a region key, and whether you still hold it. */
export type KeyState = 'none' | 'held' | 'gone'

/**
 * What an action yielded.
 *
 * A hop computes the Cantor root of the region it crossed, which is the key to
 * whatever is hidden there (spec §7). A sidestep computes a Merkle path across
 * one boundary and no root at all, which is the whole difference between
 * unlocking a wall and bypassing it. A spawn comes from nowhere and crosses
 * nothing.
 *
 * `gone` means the key is not in the list any more: forgotten here, or never
 * kept because the region is larger than this machine sweeps.
 */
export function keyStateForAction(
  action: { type: string; position: { x: bigint; y: bigint; z: bigint }; plane: Plane },
  previous: { position: { x: bigint; y: bigint; z: bigint } } | null,
  keys: Record<string, HeldKey>,
  lcaHeight: (a: bigint, b: bigint) => number,
): { state: KeyState; height: number | null } {
  if (action.type !== 'hop' || !previous) return { state: 'none', height: null }
  const height = Math.max(
    lcaHeight(previous.position.x, action.position.x),
    lcaHeight(previous.position.y, action.position.y),
    lcaHeight(previous.position.z, action.position.z),
  )
  if (height <= 0) return { state: 'none', height: null }
  const h = BigInt(height)
  const base = {
    x: String((action.position.x >> h) << h),
    y: String((action.position.y >> h) << h),
    z: String((action.position.z >> h) << h),
  }
  for (const k of Object.values(keys)) {
    if (k.height !== height || k.plane !== action.plane) continue
    if (k.base.x === base.x && k.base.y === base.y && k.base.z === base.z) return { state: 'held', height }
  }
  return { state: 'gone', height }
}
