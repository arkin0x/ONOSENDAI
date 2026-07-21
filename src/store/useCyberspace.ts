/**
 * useCyberspace.ts — the single source of truth for where you are, how big a
 * step is, which way you are looking, and what the last proof cost.
 */

import { create } from 'zustand'
import { Quaternion } from 'three'
import {
  AXIS_CENTER,
  coordToHex,
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
import { postProof, type ProofResponse } from '../lib/workers'

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

interface CyberspaceState {
  position: Position
  plane: Plane
  scaleExp: number
  view: Quaternion
  viewHistory: Quaternion[]
  proof: ProofState
  /** Chained from the previous hop, mirroring the protocol's prev-event link. */
  prevEventId: string
  moveCount: number

  move: (dir: AxisDirection) => void
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

/** Start at the centre of the axis, which is where the interesting boundaries are. */
const START: Position = { x: AXIS_CENTER, y: AXIS_CENTER, z: AXIS_CENTER }

let requestId = 0

export const useCyberspace = create<CyberspaceState>((set, get) => ({
  position: START,
  plane: 0,
  scaleExp: 0,
  view: topDownQuaternion(),
  viewHistory: [],
  proof: IDLE_PROOF,
  prevEventId: ZERO_EVENT_ID,
  moveCount: 0,

  move: (dir) => {
    const { position, scaleExp, plane, prevEventId } = get()
    const step = stepFor(scaleExp) * BigInt(dir.dir)

    const to: Position = { ...position }
    to[dir.axis] = clampAxis(position[dir.axis] + step)

    // Clamped against the axis wall: nothing moved, so there is nothing to prove.
    if (to[dir.axis] === position[dir.axis]) return

    const id = ++requestId
    set({
      position: to,
      moveCount: get().moveCount + 1,
      proof: { ...IDLE_PROOF, status: 'computing' },
    })

    postProof({
      id,
      from: position,
      to,
      plane,
      prevEventId,
      maxComputeHeight: MAX_COMPUTE_HEIGHT,
    })
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
    set({ plane: get().plane === 0 ? 1 : 0, proof: IDLE_PROOF })
  },

  applyProofMessage: (msg) => {
    // Stale responses from a superseded move must not overwrite fresh state.
    if (msg.id !== requestId) return

    if (msg.type === 'progress') {
      set({
        proof: { ...get().proof, status: 'computing', progress: msg.fraction, elapsedMs: msg.elapsedMs },
      })
      return
    }

    if (msg.type === 'error') {
      set({
        proof: {
          ...IDLE_PROOF,
          status: 'infeasible',
          elapsedMs: msg.elapsedMs,
          message: msg.message,
        },
      })
      return
    }

    set({
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
