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
import { applyPose, wrapSpin, type Pose } from './pose'
import { BUILT_IN, colorAt, indexOf, resolvePalette, toBytes, type Palette } from './snoPalette'


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
  /**
   * Stands on the Earth: +Y to the ground's up at the place it is hidden,
   * +Z facing `spin`. False for a shard on the bench and for one placed on
   * cyberspace axes as built (lib/pose.ts).
   */
  up: boolean
  /** The compass bearing +Z faces when `up`: whole degrees 0..359, clockwise from north. 0 otherwise. */
  spin: number
  /**
   * A colour of its own for each face, or absent when every face interpolates
   * its corners. Expanded here, one entry per face, and run-length encoded
   * only on the wire: a run is a wire economy, and carrying it in memory would
   * mean every edit had to think about it.
   */
  facecolors?: Array<[number, number, number]>
  updatedAt: number
}

/** Wire form: what goes in an event's content, public or decrypted. */
export interface ShardPayload {
  /** 1 was this client's own frame; 2 is the published one (DECK-0003 §2). */
  v: 1 | 2
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
  /**
   * One palette index per vertex, parallel to `vertices` (DECK-0003 §1.3).
   *
   * A `v: 1` payload carries a literal `[r, g, b]` triple here instead, which
   * is what every shard written before the palette existed looks like. A
   * writer only ever produces indices.
   */
  colors: Array<number | [number, number, number]>
  faces: Array<[number, number, number]>
  /** Which 256 colours the indices name: a name, an naddr, or the list itself (§1.3a). */
  palette?: string | Array<[number, number, number]>
  /**
   * One palette index per face, in the order `faces` gives them, run-length
   * encoded the way `ticks` is: an entry is either an index or a negative
   * integer -N standing for N further faces of the index before it. Absent
   * means every face interpolates its three vertices, which is the format's
   * default and not the same as colour 0 (DECK-0003 §1.4a).
   */
  facecolors?: number[]
  /** Present and true when the shard stands on the Earth where it is hidden (lib/pose.ts). Absent otherwise. */
  up?: true
  /** With `up`: the compass bearing +Z faces, a whole number 0..359. Ignored without `up`. */
  spin?: number
}

export const MODES: ShardMode[] = ['solid', 'points', 'lines']

/** Default half-width of the build grid, in units; each shard keeps its own (`extent`). */
export const GRID_HALF = 8
export const MIN_EXTENT = 1
export const MAX_EXTENT = 64

export const MAX_VERTICES = 512
export const MAX_FACES = 1024

/**
 * The largest `unit` a shard can be built or deployed at.
 *
 * One unit is 2^unit gibsons and there are 2^33 gibsons to a meter, so 2^84 is
 * about 2.4e15 meters, a quarter of a light year: past a sector and well past
 * anything a shard should span. 0 is the floor, one gibson, about 116 pm.
 */
export const MAX_UNIT = 84

/**
 * A unit brought inside the bounds, as a whole number.
 *
 * The workshop's DEPLOY SCALE MULTIPLIER and the deploy bar's SCALE MULTIPLIER
 * are the same quantity set in two places, so they clamp through one function
 * rather than repeating the same two literals and drifting apart.
 */
export function clampUnit(unit: number): number {
  return Math.max(0, Math.min(MAX_UNIT, Math.round(unit)))
}

/**
 * A new shard draws LINES: the first tap glows and the second draws a line,
 * so the very first thing you do is visible. Faces switch it to SOLID when
 * the first stamp with faces lands (see the workshop store).
 */
export function newShard(name = 'Untitled shard'): ShardModel {
  return { id: uuid(), name, unit: 0, extent: GRID_HALF, mode: 'lines', vertices: [], faces: [], up: false, spin: 0, updatedAt: Date.now() }
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
  // Models from before the pose have no `up` or `spin`: they lie as built.
  const stored = s as Partial<ShardModel>
  const posed = stored.up === undefined || stored.spin === undefined ? { ...s, up: stored.up ?? false, spin: stored.spin ?? 0 } : s
  const inTicks = posed.vertices.some((v) => v.t === undefined && v.p.some((c) => Math.abs(c) > MAX_EXTENT))
  if (!inTicks) return posed
  return { ...posed, vertices: posed.vertices.map((v) => vertexAt(v.p, v.c)) }
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

/**
 * The wire's handedness, and why it is not this client's.
 *
 * DECK-0003 §2: an SNO payload is right-handed with Y up and +Z toward the
 * viewer, which is the glTF and three.js convention, so that any tool can read
 * one without a special case. Cyberspace's own +Z is the black sun, away from
 * the viewer, and everything in this client is built in that frame.
 *
 * The two differ by one sign, so the conversion is a negation of Z and it
 * happens here, at the payload boundary, and nowhere else. Nothing inside the
 * client changes: no stored model moves, no renderer changes, nothing already
 * on screen looks different. What changes is that what goes out on the wire is
 * readable by anyone.
 *
 * `v` says which frame a payload is in. `1` is what this client wrote while the
 * format lived only here, and its Z is already this client's, so it is read
 * unchanged. `2` is the published convention and is negated on the way in and
 * on the way out. A publisher writes 2 forever.
 */
export const WIRE_VERSION = 2

/** A vertex with its Z negated, on total ticks so the floor and the remainder stay consistent. */
function flipZ(v: ShardVertex): ShardVertex {
  const [x, y, z] = ticksOf(v)
  // `0 - z` rather than `-z`, for the reason toRender gives: negating a zero
  // gives -0, which deep equality and object keys treat as a different number.
  return vertexAt([x, y, 0 - z], v.c)
}

export function toPayload(s: ShardModel): ShardPayload {
  const vertices = s.vertices.map(flipZ)
  return {
    v: WIRE_VERSION,
    name: s.name,
    unit: s.unit,
    extent: s.extent,
    mode: s.mode,
    vertices: vertices.map((v) => v.p),
    ticks: packTicks(vertices.map((v) => v.t ?? [0, 0, 0])),
    colors: vertices.map((v) => indexOf(BUILT_IN, toBytes(v.c))),
    ...(s.facecolors && s.facecolors.length === s.faces.length
      ? { facecolors: packFaceColors(s.facecolors.map((c) => indexOf(BUILT_IN, toBytes(c)))) }
      : {}),
    faces: s.faces,
    // `up` and `spin` are carried as data. They say the object stands on the
    // Earth where it is hidden, which is a Cyberspace idea; here an object has
    // no place, so they travel untouched and nothing applies them.
    // Only a standing shard carries the pose: a payload without one is byte
    // for byte what it was before the pose existed.
    ...(s.up ? { up: true as const, spin: wrapSpin(s.spin) } : {}),
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

/**
 * Face colours packed for the wire (DECK-0003 §1.4a).
 *
 * The same run-length shape as `ticks`, for the same reason: the common case
 * is a run. A stamped block is twelve triangles of one colour, so a solid cube
 * is `[[1, 0, 0], -11]` rather than twelve copies of the same triple. The
 * first entry is always a triple, because a run has nothing to repeat before
 * one.
 */
export function packFaceColors(indices: number[]): number[] {
  const out: number[] = []
  let run = 0
  for (let i = 0; i < indices.length; i++) {
    if (i > 0 && indices[i] === indices[i - 1]) { run++; continue }
    if (run) { out.push(-run); run = 0 }
    out.push(indices[i])
  }
  if (run) out.push(-run)
  return out
}

/**
 * Face colours read back, one index per face, or null when they do not fit
 * `count` faces or name a colour the palette does not have.
 *
 * The sign separates an index from a run, which works because an index is
 * never negative. It is the same trick `ticks` uses, and it is why a colour
 * had to become one number before face colours were affordable: a list of
 * triples interleaved with run markers cost more than it saved.
 */
export function unpackFaceColors(packed: unknown, count: number, palette: Palette): number[] | null {
  if (packed === undefined) return null
  if (!Array.isArray(packed) || packed.length === 0) return null
  const out: number[] = []
  for (const e of packed) {
    if (!Number.isInteger(e)) return null
    if ((e as number) < 0) {
      // A run repeats the index before it, so the first entry cannot be one.
      if (out.length === 0) return null
      const prev = out[out.length - 1]
      for (let i = 0; i < -(e as number); i++) out.push(prev)
    } else {
      if ((e as number) >= palette.length) return null
      out.push(e as number)
    }
    if (out.length > count) return null
  }
  return out.length === count ? out : null
}

/**
 * A shard with its face colours turned into vertex colours, for drawing.
 *
 * A face colour is a hard seam: the three corners of a triangle must all be
 * that colour and nothing may interpolate across the edge into the next one.
 * Shared vertices cannot express that, since a vertex belongs to every face
 * that touches it, so each face gets three corners of its own.
 *
 * Done here, once, before anything else looks at the geometry, so the winding
 * pass, the clipper and the face picker all work on ordinary vertex colours
 * and none of them has to know this feature exists. Face order is preserved,
 * which is what keeps a tap on a face resolving to the same face.
 *
 * This is a render-time expansion and never goes back on the wire, so it is
 * not subject to the format's vertex ceiling.
 */
export function expandFaceColors(s: ShardModel): ShardModel {
  if (!s.facecolors || s.facecolors.length !== s.faces.length || s.faces.length === 0) return s
  const vertices: ShardVertex[] = []
  const faces: Array<[number, number, number]> = []
  s.faces.forEach((f, i) => {
    const c = clampColor(s.facecolors![i])
    const base = vertices.length
    for (const vi of f) vertices.push({ ...s.vertices[vi], c })
    faces.push([base, base + 1, base + 2])
  })
  return { ...s, vertices, faces, facecolors: undefined }
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

export function fromPayload(raw: unknown, id: string, fetchedPalette?: string | null): ShardModel | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<ShardPayload>
  // DECK-0003 §1.1a: there is no `type` field. Payloads written before that
  // deck carry `type: "shard"`; it is ignored here and never rejected on,
  // because the field is noise and rejecting on noise would refuse every
  // object anyone else writes correctly.
  if (p.v !== 1 && p.v !== WIRE_VERSION) return null
  if (!Array.isArray(p.vertices) || !Array.isArray(p.colors) || !Array.isArray(p.faces)) return null
  if (p.vertices.length !== p.colors.length || p.vertices.length > MAX_VERTICES || p.faces.length > MAX_FACES) return null
  if (!MODES.includes(p.mode as ShardMode)) return null
  if (!Number.isInteger(p.unit) || (p.unit as number) < 0 || (p.unit as number) > MAX_UNIT) return null
  const rest = unpackTicks(p.ticks, p.vertices.length)
  if (!rest) return null
  if (p.up !== undefined && typeof p.up !== 'boolean') return null
  if (p.spin !== undefined && (!Number.isInteger(p.spin) || (p.spin as number) < 0 || (p.spin as number) > 359)) return null
  // §1.3a: which colours the indices name. A reference that has not resolved
  // is the built-in rather than a failure, so an object is never undrawable
  // because a second event is missing.
  const palette = resolvePalette(p.palette, fetchedPalette)
  if (!palette) return null
  const up = p.up === true
  const vertices: ShardVertex[] = []
  for (let i = 0; i < p.vertices.length; i++) {
    const pt = p.vertices[i], c = p.colors[i]
    if (!Array.isArray(pt) || pt.length !== 3) return null
    const whole = pt.map(Number) as [number, number, number]
    if (!whole.every(Number.isInteger)) return null
    const r = rest[i]
    // A v1 payload's colours are literal triples and stay exactly as written:
    // every shard this client made before the palette existed is one, and
    // snapping them on read would change objects nobody asked to change. They
    // snap when they are next published, which is when they become v2.
    let colour: [number, number, number]
    if (p.v === 1) {
      const triple = c as unknown
      if (!Array.isArray(triple) || triple.length !== 3 || !triple.every((n) => typeof n === 'number')) return null
      colour = clampColor(triple as [number, number, number])
    } else {
      if (!Number.isInteger(c) || (c as number) < 0 || (c as number) >= palette.length) return null
      colour = colorAt(palette, c as number)
    }
    const read: ShardVertex = r[0] === 0 && r[1] === 0 && r[2] === 0 ? { p: whole, c: colour } : { p: whole, t: r, c: colour }
    // A v1 payload is already in this client's frame; a v2 one is the wire's.
    vertices.push(p.v === WIRE_VERSION ? flipZ(read) : read)
  }
  const faces: Array<[number, number, number]> = []
  for (const f of p.faces) {
    if (!Array.isArray(f) || f.length !== 3) return null
    const face = f.map(Number) as [number, number, number]
    if (!validFace(face, vertices.length)) return null
    faces.push(face)
  }
  // §1.4a: present means exactly one colour per face. A list that expands to
  // any other length is a defect in the payload, not something to pad.
  let facecolors: Array<[number, number, number]> | undefined
  // Face colours arrived with the palette, so there is no v1 form of them.
  if (p.facecolors !== undefined) {
    const expanded = unpackFaceColors(p.facecolors, faces.length, palette)
    if (!expanded) return null
    facecolors = expanded.map((i) => colorAt(palette, i))
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
    ...(facecolors ? { facecolors } : {}),
    // Only a payload that says so stands up; `spin` without `up` is ignored,
    // the way the field is documented.
    up,
    spin: up ? wrapSpin(Number(p.spin ?? 0)) : 0,
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

/**
 * A vertex through a pose, if there is one: the shard standing on the Earth
 * (lib/pose.ts) rather than lying on cyberspace axes as it was built. Applied
 * in ticks, before `toRender`, so the pose is a turn of the shape and nothing
 * about the screen.
 */
export function posed(t: [number, number, number], pose?: Pose): [number, number, number] {
  return pose ? applyPose(pose, t) : t
}

export function flatten(s: ShardModel, pose?: Pose): { positions: Float32Array; colors: Float32Array; index: number[] } {
  const positions = new Float32Array(s.vertices.length * 3)
  const colors = new Float32Array(s.vertices.length * 3)
  s.vertices.forEach((v, i) => {
    positions.set(toRender(posed(ticksOf(v), pose)), i * 3)
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
