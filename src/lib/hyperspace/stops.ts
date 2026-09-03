/**
 * stops.ts: DECK-0001 v3 §1 and §2. A stop is one Bitcoin block as a location.
 *
 * The merkle root's plane bit decides the kind: 1 = a port in ideaspace at the
 * root coordinate, 0 = a landfall on the WGS84 surface at a point the block
 * hash picks (landfall.ts). Anchors (kind 321) are the discovery convenience;
 * the parser below is strict but silent, in the style of parseAction: anything
 * malformed returns null rather than throwing.
 *
 * Legacy anchors (published before v3) carry C = merkle root for every block
 * and no M tag. For a plane-0 legacy anchor the landfall coordinate must be
 * derived from H; we derive the float64 approximation eagerly (about a metre
 * of error, fine for the index and the renderer) and the exact decimal
 * coordinate lazily, only when a verifier-visible value is needed.
 */
import { hexToCoord, coordToHex } from 'cyberspace-core'
import { landfallCoord, landfallCoordApprox } from './landfall'

export type StopKind = 'port' | 'landfall'

export interface Stop {
  height: number
  kind: StopKind
  /** Merkle root, 64 lowercase hex. For a port this is also the coordinate. */
  merkleRoot: string
  /** Block hash, 64 lowercase hex, when known (needed to derive a landfall). */
  blockHash: string | null
  /** Exact stop coordinate, when known. Ports always have it. */
  coordExact: bigint | null
  /** Approximate coordinate for indexing and rendering; equals coordExact for ports. */
  coordApprox: bigint
}

const HEX64 = /^[0-9a-f]{64}$/

export function planeOfMerkleRoot(merkleRootHex: string): 0 | 1 {
  const last = merkleRootHex[merkleRootHex.length - 1]
  return (parseInt(last, 16) & 1) as 0 | 1
}

function tag(tags: string[][], name: string): string | undefined {
  for (const t of tags) if (t.length >= 2 && t[0] === name) return t[1]
  return undefined
}

export interface AnchorEvent {
  kind: number
  tags: string[][]
}

/**
 * Parse a kind 321 anchor into a Stop, handling both v3 and legacy formats.
 * Returns null for anything malformed or unusable.
 */
export function stopFromAnchor(ev: AnchorEvent): Stop | null {
  if (ev.kind !== 321) return null
  const bStr = tag(ev.tags, 'B')
  if (bStr === undefined || !/^\d+$/.test(bStr)) return null
  const height = Number.parseInt(bStr, 10)
  if (!Number.isSafeInteger(height) || height < 0) return null
  const c = tag(ev.tags, 'C')?.toLowerCase()
  if (!c || !HEX64.test(c)) return null
  const m = tag(ev.tags, 'M')?.toLowerCase()
  const h = tag(ev.tags, 'H')?.toLowerCase()
  if (h !== undefined && !HEX64.test(h)) return null

  if (m !== undefined) {
    // v3 anchor: M is the merkle root, C is the stop coordinate.
    if (!HEX64.test(m)) return null
    const kind: StopKind = planeOfMerkleRoot(m) === 1 ? 'port' : 'landfall'
    if (kind === 'port' && c !== m) return null
    if (kind === 'landfall' && !h) return null
    const coord = hexToCoord(c)
    return { height, kind, merkleRoot: m, blockHash: h ?? null, coordExact: coord, coordApprox: coord }
  }

  // Legacy anchor: C is the merkle root.
  const kind: StopKind = planeOfMerkleRoot(c) === 1 ? 'port' : 'landfall'
  if (kind === 'port') {
    const coord = hexToCoord(c)
    return { height, kind, merkleRoot: c, blockHash: h ?? null, coordExact: coord, coordApprox: coord }
  }
  if (!h) return null // a legacy landfall without a block hash cannot be placed
  return {
    height,
    kind,
    merkleRoot: c,
    blockHash: h,
    coordExact: null,
    coordApprox: landfallCoordApprox(h),
  }
}

/** Exact stop coordinate, deriving and caching the landfall when needed. */
export function stopCoordExact(stop: Stop): bigint {
  if (stop.coordExact !== null) return stop.coordExact
  if (!stop.blockHash) throw new Error(`stop ${stop.height} has no block hash to derive a landfall from`)
  stop.coordExact = landfallCoord(stop.blockHash)
  return stop.coordExact
}

export function stopCoordHex(stop: Stop): string {
  return coordToHex(stopCoordExact(stop))
}

/**
 * In dataspace the stops are landfalls on Earth's surface, and above this
 * scale Earth itself is a speck: the shell drew as a clot of dots at the
 * planet's position with nothing to be on, right through the CYBERSPACE
 * view. Ports in ideaspace are points in a volume and draw at every scale.
 */
export const LANDFALL_SCALE_MAX = 60

/** Whether the stop layers (field, cubes, burst) draw at all in this plane at this zoom. */
export function stopsDrawn(plane: 0 | 1, scaleExp: number): boolean {
  return plane === 1 || scaleExp <= LANDFALL_SCALE_MAX
}
