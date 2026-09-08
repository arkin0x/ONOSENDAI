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

/** How many keys are kept before the oldest are dropped. */
export const SECRETS_MAX = 400

const KEY = 'onosendai:secrets'

export interface HeldKey {
  /** What the relay knows the region as: sha256 of the key. */
  lookupId: string
  /** The key itself, 32 bytes as hex. */
  keyHex: string
  /** A cube of side 2^height, aligned on every axis. */
  height: number
  /** The region's aligned corner, as decimal strings. */
  base: { x: string; y: string; z: string }
  plane: Plane
  /** How it was come by: your own scanning, or a hop HOSAKA computed for you. */
  source: 'scan' | 'cloud'
  /** The action that bought it, for the chain overlay's key marker. */
  eventId?: string
  /** First held, in seconds since the epoch. */
  at: number
}

interface SecretsState {
  keys: Record<string, HeldKey>
  /** Note a key you now hold; keeps the one already held rather than replacing it. */
  hold: (keys: HeldKey[]) => void
  /** Forget one region. The key is gone; standing there again recomputes it. */
  forget: (lookupId: string) => void
  /** Forget every region. */
  forgetAll: () => void
  load: () => void
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
