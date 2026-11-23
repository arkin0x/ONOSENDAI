/**
 * stampCopy.ts: STAMP's COPY, a shard's geometry put into the open shard as
 * real points and faces of its own (owner, 2026-11-23: "when you select a
 * shard, the stamp tool will copy the geometry of the selected shard into
 * your scene"). Its opposite is LINK, which places the shard as one object by
 * reference (DECK-0003 §1.10, store/useWorkshop.ts placeObject).
 *
 * Two steps, so a tap on the bench is synchronous:
 *
 *   bakeSource   once, when the shard is chosen: the shard and everything it
 *                places (its own table, your workshop, the relays), resolved
 *                by sno-core resolveParts and flattened into one set of
 *                points and faces in the shard's own ticks, each placed
 *                object carried by the same matrix the bench draws it with
 *                (partMatrix). Nothing of a reference is left.
 *   stampCopyInto  every tap: that set carried to the tap by the placement
 *                LINK would make there (the same matrix again, so the ghost
 *                is exactly where COPY lands), its colours merged into the
 *                open shard's palette, its seams kept, the grid grown to hold
 *                it. What it added is returned as two index ranges, the
 *                points and the faces this stamp made (`StampedRange`), for
 *                whatever wants to act on just them (a group, a selection).
 *
 * Pure: the store applies the result as one undoable edit.
 */

import { addPart, partMatrix, type Placed } from 'sno-core/parts'
import { MAX_EXTENT, TICKS_PER_UNIT, ticksOf, vertexAt, type Ref, type ShardModel, type ShardVertex } from 'sno-core/shards'
import { BUILT_IN, toBytes, type Palette, type Rgb } from 'sno-core/snoPalette'
import type { Facing } from 'sno-core/stamps'

type P3 = [number, number, number]
type Tri = [number, number, number]

/** A shard and everything it places, flattened: what COPY puts down. In the source shard's own ticks and unit. */
export interface CopySource {
  /** The source's unit: its ticks are 2^unit gibsons apart, as a placement of it would be drawn. */
  unit: number
  points: Array<{ at: P3; c: Rgb }>
  faces: Tri[]
  /** One hard colour per face (DECK-0003 §1.4a), all or none. */
  facecolors?: Rgb[]
  /** Every colour it uses, as palette bytes, once each. */
  colors: Rgb[]
  /** Bounds of its points in its own ticks, or null when it has none. */
  min: P3 | null
  max: P3 | null
  /** How many placed objects were flattened into it. */
  flattened: number
  /** Points that fell between ticks (a placement turned off the quarter, or scaled down) and were rounded to the nearest. */
  rounded: number
}

/** The points and faces one COPY stamp added: [first, end) of each, at the end of the shard's lists. */
export interface StampedRange {
  shardId: string
  vertices: [number, number]
  faces: [number, number]
}

/** Every index a StampedRange names: the points and the faces one COPY stamp made. */
export function stampedIndices(range: Pick<StampedRange, 'vertices' | 'faces'>): { vertices: number[]; faces: number[] } {
  const span = ([a, b]: [number, number]): number[] => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k)
  return { vertices: span(range.vertices), faces: span(range.faces) }
}

/** A 4x4 column-major matrix, as partMatrix gives one. */
type M4 = number[]
const IDENTITY: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function mul(a: M4, b: M4): M4 {
  const o = new Array<number>(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
    o[c * 4 + r] = s
  }
  return o
}

/** A point in model ticks through a render-frame matrix (shards.ts toRender, then back), unrounded. */
function carry(m: M4, t: P3): P3 {
  const x = t[0] / TICKS_PER_UNIT, y = t[1] / TICKS_PER_UNIT, z = (0 - t[2]) / TICKS_PER_UNIT
  const rx = m[0] * x + m[4] * y + m[8] * z + m[12]
  const ry = m[1] * x + m[5] * y + m[9] * z + m[13]
  const rz = m[2] * x + m[6] * y + m[10] * z + m[14]
  return [rx * TICKS_PER_UNIT, ry * TICKS_PER_UNIT, 0 - rz * TICKS_PER_UNIT]
}

/** Within a millionth of a tick of a whole one: float noise from a quarter turn, not a point between ticks. */
const whole = (n: number): boolean => Math.abs(n - Math.round(n)) < 1e-6
/** Rounded half away from zero, never -0. */
const tick = (n: number): number => { const r = Math.round(Math.abs(n)); return n < 0 && r !== 0 ? 0 - r : r }

const colorKey = (c: Rgb): string => `${c[0]},${c[1]},${c[2]}`

/** A face's colour when it has no seam of its own: its corners' average, as PASTE gives one (lib/weld cornerAverage). */
function average(vs: readonly Pick<ShardVertex, 'c'>[], f: Tri): Rgb {
  const s: Rgb = [0, 0, 0]
  for (const i of f) { const c = vs[i]?.c; if (c) { s[0] += c[0]; s[1] += c[1]; s[2] += c[2] } }
  return [s[0] / 3, s[1] / 3, s[2] / 3]
}

/**
 * Why a shard cannot be baked: a placement nothing answered (or one past the
 * depth a reader follows, or a loop). COPY leaves no reference behind, so it
 * needs every object a shard places; LINK does not.
 */
export function missingIn(placed: readonly Placed[]): number {
  let n = 0
  for (const p of placed) n += p.model ? missingIn(p.children) : 1
  return n
}

/**
 * The shard and everything `placed` (sno-core resolveParts of it) places,
 * flattened into one CopySource in the shard's own ticks. Null when any
 * placement is missing (missingIn), unless `partial`: then what was found,
 * for a LINK's bounds (SNAP TO ITS SIZE), never for a COPY.
 */
export function bakeSource(root: ShardModel, placed: readonly Placed[], partial = false): CopySource | null {
  if (!partial && missingIn(placed) > 0) return null
  const points: CopySource['points'] = []
  const faces: Tri[] = []
  const seams: Array<Rgb | null> = []
  let anySeam = false
  let rounded = 0
  let flattened = 0
  const take = (model: ShardModel, m: M4 | null): void => {
    const base = points.length
    for (const v of model.vertices) {
      const raw = m ? carry(m, ticksOf(v)) : ticksOf(v)
      if (!raw.every(whole)) rounded++
      points.push({ at: raw.map(tick) as P3, c: [...v.c] as Rgb })
    }
    const own = model.facecolors && model.facecolors.length === model.faces.length && model.faces.length > 0 ? model.facecolors : null
    if (own) anySeam = true
    model.faces.forEach((f, k) => {
      faces.push([f[0] + base, f[1] + base, f[2] + base])
      seams.push(own ? ([...own[k]] as Rgb) : null)
    })
  }
  const walk = (model: ShardModel, list: readonly Placed[], at: M4): void => {
    for (const p of list) {
      if (!p.model) continue
      const m = mul(at, partMatrix(p.part, model.unit, p.model.unit))
      flattened++
      take(p.model, m)
      walk(p.model, p.children, m)
    }
  }
  take(root, null)
  walk(root, placed, IDENTITY)
  // Seams are all or none: a face that had none takes its corners' average, as PASTE does.
  const facecolors = anySeam ? seams.map((c, k) => c ?? average(points, faces[k])) : undefined
  const keys = new Map<string, Rgb>()
  for (const p of points) { const b = toBytes(p.c); keys.set(colorKey(b), b) }
  for (const c of facecolors ?? []) { const b = toBytes(c); keys.set(colorKey(b), b) }
  let min: P3 | null = null, max: P3 | null = null
  for (const p of points) {
    if (!min || !max) { min = [...p.at] as P3; max = [...p.at] as P3; continue }
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.at[k]); max[k] = Math.max(max[k], p.at[k]) }
  }
  return { unit: root.unit, points, faces, ...(facecolors ? { facecolors } : {}), colors: [...keys.values()], min, max, flattened, rounded }
}

/** The placement a stamp makes at `at`, turned by its facing: LINK's (store placeObject) and COPY's alike. */
export function stampPart(at: P3, facing: Facing): { ref: number; at: P3; turn: P3; step: number } {
  return { ref: 0, at: [...at] as P3, turn: [0, (90 * facing) % 360, 0], step: 0 }
}

/**
 * The size of what a stamp puts down, in the open shard's ticks, along each
 * axis, turned by its facing: what SNAP TO ITS SIZE steps by. From the
 * source's bounds (points and everything it places), carried as the stamp
 * carries them.
 */
export function stampSize(src: Pick<CopySource, 'min' | 'max' | 'unit'>, facing: Facing, targetUnit: number): P3 | null {
  if (!src.min || !src.max) return null
  const m = partMatrix(stampPart([0, 0, 0], facing), targetUnit, src.unit)
  const lo: P3 = [Infinity, Infinity, Infinity], hi: P3 = [-Infinity, -Infinity, -Infinity]
  for (const x of [src.min[0], src.max[0]]) for (const y of [src.min[1], src.max[1]]) for (const z of [src.min[2], src.max[2]]) {
    const p = carry(m, [x, y, z])
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]) }
  }
  return [0, 1, 2].map((k) => Math.round(hi[k] - lo[k])) as P3
}

/**
 * A point on the grid snapped to a stamp's own size along the two axes in the
 * working plane: a 16-gibson piece lands on 16-gibson steps, so pieces of one
 * size line up edge to edge. An axis the piece has no size along (flat that
 * way) keeps the grid's own step. `raw` is in ticks, unrounded; the axis along
 * the plane's normal is the level, as every placing tool has it.
 */
export function snapToSize(raw: P3, level: number, plane: 0 | 1 | 2, size: P3, step: number): P3 {
  const out = [...raw] as P3
  for (let k = 0; k < 3; k++) {
    if (k === plane) { out[k] = level; continue }
    const s = size[k] >= step ? size[k] : step
    out[k] = tick(Math.round(raw[k] / s) * s)
  }
  return out
}

/** The open shard's palette with the colours a stamp brings, or why some could not be added. */
export interface PaletteMerge {
  /** The palette to write: undefined to leave the shard's as it is. */
  palette?: Palette
  /** Colours there was no room for: the wire gives each its nearest in the palette. */
  snapped: number
}

/**
 * The colours a stamp brings (`colors`, palette bytes) added to the open
 * shard's palette (DECK-0003 §1.3a), so they go on the wire as they are and
 * are not snapped to the nearest the palette has. An empty shard on the
 * built-in takes the stamp's own colours as its palette. Otherwise each
 * missing colour is appended while there is room (256), then put in the place
 * of a colour the shard does not use, from the end, and only when neither is
 * left is it counted as snapped. Colours the shard uses never move: its
 * points keep their colours and their indices.
 */
export function mergePalette(target: Pick<ShardModel, 'palette' | 'vertices' | 'facecolors' | 'faces'>, colors: readonly Rgb[]): PaletteMerge {
  const base: Palette = target.palette ?? BUILT_IN
  const has = new Set(base.map(colorKey))
  const missing = colors.filter((c) => !has.has(colorKey(c)))
  if (missing.length === 0) return { snapped: 0 }
  const empty = target.vertices.length === 0 && target.faces.length === 0
  if (empty && !target.palette) {
    // Its own colours, at least two (a palette has 2 to 256), the rest of the built-in never needed.
    const own: Palette = []
    const seen = new Set<string>()
    for (const c of colors) { const k = colorKey(c); if (!seen.has(k) && own.length < 256) { seen.add(k); own.push([...c] as Rgb) } }
    for (const c of BUILT_IN) { if (own.length >= 2) break; if (!seen.has(colorKey(c))) own.push([...c] as Rgb) }
    return { palette: own, snapped: Math.max(0, seen.size - own.length) }
  }
  const used = new Set<string>()
  for (const v of target.vertices) used.add(colorKey(toBytes(v.c)))
  if (target.facecolors && target.facecolors.length === target.faces.length) for (const c of target.facecolors) used.add(colorKey(toBytes(c)))
  const pal: Palette = base.map((c) => [...c] as Rgb)
  const taken = new Set<number>()
  let free = pal.length - 1
  let snapped = 0
  for (const c of missing) {
    if (pal.length < 256) { pal.push([...c] as Rgb); continue }
    while (free >= 0 && (used.has(colorKey(pal[free])) || taken.has(free) || colors.some((k) => colorKey(k) === colorKey(pal[free])))) free--
    if (free < 0) { snapped++; continue }
    pal[free] = [...c] as Rgb
    taken.add(free)
    free--
  }
  return { palette: pal, snapped }
}

/** What one COPY stamp did, or why it was not done. */
export type CopyResult =
  | { ok: true; shard: ShardModel; added: Omit<StampedRange, 'shardId'>; snapped: number }
  | { ok: false; why: string }

/**
 * `src` put down in `target` where a LINK at `at`, turned by `facing`, would
 * stand: points, faces and seams appended (so what it added is the end of
 * each list), colours merged into the palette, the grid grown to hold it as
 * far as a grid goes. `check` false skips the grid's bound, for a size
 * estimate of a stamp not yet aimed.
 */
export function stampCopyInto(target: ShardModel, src: CopySource, at: P3, facing: Facing, check = true): CopyResult {
  if (src.points.length === 0) return { ok: false, why: 'That shard has nothing in it to copy.' }
  const m = partMatrix(stampPart(at, facing), target.unit, src.unit)
  const placed = src.points.map((p) => ({ at: carry(m, p.at).map(tick) as P3, c: p.c }))
  let reach = 0
  for (const p of placed) for (const n of p.at) reach = Math.max(reach, Math.ceil(Math.abs(n) / TICKS_PER_UNIT))
  if (check && reach > MAX_EXTENT) return { ok: false, why: 'Not stamped: it would reach past the edge of the grid. Stamp it nearer the middle.' }
  const extent = Math.min(MAX_EXTENT, Math.max(target.extent, reach))
  const base = target.vertices.length
  const fbase = target.faces.length
  const pasted = src.faces.map((f) => [f[0] + base, f[1] + base, f[2] + base] as Tri)
  const { facecolors: _held, ...bare } = target
  let next: ShardModel = {
    ...bare,
    extent,
    vertices: [...target.vertices, ...placed.map((p) => vertexAt(p.at, [...p.c] as Rgb))],
    faces: [...target.faces, ...pasted],
  }
  // Seams are all or none (sno-core shards): when either side has them every face carries one.
  const own = target.faces.length > 0 && target.facecolors && target.facecolors.length === target.faces.length ? target.facecolors : null
  const theirs = src.faces.length > 0 && src.facecolors && src.facecolors.length === src.faces.length ? src.facecolors : null
  if (own || theirs) {
    next = {
      ...next,
      facecolors: [
        ...(own ?? target.faces.map((f) => average(target.vertices, f))),
        ...(theirs ? theirs.map((c) => [...c] as Rgb) : pasted.map((f) => average(next.vertices, f))),
      ],
    }
  }
  const merge = mergePalette(target, src.colors)
  if (merge.palette) next = { ...next, palette: merge.palette }
  // The first faces switch the shard to SOLID, as a stamp's do.
  if (target.faces.length === 0 && next.faces.length > 0 && next.mode !== 'solid') next = { ...next, mode: 'solid' }
  return { ok: true, shard: next, added: { vertices: [base, next.vertices.length], faces: [fbase, next.faces.length] }, snapped: merge.snapped }
}

/** STAMP's two ways with a shard: COPY its geometry in, or LINK it as one object by reference. COPY is the default (owner, 2026-11-23). */
export type StampForm = 'copy' | 'link'

/**
 * What one stamp of `form` at `at` would leave the open shard as: COPY
 * through stampCopyInto, LINK as the one placement store placeObject adds.
 * The store's taps and the library's projection (how full it would be) both
 * come through here, so what the bar shows is what a tap does.
 */
export function stampedShard(target: ShardModel, choice: { ref: Ref; copy?: CopySource | null }, form: StampForm, at: P3, facing: Facing, check = true): CopyResult {
  if (form === 'copy') {
    if (!choice.copy) return { ok: false, why: 'COPY needs a shard from your library whose placed objects can all be read. Choose one, or switch to LINK.' }
    return stampCopyInto(target, choice.copy, at, facing, check)
  }
  const { shard } = addPart(target, choice.ref, stampPart(at, facing))
  return { ok: true, shard, added: { vertices: [target.vertices.length, target.vertices.length], faces: [target.faces.length, target.faces.length] }, snapped: 0 }
}
