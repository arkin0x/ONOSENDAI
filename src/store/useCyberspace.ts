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
  estimateHopCost,
  findLcaHeight,
  hexToCoord,
  sectorTag,
  sidestepLanding,
  xyzToCoord,
  xyzToSectorId,
  type Plane,
} from 'cyberspace-core'
import {
  MAX_SCALE_EXP,
  alignTo,
  canonicalQuaternion,
  cellDelta,
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
import { cancelProof, postProof, type ProofMode, type ProofResponse } from '../lib/workers'

/** Matches cyberspace-core's DEFAULT_MAX_COMPUTE_HEIGHT. */
export const MAX_COMPUTE_HEIGHT = 20

const ZERO_EVENT_ID = '0'.repeat(64)

export type ProofStatus = 'idle' | 'computing' | 'done' | 'infeasible'

export interface ProofState {
  status: ProofStatus
  /** Which primitive the last/current commit used. */
  mode: ProofMode
  /** 0..1 while computing. */
  progress: number
  elapsedMs: number
  proofHash: string | null
  regionN: string | null
  terrainK: number | null
  lca: { x: number; y: number; z: number } | null
  /** Cantor pairings for hops; SHA-256 evaluations for sidesteps. */
  totalOps: number | null
  message: string | null
}

const IDLE_PROOF: ProofState = {
  status: 'idle',
  mode: 'hop',
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
  /** Completed Merkle sidesteps. */
  sidesteps: number
  /** Cumulative Cantor pairings across all completed hops. */
  totalOps: number
  /** Cumulative SHA-256 evaluations across all completed sidesteps. */
  totalHashes: number
  /** Cumulative proof compute time. */
  totalMs: number
}

export interface CyberspaceState {
  identity: { pubkey: string; npub: string }
  position: Position
  /** Where the next hop would land. Free to noodle; costs nothing until committed. */
  cursor: Position
  /** Destination of the in-flight proof; null when nothing is computing. */
  pendingTarget: Position | null
  plane: Plane
  scaleExp: number
  /** Current view quaternion (camera snaps instantly to this). */
  view: Quaternion
  viewHistory: Quaternion[]
  proof: ProofState
  /** Chained from the previous hop, mirroring the protocol's prev-event link. */
  prevEventId: string
  chain: ChainStats
  /** History of all committed positions for rendering the path trail. */
  positionHistory: Position[]

  moveCursor: (dir: AxisDirection) => void
  setCursorAtCell: (row: number, col: number) => void
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
  /** Axes as they appear on screen right now, including free orbit. */
  screenAxes: ViewAxes | null
  setScreenAxes: (a: ViewAxes) => void
  coordHex: () => string
  sector: () => string
  /** Which position the view centers on: cursor when active, avatar otherwise. */
  viewCenter: () => Position
  /**
   * Cursor's render-space position relative to the avatar's aligned cell.
   * Used as the camera pan offset so the cursor stays at screen centre.
   */
  cursorOffset: () => [number, number, number]
}

/**
 * Spawn identity: persist a keypair in localStorage so refreshing the page
 * keeps the same location and identity. The 256-bit pubkey decodes directly
 * to x/y/z/plane, so identity IS position (spec section 8.3).
 */
const STORAGE_KEY = 'onosendai:nsec'
const CHAIN_KEY = 'onosendai:chain'

interface PersistedState {
  position: { x: string; y: string; z: string }
  prevEventId: string
  chain: ChainStats
  positionHistory: Array<{ x: string; y: string; z: string }>
}

function loadOrGenerateKey(): Uint8Array {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const { data } = nip19.decode(stored)
      if (data instanceof Uint8Array && data.length === 32) return data
    }
  } catch { /* corrupt or missing; fall through to generate */ }
  const fresh = generateSecretKey()
  const nsec = nip19.nsecEncode(fresh)
  try { localStorage.setItem(STORAGE_KEY, nsec) } catch { /* private mode */ }
  return fresh
}

function positionToStrings(pos: Position): { x: string; y: string; z: string } {
  return { x: pos.x.toString(), y: pos.y.toString(), z: pos.z.toString() }
}

function stringsToPosition(s: { x: string; y: string; z: string }): Position {
  return { x: BigInt(s.x), y: BigInt(s.y), z: BigInt(s.z) }
}

function loadPersistedState(): {
  position: Position
  prevEventId: string
  chain: ChainStats
  positionHistory: Position[]
} | null {
  try {
    const raw = localStorage.getItem(CHAIN_KEY)
    if (!raw) return null
    const data: PersistedState = JSON.parse(raw)
    return {
      position: stringsToPosition(data.position),
      prevEventId: data.prevEventId,
      chain: data.chain,
      positionHistory: data.positionHistory.map(stringsToPosition),
    }
  } catch { /* corrupt or missing */ }
  return null
}

function savePersistedState(
  position: Position,
  prevEventId: string,
  chain: ChainStats,
  positionHistory: Position[],
): void {
  try {
    const data: PersistedState = {
      position: positionToStrings(position),
      prevEventId,
      chain,
      positionHistory: positionHistory.map(positionToStrings),
    }
    localStorage.setItem(CHAIN_KEY, JSON.stringify(data))
  } catch { /* quota exceeded or private mode */ }
}

const secretKey = loadOrGenerateKey()
const pubkeyHex = getPublicKey(secretKey)
const SPAWN = coordToXyz(hexToCoord(pubkeyHex))
const persisted = loadPersistedState()

// Reserved for signing spawn/hop events when publishing lands.
void secretKey

let requestId = 0

export const useCyberspace = create<CyberspaceState>((set, get) => ({
  identity: { pubkey: pubkeyHex, npub: nip19.npubEncode(pubkeyHex) },
  position: persisted?.position ?? SPAWN,
  cursor: persisted?.position ?? SPAWN,
  pendingTarget: null,
  plane: 0,
  scaleExp: 0,
  view: topDownQuaternion(),
  viewHistory: [],
  proof: IDLE_PROOF,
  prevEventId: persisted?.prevEventId ?? ZERO_EVENT_ID,
  chain: persisted?.chain ?? { hops: 0, sidesteps: 0, totalOps: 0, totalHashes: 0, totalMs: 0 },
  positionHistory: persisted?.positionHistory ?? [SPAWN],

  moveCursor: (dir) => {
    const { cursor, scaleExp } = get()
    const step = stepFor(scaleExp) * BigInt(dir.dir)

    const next: Position = { ...cursor }
    next[dir.axis] = clampAxis(cursor[dir.axis] + step)

    // Clamped against the axis wall: nowhere to go.
    if (next[dir.axis] === cursor[dir.axis]) return
    set({ cursor: next })
  },

  setCursorAtCell: (row, col) => {
    const { position, scaleExp, view } = get()
    const axes = viewAxes(view)
    const origin = alignedOrigin(position, scaleExp)
    const step = stepFor(scaleExp)

    // Grid row/col are in screen space (row=0 is top, col=0 is left).
    // Convert to world position by applying offsets along the screen axes.
    const next: Position = { ...position }
    next[axes.right.axis] = clampAxis(
      origin[axes.right.axis] + BigInt(col) * step * BigInt(axes.right.dir)
    )
    next[axes.up.axis] = clampAxis(
      origin[axes.up.axis] + BigInt(row) * step * BigInt(axes.up.dir)
    )
    // Depth axis stays at avatar's position (clicking doesn't move into/out of screen).

    set({ cursor: next })
  },

  commit: () => {
    const { position, cursor, plane, prevEventId, proof } = get()
    // One proof at a time. X cancels a commit you regret.
    if (proof.status === 'computing') return
    if (samePosition(position, cursor)) return

    // Route by feasibility: a hop straight to the cursor when the Cantor tree
    // fits, otherwise a Merkle sidestep across the blocking wall(s). The
    // sidestep lands 1 gibson past the boundary, not at the cursor; the
    // cursor keeps the rest of the journey for the next commit.
    const estimate = estimateHopCost(
      position.x, position.y, position.z,
      cursor.x, cursor.y, cursor.z,
      plane,
      MAX_COMPUTE_HEIGHT,
    )
    const mode: ProofMode = estimate.exceedsLimit ? 'sidestep' : 'hop'
    const to = mode === 'sidestep' ? sidestepTarget(position, cursor) : { ...cursor }
    if (samePosition(position, to)) return

    const id = ++requestId
    set({
      pendingTarget: to,
      proof: { ...IDLE_PROOF, status: 'computing', mode },
    })

    postProof({
      id,
      mode,
      from: position,
      to,
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
    const newPosition = pendingTarget ?? position
    set({
      // The proof covers exactly position -> pendingTarget, so only now does
      // the avatar arrive.
      position: newPosition,
      pendingTarget: null,
      proof: {
        status: 'done',
        mode: msg.mode,
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
        hops: chain.hops + (msg.mode === 'hop' ? 1 : 0),
        sidesteps: chain.sidesteps + (msg.mode === 'sidestep' ? 1 : 0),
        totalOps: chain.totalOps + (msg.mode === 'hop' ? msg.totalOps : 0),
        totalHashes: chain.totalHashes + (msg.mode === 'sidestep' ? msg.totalOps : 0),
        totalMs: chain.totalMs + msg.elapsedMs,
      },
      positionHistory: [...get().positionHistory, newPosition],
    })
    
    // Persist the updated state
    const updated = get()
    savePersistedState(
      updated.position,
      updated.prevEventId,
      updated.chain,
      updated.positionHistory
    )
  },

  screenAxes: null,

  setScreenAxes: (a) => {
    const cur = get().screenAxes
    // All three compared. Comparing only right and up let a stale `out` survive
    // any orbit that left those two unchanged, so R and F kept pushing along
    // whichever axis they had been bound to when the camera last passed here.
    const same = (x: AxisDirection, y: AxisDirection): boolean =>
      x.axis === y.axis && x.dir === y.dir
    if (cur && same(cur.right, a.right) && same(cur.up, a.up) && same(cur.out, a.out)) return
    set({ screenAxes: a })
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

  /**
   * Which position the camera tracks: the cursor when it is away from the
   * avatar, the avatar's position otherwise. Centering on the cursor means
   * zooming keeps the cursor stable on screen, which is what you want when
   * inspecting terrain at a target.
   */
  viewCenter: () => {
    const { position, cursor } = get()
    return samePosition(position, cursor) ? position : cursor
  },

  /**
   * Cursor's render-space position relative to the avatar's aligned cell.
   * Negating this gives the world-group translation that puts the cursor at
   * screen centre, so zooming tracks the cursor instead of the avatar.
   */
  cursorOffset: (): [number, number, number] => {
    const { position, cursor, scaleExp, view } = get()
    const axes = viewAxes(view)
    const origin = alignedOrigin(position, scaleExp)
    // Cell CENTRES, the same convention the cursor cube, the avatar and the path
    // trail draw with. This used to mix cellOffset on two axes with cellDelta on
    // the third, so the point field's focus, the camera target and the cursor
    // cube could sit up to half a cell apart above scaleExp 0: the terrain
    // magnified around a spot the cursor was not quite on.
    return [axes.right, axes.up, axes.out].map((a) =>
      cellDelta(alignTo(cursor[a.axis], scaleExp), origin[a.axis], scaleExp) * a.dir,
    ) as [number, number, number]
  },
}))

// DEV is also true under vitest, which runs in node, and importing this module
// for alignedOrigin must not blow up on a missing window. Same reason the
// localStorage calls above are wrapped.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  // Lets the browser harness read and drive real state instead of inferring it
  // from the HUD, the same way __terrain and __screenAxes work.
  ;(window as unknown as { __store?: unknown }).__store = useCyberspace
}

/** Positions are equal when all three axes match. */
export function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

/**
 * Where a sidestep commit toward `cursor` actually lands: each axis whose
 * crossing is beyond the Cantor ceiling steps 1 gibson past its wall; every
 * other axis stays put, because a spec-valid sidestep only crosses walls.
 */
export function sidestepTarget(position: Position, cursor: Position): Position {
  const land = (p: bigint, c: bigint): bigint =>
    findLcaHeight(p, c) > MAX_COMPUTE_HEIGHT ? sidestepLanding(p, c) : p
  return {
    x: land(position.x, cursor.x),
    y: land(position.y, cursor.y),
    z: land(position.z, cursor.z),
  }
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
