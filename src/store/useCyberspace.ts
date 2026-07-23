/**
 * useCyberspace.ts - the single source of truth for who you are, where you
 * are, where your uncommitted cursor is, and what the movement chain has cost.
 *
 * Movement is two-phase: WASD noodles a free cursor, Space commits the hop.
 * Only a commit computes a proof, and position advances only when that proof
 * lands, so the prevEventId chain stays contiguous: every position the avatar
 * has ever occupied is covered by a completed proof.
 */

import { create } from 'zustand'
import { Quaternion } from 'three'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import {
  coordToHex,
  coordToXyz,
  hexToCoord,
  sectorTag,
  xyzToCoord,
  xyzToSectorId,
  type Plane,
} from 'cyberspace-core'
import {
  MAX_SCALE_EXP,
  alignTo,
  canonicalQuaternion,
  clampAxis,
  rotateView,
  stepFor,
  topDownQuaternion,
  viewAxes,
  type AxisDirection,
  type Position,
  type RotateDirection,
  type ViewAxes,
} from '../lib/space'
import { cancelProof, postProof, type ProofResponse } from '../lib/workers'

/** Matches cyberspace-core's DEFAULT_MAX_COMPUTE_HEIGHT. */
const MAX_COMPUTE_HEIGHT = 20

const ZERO_EVENT_ID = '0'.repeat(64)

export type ProofStatus = 'idle' | 'computing' | 'done' | 'infeasible'

export interface ProofState {
  status: ProofStatus
  /** 0..1 while computing. */
  progress: number
  elapsedMs: number
  proofHash: string | null
  regionN: string | null
  terrainK: number | null
  lca: { x: number; y: number; z: number } | null
  totalOps: number | null
  message: string | null
}

const IDLE_PROOF: ProofState = {
  status: 'idle',
  progress: 0,
  elapsedMs: 0,
  proofHash: null,
  regionN: null,
  terrainK: null,
  lca: null,
  totalOps: null,
  message: null,
}

export interface ChainStats {
  /** Completed hops. The chain is contiguous by construction. */
  hops: number
  /** Cumulative Cantor pairings across all completed hops. */
  totalOps: number
  /** Cumulative proof compute time. */
  totalMs: number
}

interface CyberspaceState {
  identity: { pubkey: string; npub: string }
  position: Position
  /** Where the next hop would land. Free to noodle; costs nothing until committed. */
  cursor: Position
  /** Destination of the in-flight proof; null when nothing is computing. */
  pendingTarget: Position | null
  plane: Plane
  scaleExp: number
  view: Quaternion
  viewHistory: Quaternion[]
  proof: ProofState
  /** Chained from the previous hop, mirroring the protocol's prev-event link. */
  prevEventId: string
  chain: ChainStats

  moveCursor: (dir: AxisDirection) => void
  commit: () => void
  cancel: () => void
  adjustScale: (delta: number) => void
  rotate: (dir: RotateDirection) => void
  popView: () => void
  resetView: () => void
  canonicalView: () => void
  togglePlane: () => void
  applyProofMessage: (msg: ProofResponse) => void

  axes: () => ViewAxes
  coordHex: () => string
  sector: () => string
}

/**
 * Spawn identity: an ephemeral session keypair. Per spec section 8.3 the spawn
 * coordinate IS the pubkey: the 256-bit key decodes directly to x/y/z/plane.
 */
const secretKey = generateSecretKey()
const pubkeyHex = getPublicKey(secretKey)
const SPAWN = coordToXyz(hexToCoord(pubkeyHex))

// Reserved for signing spawn/hop events when publishing lands.
void secretKey

let requestId = 0

export const useCyberspace = create<CyberspaceState>((set, get) => ({
  identity: { pubkey: pubkeyHex, npub: nip19.npubEncode(pubkeyHex) },
  position: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z },
  cursor: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z },
  pendingTarget: null,
  plane: SPAWN.plane,
  scaleExp: 0,
  view: topDownQuaternion(),
  viewHistory: [],
  proof: IDLE_PROOF,
  prevEventId: ZERO_EVENT_ID,
  chain: { hops: 0, totalOps: 0, totalMs: 0 },

  moveCursor: (dir) => {
    const { cursor, scaleExp } = get()
    const step = stepFor(scaleExp) * BigInt(dir.dir)

    const next: Position = { ...cursor }
    next[dir.axis] = clampAxis(cursor[dir.axis] + step)

    // Clamped against the axis wall: nowhere to go.
    if (next[dir.axis] === cursor[dir.axis]) return
    set({ cursor: next })
  },

  commit: () => {
    const { position, cursor, plane, prevEventId, proof } = get()
    // One proof at a time. X cancels a commit you regret.
    if (proof.status === 'computing') return
    if (samePosition(position, cursor)) return

    const id = ++requestId
    set({
      pendingTarget: { ...cursor },
      proof: { ...IDLE_PROOF, status: 'computing' },
    })

    postProof({
      id,
      from: position,
      to: cursor,
      plane,
      prevEventId,
      maxComputeHeight: MAX_COMPUTE_HEIGHT,
    })
  },

  cancel: () => {
    const { proof, position } = get()
    if (proof.status === 'computing') {
      // A Cantor proof is one synchronous computation, so cancelling means
      // killing the worker thread. Position never moved; the chain is intact.
      cancelProof()
      requestId++
      set({ pendingTarget: null, proof: IDLE_PROOF })
      return
    }
    // Not computing: recall the cursor to where you actually stand.
    set({ cursor: { ...position } })
  },

  adjustScale: (delta) => {
    const next = Math.max(0, Math.min(MAX_SCALE_EXP, get().scaleExp + delta))
    if (next === get().scaleExp) return
    set({ scaleExp: next })
  },

  rotate: (dir) => {
    const { view, viewHistory } = get()
    set({
      view: rotateView(view, dir),
      viewHistory: [...viewHistory, view.clone()],
    })
  },

  popView: () => {
    const { viewHistory } = get()
    if (viewHistory.length === 0) return
    const previous = viewHistory[viewHistory.length - 1]
    set({ view: previous, viewHistory: viewHistory.slice(0, -1) })
  },

  resetView: () => {
    const { view, viewHistory } = get()
    set({ view: topDownQuaternion(), viewHistory: [...viewHistory, view.clone()] })
  },

  // Required preset per CYBERSPACE_V2.md section 11.3.
  canonicalView: () => {
    const { view, viewHistory } = get()
    set({ view: canonicalQuaternion(), viewHistory: [...viewHistory, view.clone()] })
  },

  togglePlane: () => {
    // A plane flip mid-proof would desync the in-flight terrain K.
    if (get().proof.status === 'computing') return
    set({ plane: get().plane === 0 ? 1 : 0, proof: IDLE_PROOF })
  },

  applyProofMessage: (msg) => {
    // Stale responses from a cancelled commit must not overwrite fresh state.
    if (msg.id !== requestId) return

    if (msg.type === 'progress') {
      set({
        proof: { ...get().proof, status: 'computing', progress: msg.fraction, elapsedMs: msg.elapsedMs },
      })
      return
    }

    if (msg.type === 'error') {
      set({
        pendingTarget: null,
        proof: {
          ...IDLE_PROOF,
          status: 'infeasible',
          elapsedMs: msg.elapsedMs,
          message: msg.message,
        },
      })
      return
    }

    const { pendingTarget, position, chain } = get()
    set({
      // The proof covers exactly position -> pendingTarget, so only now does
      // the avatar arrive.
      position: pendingTarget ?? position,
      pendingTarget: null,
      proof: {
        status: 'done',
        progress: 1,
        elapsedMs: msg.elapsedMs,
        proofHash: msg.proofHash,
        regionN: msg.regionN,
        terrainK: msg.terrainK,
        lca: msg.lca,
        totalOps: msg.totalOps,
        message: null,
      },
      prevEventId: msg.proofHash,
      chain: {
        hops: chain.hops + 1,
        totalOps: chain.totalOps + msg.totalOps,
        totalMs: chain.totalMs + msg.elapsedMs,
      },
    })
  },

  axes: () => viewAxes(get().view),

  coordHex: () => {
    const { position, plane } = get()
    return coordToHex(xyzToCoord(position.x, position.y, position.z, plane))
  },

  sector: () => {
    const { position } = get()
    return sectorTag(xyzToSectorId(position.x, position.y, position.z))
  },
}))

/** Positions are equal when all three axes match. */
export function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

/**
 * The aligned origin of the cell the avatar occupies at the current scale.
 */
export function alignedOrigin(position: Position, scaleExp: number): Position {
  return {
    x: alignTo(position.x, scaleExp),
    y: alignTo(position.y, scaleExp),
    z: alignTo(position.z, scaleExp),
  }
}
