/**
 * coords.ts - the chunk grid of TERRAIN mode, and a fast coordinate builder.
 *
 * A chunk is an aligned h5 region: 32 by 32 by 32 gibsons, one block per
 * gibson (arkinox, 2026-11-24: the bag chunk is h5). Inside a chunk a cell is
 * one index, x fastest, then z, then y: idx = x + 32 z + 1024 y, in
 * cyberspace axes, whatever way gravity points for the builder.
 *
 * fastCoordBytes builds the same 32 bytes as cyberspace-core's
 * bigintTo32Bytes(xyzToCoord(x, y, z, plane)), from tables instead of 255
 * BigInt steps (the benchmark measured 16 microseconds a call for the core's
 * walk, about 15 SHA-256s, and cut terrain K for a chunk from 1.26 ms to
 * 0.29 ms with this). It is checked identical against the core in
 * lib/__tests__/terrainGenerate.test.ts on random coordinates and the axis
 * extremes.
 */

export const CHUNK_BITS = 5
export const N = 32
export const CELLS = 32768

/** The cell index of a chunk-local (x, y, z), each 0 to 31. */
export const idx = (x: number, y: number, z: number): number => x | (z << 5) | (y << 10)

/** Spreads the 8 bits of a byte to every third bit of 24. */
const SPREAD = (() => {
  const t = new Uint32Array(256)
  for (let v = 0; v < 256; v++) {
    let s = 0
    for (let i = 0; i < 8; i++) s |= ((v >> i) & 1) << (3 * i)
    t[v] = s
  }
  return t
})()

/** The 11 little-endian bytes of an 85-bit axis value. */
function axisBytes(v: bigint, out: Uint8Array): void {
  let n = v
  for (let j = 0; j < 11; j++) { out[j] = Number(n & 0xffn); n >>= 8n }
}

const bx = new Uint8Array(11)
const by = new Uint8Array(11)
const bz = new Uint8Array(11)
const bits = new Uint8Array(264)

/**
 * The 256-bit interleaved coordinate of (x, y, z, plane) as 32 big-endian
 * bytes: bit 0 the plane, then z, y, x for each axis bit from the lowest
 * (cyberspace-core xyzToCoord), exactly as bigintTo32Bytes writes it.
 */
export function fastCoordBytes(x: bigint, y: bigint, z: bigint, plane = 0): Uint8Array {
  axisBytes(x, bx); axisBytes(y, by); axisBytes(z, bz)
  bits.fill(0)
  bits[0] = plane & 1
  for (let j = 0; j < 11; j++) {
    const v = SPREAD[bz[j]] | (SPREAD[by[j]] << 1) | (SPREAD[bx[j]] << 2)
    const off = 1 + 24 * j
    for (let b = 0; b < 24; b++) bits[off + b] = (v >>> b) & 1
  }
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    let v = 0
    const o = (31 - i) * 8
    for (let b = 7; b >= 0; b--) v = (v << 1) | bits[o + b]
    out[i] = v
  }
  return out
}

/** A chunk: its aligned low corner, in gibsons, and its plane. */
export interface ChunkBase {
  x: bigint
  y: bigint
  z: bigint
  plane: number
}

const MASK = ~((1n << BigInt(CHUNK_BITS)) - 1n)

/** The chunk holding a gibson. */
export function chunkOf(x: bigint, y: bigint, z: bigint, plane: number): ChunkBase {
  return { x: x & MASK, y: y & MASK, z: z & MASK, plane }
}

/** A chunk's name, the same on every device: plane, then the three corners in hex. */
export function chunkKey(c: ChunkBase): string {
  return `${c.plane}:${c.x.toString(16)}:${c.y.toString(16)}:${c.z.toString(16)}`
}

/** The chunk a chunkKey names, or null when it is not one. */
export function parseChunkKey(key: string): ChunkBase | null {
  const m = /^([01]):([0-9a-f]+):([0-9a-f]+):([0-9a-f]+)$/.exec(key)
  if (!m) return null
  const c = { plane: Number(m[1]), x: BigInt(`0x${m[2]}`), y: BigInt(`0x${m[3]}`), z: BigInt(`0x${m[4]}`) }
  return (c.x & MASK) === c.x && (c.y & MASK) === c.y && (c.z & MASK) === c.z ? c : null
}

/** The largest axis value: 2^85 - 1. */
export const AXIS_MAX = (1n << 85n) - 1n

/** Whether a whole chunk at this corner lies inside the axes. */
export function chunkInSpace(c: Pick<ChunkBase, 'x' | 'y' | 'z'>): boolean {
  const top = AXIS_MAX - 31n
  return c.x >= 0n && c.y >= 0n && c.z >= 0n && c.x <= top && c.y <= top && c.z <= top
}
