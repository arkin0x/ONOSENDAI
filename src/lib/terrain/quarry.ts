/**
 * quarry.ts - the Quarry Charge's rules, without the app (DECK-0010 §8.6;
 * owner, 2026-11-27):
 *
 * - Placed like a block, it arms with a fuse of FUSE_MS: it blinks and beeps,
 *   faster and faster, with the seconds counting down over it.
 * - Then it blasts the BLAST_SIDE by BLAST_SIDE by BLAST_SIDE cells centred
 *   on its own cell (blastCells), as mining those cells would (store/
 *   useTerrain.ts blast): your own layer only, the reach and the chunks you
 *   can build in respected, published like mining.
 * - Each block it takes that mining would have carried becomes a drop: a
 *   small floating copy of the block in its own cell, for DROP_LIFE_MS, kept
 *   on this device only (never published), fading out over its last
 *   DROP_FADE_MS. Walking into its cell collects it.
 *
 * Drops are kept by their cell in cyberspace (whole gibsons, as decimal
 * strings) and their plane, so they survive the field moving its origin and a
 * reload, and by the wall clock (Date.now()) for when they evaporate.
 *
 * Pure: nothing here reads a store or three.
 */

export type Cell = [number, number, number]

/* ---- The charge's feel. The owner tunes these to taste (2026-11-27). ---- */
/** The fuse, in milliseconds: from placing to the blast. */
export const FUSE_MS = 3000
/** The blast's box: this many cells on every axis, centred on the charge. */
export const BLAST_SIDE = 7
/** How long a drop floats before it evaporates, in milliseconds. */
export const DROP_LIFE_MS = 10 * 60 * 1000
/** Over how much of the end of its life a drop fades out, in milliseconds. */
export const DROP_FADE_MS = 5000
/** A drop's side, in blocks. */
export const DROP_SIZE = 0.34
/* ---- end of the owner's tuning ---- */

/** Cells from the centre to the blast's edge. */
export const BLAST_HALF = (BLAST_SIDE - 1) / 2

/** Every cell the blast of a charge at `centre` reaches: BLAST_SIDE cubed, the centre's own first. */
export function blastCells(centre: readonly [number, number, number]): Cell[] {
  const out: Cell[] = [[centre[0], centre[1], centre[2]]]
  for (let dy = -BLAST_HALF; dy <= BLAST_HALF; dy++) for (let dz = -BLAST_HALF; dz <= BLAST_HALF; dz++) for (let dx = -BLAST_HALF; dx <= BLAST_HALF; dx++) {
    if (dx || dy || dz) out.push([centre[0] + dx, centre[1] + dy, centre[2] + dz])
  }
  return out
}

/**
 * When the fuse beeps, in milliseconds from the moment it is placed: slow at
 * first, quicker and quicker, the last one just before the blast.
 */
export function beepTimes(fuseMs: number = FUSE_MS): number[] {
  const out: number[] = []
  for (let t = 0; t < fuseMs - 40;) {
    out.push(t)
    const left = 1 - t / fuseMs
    t += 70 + 480 * left * left
  }
  return out
}

/** The beeps of a full fuse, worked out once (the scene blinks on them every frame). */
export const FUSE_BEEPS: readonly number[] = beepTimes()

/** How long the lamp stays lit at each beep, in milliseconds. */
export const BLINK_MS = 60

/** Whether the lamp is lit `ms` into the fuse: for BLINK_MS at each beep. No allocation: the frame loop asks it. */
export function blinkLit(ms: number, beeps: readonly number[] = FUSE_BEEPS): boolean {
  if (ms < 0) return false
  for (let i = beeps.length - 1; i >= 0; i--) if (beeps[i] <= ms) return ms - beeps[i] < BLINK_MS
  return false
}

/** The whole seconds left on the fuse, as the countdown shows them: 3, 2, 1, and 0 once it is over. */
export function secondsLeft(ms: number, fuseMs: number = FUSE_MS): number {
  return Math.max(0, Math.ceil((fuseMs - ms) / 1000))
}

/** One drop: the block it is, where it floats in cyberspace, and when it evaporates. */
export interface Drop {
  /** Its cell as `x,y,z,plane`, which is also how it is found. */
  key: string
  x: string
  y: string
  z: string
  plane: number
  /** The kind of block it gives (a carried id, 1 to 254). */
  id: number
  /** Date.now() when it evaporates. */
  expires: number
}

/** A cell's key: where a drop floats, and where a body is. */
export const cellKey = (x: bigint, y: bigint, z: bigint, plane: number): string => `${x},${y},${z},${plane}`

/** A drop for block `id` in the cell at x, y, z (cyberspace gibsons), evaporating DROP_LIFE_MS after `now`. */
export function makeDrop(x: bigint, y: bigint, z: bigint, plane: number, id: number, now: number): Drop {
  return { key: cellKey(x, y, z, plane), x: x.toString(), y: y.toString(), z: z.toString(), plane, id, expires: now + DROP_LIFE_MS }
}

/** How much of a drop shows at `now`: whole until its last DROP_FADE_MS, then fading to nothing. */
export function dropLevel(expires: number, now: number): number {
  return Math.max(0, Math.min(1, (expires - now) / DROP_FADE_MS))
}

const INT = /^-?\d+$/

/** Drops read back from storage: well formed and not yet evaporated at `now`; anything else is left out. */
export function tidyDrops(v: unknown, now: number): Drop[] {
  if (!Array.isArray(v)) return []
  const out: Drop[] = []
  for (const d of v as Array<Partial<Drop> | null>) {
    if (!d || typeof d !== 'object') continue
    const { x, y, z, plane, id, expires } = d
    if (typeof x !== 'string' || typeof y !== 'string' || typeof z !== 'string' || !INT.test(x) || !INT.test(y) || !INT.test(z)) continue
    if ((plane !== 0 && plane !== 1) || !Number.isInteger(id) || (id as number) < 1 || (id as number) > 254) continue
    if (typeof expires !== 'number' || !Number.isFinite(expires) || expires <= now || expires > now + DROP_LIFE_MS) continue
    out.push({ key: cellKey(BigInt(x), BigInt(y), BigInt(z), plane), x, y, z, plane, id: id as number, expires })
  }
  return out
}

/**
 * The cells a body passes through on one step, from `from` to `to` (whole
 * cells, any frame), both ends counted: so a quick step still collects what
 * it went through. A jump of more than `max` cells (a hop, a respawn) counts
 * only where it lands.
 */
export function stepCells(from: readonly [number, number, number] | null, to: readonly [number, number, number], max = 8): Cell[] {
  const end: Cell = [to[0], to[1], to[2]]
  if (!from) return [end]
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
  const n = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]))
  if (n === 0 || n > max) return [end]
  const out: Cell[] = []
  for (let i = 0; i <= n; i++) {
    const c: Cell = [Math.round(from[0] + (d[0] * i) / n), Math.round(from[1] + (d[1] * i) / n), Math.round(from[2] + (d[2] * i) / n)]
    if (!out.some((o) => o[0] === c[0] && o[1] === c[1] && o[2] === c[2])) out.push(c)
  }
  return out
}

/** The cells a body standing in `feet` takes: its own and the one above (the head). */
export function bodyAt(feet: readonly [number, number, number]): Cell[] {
  return [[feet[0], feet[1], feet[2]], [feet[0], feet[1] + 1, feet[2]]]
}
