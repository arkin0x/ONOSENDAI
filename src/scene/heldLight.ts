/**
 * heldLight.ts (scene) - keeps the light of a glowing block in hand
 * (lib/terrain/heldLight.ts) on the blocks while TERRAIN is on, for
 * TerrainLayer's chunks.
 *
 * Asked every frame, it works the light out again only when something it
 * depends on changed: the cell your eye is in, the block in hand, Block
 * shading, the field, or the blocks of the 8 chunks at most that the cube
 * round your eye overlaps (another chunk loading or an edit far off leaves
 * it be). Then one flood from one cell, and one small texture upload; the
 * chunks' own light is never worked out again for it. Nothing glowing in
 * hand, TERRAIN off or Block shading off, and the light goes out.
 *
 * Others don't see your light: that would need it shared with them.
 */

import { Matrix4, Vector3 } from 'three'
import { computeHeldLight, fillHeldPass, heldChunksInto, heldCorner, heldPassScratch, HELD_BYTES, HELD_CHUNKS_MAX, type HeldGlow } from '../lib/terrain/heldLight'
import { offKey, type ChunkSlot, type TerrainWorld } from '../lib/terrain/world'

/** Where the light goes: terrainMaterial.ts setHeld. */
export interface HeldTarget { setHeld: (bytes: Uint8Array | null, corner?: readonly [number, number, number]) => void }

/** What one frame tells it. */
export interface HeldFrame {
  /** The field, or null outside TERRAIN. Its chunks by key, where it has them, so a check for a change round you makes no key. */
  world: (Pick<TerrainWorld, 'slotAt'> & { chunks?: ReadonlyMap<string, Pick<ChunkSlot, 'blocks' | 'version'>> }) | null
  /** Bumped by every change to the field's blocks (store/useTerrain.ts TerrainSession version). */
  version: number
  /** The glowing block in hand, or null. */
  glow: HeldGlow | null
  /** Block shading on: off, every chunk draws fully lit and there is nothing to light. */
  shading: boolean
  /** The cell your eye is in, cs offsets from the field's origin. */
  eye: readonly [number, number, number]
}

/** The last answer, and how long it took, for the tests and the dev probe. */
export interface HeldStats { updates: number; lastMs: number; totalMs: number }

export class HeldLightDriver {
  private bytes = new Uint8Array(HELD_BYTES)
  private on = false
  private world: unknown = null
  private glowId = -1
  private version = -1
  private eye: [number, number, number] = [NaN, NaN, NaN]
  private corner: [number, number, number] = [0, 0, 0]
  /** The chunks the cube overlaps when last worked out (`count` of them), their keys, and their versions then: kept in place, so a check makes nothing. */
  private count = 0
  private chunks: Array<Pick<ChunkSlot, 'blocks' | 'version'> | null> = new Array(HELD_CHUNKS_MAX).fill(null)
  private keys: string[] = new Array(HELD_CHUNKS_MAX).fill('')
  private versions = new Int32Array(HELD_CHUNKS_MAX)
  private offs = new Int32Array(3 * HELD_CHUNKS_MAX)
  readonly stats: HeldStats = { updates: 0, lastMs: 0, totalMs: 0 }

  constructor(private readonly target: HeldTarget) {}

  /** A chunk's blocks from those found for this relight, for fillHeldPass: made once, not per relight. */
  private readonly read = (cx: number, cy: number, cz: number): Uint8Array | null => {
    for (let i = 0; i < this.count; i++) if (this.offs[3 * i] === cx && this.offs[3 * i + 1] === cy && this.offs[3 * i + 2] === cz) return this.chunks[i]?.blocks ?? null
    return null
  }

  /** One frame: true when the light was worked out again. */
  frame(f: HeldFrame): boolean {
    if (!f.world || !f.glow || !f.shading) { this.off(); return false }
    const moved = f.eye[0] !== this.eye[0] || f.eye[1] !== this.eye[1] || f.eye[2] !== this.eye[2]
    const fresh = !this.on || moved || f.world !== this.world || f.glow.id !== this.glowId
    if (!fresh && (f.version === this.version || !this.nearChanged(f.world))) { this.version = f.version; return false }
    const t0 = performance.now()
    this.world = f.world; this.glowId = f.glow.id; this.version = f.version
    this.eye[0] = f.eye[0]; this.eye[1] = f.eye[1]; this.eye[2] = f.eye[2]
    heldCorner(this.eye, this.corner)
    const world = f.world
    // The chunks round you, each looked up once (its key made once) per relight, kept for the checks between relights.
    this.count = heldChunksInto(this.corner, this.offs)
    for (let i = 0; i < this.count; i++) {
      const cx = this.offs[3 * i], cy = this.offs[3 * i + 1], cz = this.offs[3 * i + 2]
      const slot = world.slotAt(cx, cy, cz)
      this.chunks[i] = slot; this.versions[i] = slot?.version ?? -1
      this.keys[i] = world.chunks ? offKey(cx, cy, cz) : ''
    }
    const pass = fillHeldPass(this.read, this.corner, heldPassScratch())
    computeHeldLight(pass, f.glow.rgb, this.bytes)
    this.target.setHeld(this.bytes, this.corner)
    this.on = true
    const ms = performance.now() - t0
    this.stats.updates++; this.stats.lastMs = ms; this.stats.totalMs += ms
    return true
  }

  /** Whether any chunk the cube overlaps came, went or changed since the light was worked out. Makes nothing: the chunks are found by the keys kept. */
  private nearChanged(world: NonNullable<HeldFrame['world']>): boolean {
    for (let i = 0; i < this.count; i++) {
      const slot = world.chunks ? world.chunks.get(this.keys[i]) ?? null : world.slotAt(this.offs[3 * i], this.offs[3 * i + 1], this.offs[3 * i + 2])
      if (slot !== this.chunks[i] || (slot?.version ?? -1) !== this.versions[i]) return true
    }
    return false
  }

  /** The light out: nothing glowing in hand, TERRAIN off, Block shading off. */
  off(): void {
    if (!this.on) return
    this.on = false
    this.glowId = -1
    this.eye[0] = this.eye[1] = this.eye[2] = NaN
    this.target.setHeld(null)
  }

  get lit(): boolean { return this.on }
}

const inverse = new Matrix4()
const eyeAt = new Vector3()

/** How far past a cell's side the eye goes before it counts as in the next cell, in blocks: an eye resting on a side never flips between the two. */
export const EYE_SLACK = 0.08

/**
 * The cell the camera is in, in the field's frame (whose matrix is `field`:
 * a cell d spans d to d + 1), into `out`, which holds the last answer:
 * that cell stays until the eye is EYE_SLACK past its side. Allocates nothing.
 */
export function eyeCell(camera: Vector3, field: Matrix4, out: [number, number, number]): [number, number, number] {
  eyeAt.copy(camera).applyMatrix4(inverse.copy(field).invert())
  for (let a = 0; a < 3; a++) {
    const v = eyeAt.getComponent(a), was = out[a]
    if (Number.isFinite(was) && v >= was - EYE_SLACK && v < was + 1 + EYE_SLACK) continue
    out[a] = Math.floor(v)
  }
  return out
}
