/**
 * shards.ts — the shape of a shard, and nothing about where it goes.
 *
 * A shard is a small 3D object: vertices with colours, optional triangles,
 * and a render mode. The mesh is only one way to draw it. Vertices alone can
 * be lights, and a polyline through them blends their colours along the line
 * the way a mesh blends across a face, so the same vertex list carries all
 * three and the mode is a property of the shard, not of the viewer.
 *
 * Vertices sit on an integer grid in model units, and a shard carries the
 * exponent that says what one unit is in gibsons, so a gibson-sized trinket
 * and a sector-sized monument are the same data at different `unit`. Integers
 * because precision is the whole point of this client: a vertex is at a
 * coordinate, not near one.
 *
 * Pure. The builder store mutates copies of these; the world draws them.
 */

export type ShardMode = 'solid' | 'points' | 'lines'

export interface ShardVertex {
  /** Model units, integers. */
  p: [number, number, number]
  /** 0..1 per channel. */
  c: [number, number, number]
}

export interface ShardModel {
  id: string
  name: string
  /** One model unit is 2^unit gibsons. */
  unit: number
  mode: ShardMode
  vertices: ShardVertex[]
  /** Triangles as vertex indices; drawn in `solid` mode only. */
  faces: Array<[number, number, number]>
  updatedAt: number
}

/** Wire form: what goes in an event's content, public or decrypted. */
export interface ShardPayload {
  v: 1
  type: 'shard'
  name: string
  unit: number
  mode: ShardMode
  vertices: Array<[number, number, number]>
  colors: Array<[number, number, number]>
  faces: Array<[number, number, number]>
}

export const MODES: ShardMode[] = ['solid', 'points', 'lines']

/** Half-width of the build grid, in units. */
export const GRID_HALF = 8

export const MAX_VERTICES = 512
export const MAX_FACES = 1024

/**
 * A new shard draws LINES: the first tap glows and the second draws a line,
 * so the very first thing you do is visible. Faces switch it to SOLID when
 * the first stamp with faces lands (see the workshop store).
 */
export function newShard(name = 'Untitled shard'): ShardModel {
  return { id: uuid(), name, unit: 0, mode: 'lines', vertices: [], faces: [], updatedAt: Date.now() }
}

/** A grid point as a map key, so "the same point" is one string compare. */
export function pointKey(p: [number, number, number]): string {
  return `${p[0]},${p[1]},${p[2]}`
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

/** Integers inside the grid; anything else is not a vertex. */
export function validPoint(p: [number, number, number]): boolean {
  return p.every((v) => Number.isInteger(v) && Math.abs(v) <= GRID_HALF)
}

export function clampColor(c: [number, number, number]): [number, number, number] {
  return c.map((v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))) as [number, number, number]
}

/** A face needs three distinct vertices that exist. */
export function validFace(f: [number, number, number], count: number): boolean {
  return f.every((i) => Number.isInteger(i) && i >= 0 && i < count) && new Set(f).size === 3
}

export function toPayload(s: ShardModel): ShardPayload {
  return {
    v: 1,
    type: 'shard',
    name: s.name,
    unit: s.unit,
    mode: s.mode,
    vertices: s.vertices.map((v) => v.p),
    colors: s.vertices.map((v) => v.c),
    faces: s.faces,
  }
}

/**
 * Strict on shape, forgiving on nothing: a payload is what the wire gives
 * back, and a shard with a face pointing at a vertex it does not have would
 * throw inside three.js at draw time, far from anything that could explain it.
 */
export function fromPayload(raw: unknown, id: string): ShardModel | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<ShardPayload>
  if (p.v !== 1 || p.type !== 'shard') return null
  if (!Array.isArray(p.vertices) || !Array.isArray(p.colors) || !Array.isArray(p.faces)) return null
  if (p.vertices.length !== p.colors.length || p.vertices.length > MAX_VERTICES || p.faces.length > MAX_FACES) return null
  if (!MODES.includes(p.mode as ShardMode)) return null
  if (!Number.isInteger(p.unit) || (p.unit as number) < 0 || (p.unit as number) > 84) return null
  const vertices: ShardVertex[] = []
  for (let i = 0; i < p.vertices.length; i++) {
    const pt = p.vertices[i], c = p.colors[i]
    if (!Array.isArray(pt) || pt.length !== 3 || !Array.isArray(c) || c.length !== 3) return null
    const point = pt.map(Number) as [number, number, number]
    if (!point.every(Number.isFinite)) return null
    vertices.push({ p: point, c: clampColor(c.map(Number) as [number, number, number]) })
  }
  const faces: Array<[number, number, number]> = []
  for (const f of p.faces) {
    if (!Array.isArray(f) || f.length !== 3) return null
    const face = f.map(Number) as [number, number, number]
    if (!validFace(face, vertices.length)) return null
    faces.push(face)
  }
  return {
    id,
    name: typeof p.name === 'string' ? p.name.slice(0, 64) : 'shard',
    unit: p.unit as number,
    mode: p.mode as ShardMode,
    vertices,
    faces,
    updatedAt: Date.now(),
  }
}

/** The flat arrays three.js wants, in one place so every drawer agrees. */
export function flatten(s: ShardModel): { positions: Float32Array; colors: Float32Array; index: number[] } {
  const positions = new Float32Array(s.vertices.length * 3)
  const colors = new Float32Array(s.vertices.length * 3)
  s.vertices.forEach((v, i) => {
    positions.set(v.p, i * 3)
    colors.set(v.c, i * 3)
  })
  return { positions, colors, index: s.faces.flat() }
}

/** Where the shard's vertices sit on average: what the workshop orbits. */
export function centroid(s: ShardModel): [number, number, number] {
  if (s.vertices.length === 0) return [0, 0, 0]
  const sum = [0, 0, 0]
  for (const v of s.vertices) for (let i = 0; i < 3; i++) sum[i] += v.p[i]
  return sum.map((x) => x / s.vertices.length) as [number, number, number]
}

/** Hex <-> 0..1 triple, for the colour input. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function rgbToHex(c: [number, number, number]): string {
  return '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')
}
