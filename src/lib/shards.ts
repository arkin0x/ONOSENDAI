/**
 * shards.ts — the shape of a shard, and nothing about where it goes.
 *
 * A shard is a small 3D object: vertices with colors, optional triangles,
 * and a render mode. The mesh is only one way to draw it. Vertices alone can
 * be lights, and a polyline through them blends their colors along the line
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
  /** Whole units per axis: the point's floor, what the wire's `vertices` carries. */
  p: [number, number, number]
  /** The rest of the position in ticks, 0..119 per axis; absent when the point is whole. */
  t?: [number, number, number]
  /** 0..1 per channel. */
  c: [number, number, number]
}

/**
 * A vertex copied whole, ticks included.
 *
 * The two halves of a position, whole units in `p` and the remainder in `t`,
 * have to travel together. A copy that takes `p` and `c` and forgets `t`
 * silently moves every sub-unit vertex onto the corner of its cell, and
 * vertices that shared a cell land on each other, which turns their faces
 * into triangles with no area that draw nothing at all.
 */
export function cloneVertex(v: ShardVertex): ShardVertex {
  return { p: [...v.p], ...(v.t ? { t: [...v.t] as ShardVertex['t'] } : {}), c: [...v.c] }
}

/**
 * Ticks to a grid unit. A position is stored as whole ticks, so a third, a
 * quarter or a fifth of a unit is exact and they mix freely in one shard:
 * 120 is divisible by every division the workshop offers and by eighths.
 */
export const TICKS_PER_UNIT = 120
/**
 * The grid divisions offered, all of them exact.
 *
 * A vertex is stored in 120ths of a unit (TICKS_PER_UNIT), so a division is
 * only offered when it divides 120 without a remainder: sevenths and ninths
 * would land vertices between ticks and could not be written to the wire.
 * That leaves 6, 8 and 10 as the next steps after 5; 12, 15, 20, 24, 30, 40
 * and 60 are exact too if finer work ever wants them.
 */
export const DIVISIONS = [1, 2, 3, 4, 5, 6, 8, 10] as const
export type Division = typeof DIVISIONS[number]

export interface ShardModel {
  id: string
  name: string
  /** One model unit is 2^unit gibsons. */
  unit: number
  /** Half-width of this shard's build grid, in units: the grid runs from -extent to +extent on every axis. */
  extent: number
  /** A vertex is whole units plus ticks, kept apart as on the wire: see ShardVertex. */
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
  /** Grid half-width the shard was built on; absent in older payloads (8). */
  extent?: number
  mode: ShardMode
  /** Whole units per vertex, the floor of the position: what a reader from before ticks sees. */
  vertices: Array<[number, number, number]>
  /**
   * The rest of each position in ticks, 0..119 per axis, one entry per vertex
   * in order; a negative number -N stands for N vertices of [0, 0, 0] in a
   * row. Absent in older payloads: every position is whole.
   */
  ticks?: Array<[number, number, number] | number>
  colors: Array<[number, number, number]>
  faces: Array<[number, number, number]>
}

export const MODES: ShardMode[] = ['solid', 'points', 'lines']

/** Default half-width of the build grid, in units; each shard keeps its own (`extent`). */
export const GRID_HALF = 8
export const MIN_EXTENT = 1
export const MAX_EXTENT = 64

export const MAX_VERTICES = 512
export const MAX_FACES = 1024

/**
 * A new shard draws LINES: the first tap glows and the second draws a line,
 * so the very first thing you do is visible. Faces switch it to SOLID when
 * the first stamp with faces lands (see the workshop store).
 */
export function newShard(name = 'Untitled shard'): ShardModel {
  return { id: uuid(), name, unit: 0, extent: GRID_HALF, mode: 'lines', vertices: [], faces: [], updatedAt: Date.now() }
}

/** A grid point as a map key, so "the same point" is one string compare. */
/** A point's key, from its position in total ticks. */
export function pointKey(p: [number, number, number]): string {
  return `${p[0]},${p[1]},${p[2]}`
}

/** A vertex's position as total ticks, the form arithmetic and keys use. */
export function ticksOf(v: Pick<ShardVertex, 'p' | 't'>): [number, number, number] {
  const t = v.t ?? [0, 0, 0]
  return [v.p[0] * TICKS_PER_UNIT + t[0], v.p[1] * TICKS_PER_UNIT + t[1], v.p[2] * TICKS_PER_UNIT + t[2]]
}

/** A vertex from a position in total ticks: whole units, and the rest as ticks only when there is any. */
export function vertexAt(total: [number, number, number], c: [number, number, number]): ShardVertex {
  const p = total.map((x) => Math.floor(x / TICKS_PER_UNIT)) as [number, number, number]
  const t = total.map((x, a) => x - p[a] * TICKS_PER_UNIT) as [number, number, number]
  return t[0] === 0 && t[1] === 0 && t[2] === 0 ? { p, c } : { p, t, c }
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

/** Integers inside the grid; anything else is not a vertex. */
export function validPoint(p: [number, number, number], extent: number = GRID_HALF): boolean {
  return p.every((v) => Number.isInteger(v) && Math.abs(v) <= extent * TICKS_PER_UNIT)
}

/**
 * A stored model made whole again. Models have always kept `p` in units; for
 * a short while after ticks arrived they kept total ticks there instead, and
 * such a model shows itself by a coordinate no grid could hold (above
 * MAX_EXTENT units). Those are split back into units and ticks.
 */
export function normalizeStored(s: ShardModel): ShardModel {
  const inTicks = s.vertices.some((v) => v.t === undefined && v.p.some((c) => Math.abs(c) > MAX_EXTENT))
  if (!inTicks) return s
  return { ...s, vertices: s.vertices.map((v) => vertexAt(v.p, v.c)) }
}

/** The grid half-width a shard needs to hold every vertex it has. */
export function neededExtent(s: Pick<ShardModel, 'vertices'>): number {
  let m = MIN_EXTENT
  for (const v of s.vertices) for (const c of ticksOf(v)) m = Math.max(m, Math.ceil(Math.abs(c) / TICKS_PER_UNIT))
  return m
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
    extent: s.extent,
    mode: s.mode,
    vertices: s.vertices.map((v) => v.p),
    ticks: packTicks(s.vertices.map((v) => v.t ?? [0, 0, 0])),
    colors: s.vertices.map((v) => v.c),
    faces: s.faces,
  }
}

/**
 * Strict on shape, forgiving on nothing: a payload is what the wire gives
 * back, and a shard with a face pointing at a vertex it does not have would
 * throw inside three.js at draw time, far from anything that could explain it.
 */
/** The ticks column for the wire: runs of whole positions become one negative count. */
export function packTicks(rest: Array<[number, number, number]>): Array<[number, number, number] | number> {
  const out: Array<[number, number, number] | number> = []
  let zeros = 0
  for (const t of rest) {
    if (t[0] === 0 && t[1] === 0 && t[2] === 0) { zeros++; continue }
    if (zeros) { out.push(-zeros); zeros = 0 }
    out.push(t)
  }
  if (zeros) out.push(-zeros)
  return out
}

/** The ticks column read back, one triple per vertex, or null when it does not fit `count` vertices. */
export function unpackTicks(packed: unknown, count: number): Array<[number, number, number]> | null {
  if (packed === undefined) return Array.from({ length: count }, () => [0, 0, 0])
  if (!Array.isArray(packed)) return null
  const out: Array<[number, number, number]> = []
  for (const e of packed) {
    if (typeof e === 'number') {
      if (!Number.isInteger(e) || e >= 0) return null
      for (let i = 0; i < -e; i++) out.push([0, 0, 0])
    } else if (Array.isArray(e) && e.length === 3 && e.every((t) => Number.isInteger(t) && t >= 0 && t < TICKS_PER_UNIT)) {
      out.push([e[0], e[1], e[2]])
    } else return null
    if (out.length > count) return null
  }
  return out.length === count ? out : null
}

export function fromPayload(raw: unknown, id: string): ShardModel | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<ShardPayload>
  if (p.v !== 1 || p.type !== 'shard') return null
  if (!Array.isArray(p.vertices) || !Array.isArray(p.colors) || !Array.isArray(p.faces)) return null
  if (p.vertices.length !== p.colors.length || p.vertices.length > MAX_VERTICES || p.faces.length > MAX_FACES) return null
  if (!MODES.includes(p.mode as ShardMode)) return null
  if (!Number.isInteger(p.unit) || (p.unit as number) < 0 || (p.unit as number) > 84) return null
  const rest = unpackTicks(p.ticks, p.vertices.length)
  if (!rest) return null
  const vertices: ShardVertex[] = []
  for (let i = 0; i < p.vertices.length; i++) {
    const pt = p.vertices[i], c = p.colors[i]
    if (!Array.isArray(pt) || pt.length !== 3 || !Array.isArray(c) || c.length !== 3) return null
    const whole = pt.map(Number) as [number, number, number]
    if (!whole.every(Number.isInteger)) return null
    const r = rest[i]
    const colour = clampColor(c.map(Number) as [number, number, number])
    vertices.push(r[0] === 0 && r[1] === 0 && r[2] === 0 ? { p: whole, c: colour } : { p: whole, t: r, c: colour })
  }
  const faces: Array<[number, number, number]> = []
  for (const f of p.faces) {
    if (!Array.isArray(f) || f.length !== 3) return null
    const face = f.map(Number) as [number, number, number]
    if (!validFace(face, vertices.length)) return null
    faces.push(face)
  }
  const extent = Number.isInteger(p.extent) && (p.extent as number) >= MIN_EXTENT && (p.extent as number) <= MAX_EXTENT ? (p.extent as number) : GRID_HALF
  return {
    id,
    name: typeof p.name === 'string' ? p.name.slice(0, 64) : 'shard',
    unit: p.unit as number,
    extent: Math.max(extent, neededExtent({ vertices })),
    mode: p.mode as ShardMode,
    vertices,
    faces,
    updatedAt: Date.now(),
  }
}

/** The flat arrays three.js wants, in one place so every drawer agrees. */
/**
 * A model position as the scene draws it. Model axes are cyberspace axes,
 * and the world draws cyberspace with Z negated (lib/space.ts
 * flipHandedness), so model +Z is render -Z here too: the bench and the
 * world show the same object, and the bench's blue arrow points where the
 * world's compass does.
 */
export function toRender(p: [number, number, number]): [number, number, number] {
  // `p` is a position in total ticks (ticksOf).
  // 0 - z rather than -z: negating a zero gives -0, which equality tests and keys treat as different.
  return [p[0] / TICKS_PER_UNIT, p[1] / TICKS_PER_UNIT, (0 - p[2]) / TICKS_PER_UNIT]
}

export function flatten(s: ShardModel): { positions: Float32Array; colors: Float32Array; index: number[] } {
  const positions = new Float32Array(s.vertices.length * 3)
  const colors = new Float32Array(s.vertices.length * 3)
  s.vertices.forEach((v, i) => {
    positions.set(toRender(ticksOf(v)), i * 3)
    colors.set(v.c, i * 3)
  })
  return { positions, colors, index: s.faces.flat() }
}

/** Where the shard's vertices sit on average: what the workshop orbits. */
export function centroid(s: ShardModel): [number, number, number] {
  if (s.vertices.length === 0) return [0, 0, 0]
  const sum = [0, 0, 0]
  for (const v of s.vertices) { const t = ticksOf(v); for (let i = 0; i < 3; i++) sum[i] += t[i] }
  return sum.map((x) => x / s.vertices.length) as [number, number, number]
}

/** Hex <-> 0..1 triple, for the color input. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function rgbToHex(c: [number, number, number]): string {
  return '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')
}

/** A tick count as units for reading: "2", "1/3", "-2 3/4". */
export function unitsLabel(ticks: number): string {
  const sign = ticks < 0 ? '-' : ''
  const a = Math.abs(ticks)
  const whole = Math.floor(a / TICKS_PER_UNIT)
  let num = a - whole * TICKS_PER_UNIT
  if (num === 0) return `${sign}${whole}`
  let den = TICKS_PER_UNIT
  const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : x)
  const g = gcd(num, den); num /= g; den /= g
  return whole ? `${sign}${whole} ${num}/${den}` : `${sign}${num}/${den}`
}
