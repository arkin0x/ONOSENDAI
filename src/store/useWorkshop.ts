/**
 * useWorkshop.ts — the shards you are building, and the one on the bench.
 *
 * Everything here is local: shards persist in localStorage until deployed,
 * and a deployed shard stays here too, so it can be deployed again somewhere
 * else or edited into a new one. The editing model is small and exact: stamp
 * a shape, place a vertex, select a point and nudge it a unit along an axis,
 * color it, tap corners into a face. It fits a thumb.
 *
 * Two rules about points. A vertex you ADD lands on an empty point or selects
 * the one already there, so hand placing never stacks vertices by accident. A
 * stamp brings its own vertices even onto occupied points (stamps.ts says
 * why), so from then on "a point" can be several vertices, and SELECT, the
 * nudge pad, the color and DELETE act on every vertex at every selected point
 * together. What you see is one dot, and it behaves like one dot; a box
 * dragged on the bench, or CONNECTED, selects many at once.
 *
 * Every change to the current shard goes through `edit`, which is also where
 * undo lives: the shard as it was is pushed onto a stack, redo holds what
 * undo popped, and switching shards clears both. Renaming is not an edit.
 */

import { create } from 'zustand'
import {
  DIVISIONS,
  GRID_HALF,
  TICKS_PER_UNIT,
  centroid,
  normalizeStored,
  ticksOf,
  vertexAt,
  type Division,
  MAX_EXTENT,
  MIN_EXTENT,
  neededExtent,
  MAX_FACES,
  MAX_VERTICES,
  clampColor,
  fromPayload,
  newShard,
  pointKey,
  toPayload,
  uuid,
  validFace,
  validPoint,
  type ShardMode,
  type ShardModel,
  type ShardVertex,
} from '../lib/shards'
import { MAX_SIZE, MIN_SIZE, stamp, type Facing, type StampKind } from '../lib/stamps'
import { newell, triangulate } from '../lib/triangulate'
import { Vector3 } from 'three'
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js'

/** VIEW builds nothing: it is the tool you hold to look around. */
export type Tool = 'view' | 'stamp' | 'add' | 'select' | 'face'

const STORAGE = 'onosendai:shards'
const PALETTE_STORAGE = 'onosendai:palette'
const AVATAR_KEY = 'onosendai:workshop-avatar'
/** Undo depth per shard. */
const HISTORY = 64
/** The swatches every workshop starts with. */
export const DEFAULT_PALETTE = ['#00e5ff', '#ff2323', '#52e39f', '#ffb020', '#c07dff', '#f7931a', '#ffffff', '#2f81f7']
/** Swatches the palette keeps before the oldest falls off the end. */
const PALETTE_MAX = 24
const HEX = /^#[0-9a-f]{6}$/

type P3 = [number, number, number]

/**
 * Where a quarter turn pivots. The middle of the points' extent serves when a
 * turn about it keeps every point on the snap grid: that is when the middle's
 * x and z are both on a grid line or both halfway between lines, which is
 * every square footprint, odd or even. Otherwise (a two by three, say) the
 * middle snapped to the grid, and the caller keeps that point for the next
 * turn so the shape cycles home in four instead of walking a step each time.
 */
function turnPivotFor(pts: P3[], step: number): [number, number] {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const [x, , z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z) }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2
  const rem = (v: number): number => ((v % step) + step) % step
  const half = step / 2
  if ((rem(cx) === 0 && rem(cz) === 0) || (rem(cx) === half && rem(cz) === half)) return [cx, cz]
  const snap = (v: number): number => Math.round(v / step) * step
  return [snap(cx), snap(cz)]
}

export interface WorkshopState {
  shards: ShardModel[]
  currentId: string | null
  /** The workshop overlay is up. */
  open: boolean
  tool: Tool
  /**
   * Selected vertex indices, always whole points: selecting a vertex selects
   * every vertex on its point, and the nudge pad, the color and DELETE act on
   * all of them together. Built by tapping points, dragging a box on the
   * bench, or CONNECTED.
   */
  selection: number[]
  /** Corners picked so far for the next face, in order. */
  facePick: number[]
  /** The face tapped in FACE mode, an index into the shard's faces, so DELETE can take it. */
  selectedFace: number | null
  /** Swatches to hand: newest first, every color the picker ever settled on, then the defaults. */
  palette: string[]
  /** The Y the add and stamp tools place on, in ticks: the grid plane moves up and down. */
  level: number
  /** Snap: the grid the placing tools, the marquee and the nudges use is a unit over this. A tool setting, not the shard's. */
  division: Division
  /** The to-scale avatar at the grid's centre, on or off. Kept between visits. */
  showAvatar: boolean
  /** The color new vertices get, and the color input shows. */
  color: [number, number, number]
  stampKind: StampKind
  stampSize: number
  stampFacing: Facing
  /** The grid point under the pointer, where a tap would land; null off the grid. */
  aim: P3 | null
  /** The current shard as it was before each edit, oldest first. */
  past: ShardModel[]
  /** What undo took away, for redo. */
  future: ShardModel[]
  /** One line about the last action, shown on the bench until the next edit. */
  notice: string | null
  /** Where the last turn pivoted, kept while the same selection turns again. */
  turnPivot: { key: string; at: [number, number] } | null

  openWorkshop: (id?: string) => void
  closeWorkshop: () => void
  create: (name?: string) => string
  select: (id: string | null) => void
  rename: (id: string, name: string) => void
  duplicate: (id: string) => string
  remove: (id: string) => void
  setMode: (mode: ShardMode) => void
  setUnit: (unit: number) => void
  /** The build grid's half-width for the current shard, never below what its vertices need. */
  setExtent: (extent: number) => void
  setTool: (tool: Tool) => void
  setLevel: (level: number) => void
  setDivision: (division: Division) => void
  setShowAvatar: (on: boolean) => void
  /** One snap step, in ticks. */
  step: () => number
  setColor: (c: [number, number, number]) => void
  setStampKind: (kind: StampKind) => void
  setStampSize: (size: number) => void
  turnStamp: () => void
  setAim: (p: P3 | null) => void
  placeStamp: (at: P3) => void
  addVertex: (p: P3) => void
  /** Select one point only (null clears). Also drops any selected face: a point and a face are never selected together. */
  selectVertex: (index: number | null) => void
  /** Add the point to the selection, or take it out if it is in. */
  toggleVertex: (index: number) => void
  /** Replace the selection; whole points, whatever indices are given. */
  setSelection: (indices: number[]) => void
  /** Grow the selection to every vertex joined to it by faces (and by shared points). */
  selectConnected: () => void
  selectFace: (index: number | null) => void
  deleteSelectedFace: () => void
  /** Put a color at the front of the palette (moving it there if it is already in). */
  rememberColor: (hex: string) => void
  forgetColor: (hex: string) => void
  moveSelected: (axis: 0 | 1 | 2, delta: number) => void
  /**
   * Turn the selected points a quarter turn about the vertical, +1 one way
   * and -1 the other, around the middle of their extent snapped to the
   * current DIVISION's grid, so every point stays on that grid.
   */
  rotateSelected: (turns: 1 | -1) => void
  colorSelected: (c: [number, number, number]) => void
  colorAll: (c: [number, number, number]) => void
  deleteSelected: () => void
  pickForFace: (index: number) => void
  clearFacePick: () => void
  /** Make faces from the picked corners, in order. */
  fill: () => void
  /** Faces for the selected points at once: a flat set becomes one polygon, a solid set its convex hull. */
  fillSelection: () => void
  removeFace: (index: number) => void
  clearShard: () => void
  undo: () => void
  redo: () => void
  /** The current shard in wire form, for the clipboard. */
  exportCurrent: () => string | null
  /** A shard from wire form (the clipboard); the new shard's id, or null if it is not one. */
  importText: (text: string) => string | null
  /** Add a deep copy of a model from elsewhere (a found shard) to your Stash; returns its new id. */
  importShard: (model: ShardModel) => string
  current: () => ShardModel | null
}

function load(): ShardModel[] {
  try {
    const raw = localStorage.getItem(STORAGE)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list)
      ? list.filter((s) => s && typeof s.id === 'string' && Array.isArray(s.vertices)).map((s) => normalizeStored(s)).map((s) => ({ ...s, extent: Number.isInteger(s.extent) ? s.extent : Math.max(GRID_HALF, neededExtent(s)) }))
      : []
  } catch { return [] }
}

function save(shards: ShardModel[]): void {
  try { localStorage.setItem(STORAGE, JSON.stringify(shards)) } catch { /* quota or private mode */ }
}

function loadPalette(): string[] {
  try {
    const raw = localStorage.getItem(PALETTE_STORAGE)
    const list: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(list) && list.every((h) => typeof h === 'string' && HEX.test(h)) ? list : DEFAULT_PALETTE
  } catch { return DEFAULT_PALETTE }
}

function loadShowAvatar(): boolean {
  try { return localStorage.getItem(AVATAR_KEY) !== '0' } catch { return true }
}

function savePalette(palette: string[]): void {
  try { localStorage.setItem(PALETTE_STORAGE, JSON.stringify(palette)) } catch { /* quota or private mode */ }
}

/** Every vertex on the same point as vertex `index`, itself included. */
function group(s: ShardModel, index: number): number[] {
  const v = s.vertices[index]
  if (!v) return []
  const key = pointKey(ticksOf(v))
  const out: number[] = []
  s.vertices.forEach((o, i) => { if (pointKey(ticksOf(o)) === key) out.push(i) })
  return out
}

const faceKey = (f: [number, number, number]): string => [...f].sort((a, b) => a - b).join(',')

type Tri = [number, number, number]
type Tris = Tri[] & { hull?: boolean }

/**
 * Faces for a set of points with no order given. Flat (all on one plane): the
 * points are walked around their centre and the polygon triangulated. Not
 * flat: their convex hull, every triangle outward. Null when they lie on a
 * line. Indices are into `pts`.
 */
function facesFor(pts: P3[]): Tris | null {
  const c: P3 = [0, 0, 0]
  for (const p of pts) for (let a = 0; a < 3; a++) c[a] += p[a] / pts.length
  const n = newell(pts)
  const len = Math.hypot(n[0], n[1], n[2])
  // Distance of every point from the best plane through them.
  const flat = len > 1e-9 && pts.every((p) => Math.abs(((p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1] + (p[2] - c[2]) * n[2]) / len) < 1e-6)
  if (flat) {
    const u: P3 = Math.abs(n[0]) < 0.9 * len ? [0, n[2], -n[1]] : [n[2], 0, -n[0]]
    const ul = Math.hypot(u[0], u[1], u[2]); u[0] /= ul; u[1] /= ul; u[2] /= ul
    const v: P3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]
    const vl = Math.hypot(v[0], v[1], v[2]); v[0] /= vl; v[1] /= vl; v[2] /= vl
    const angle = (p: P3): number => Math.atan2((p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1] + (p[2] - c[2]) * v[2], (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1] + (p[2] - c[2]) * u[2])
    const order = pts.map((p, i) => ({ i, a: angle(p) })).sort((x, y) => x.a - y.a).map((x) => x.i)
    const tris = triangulate(order.map((i) => pts[i]))
    if (!tris) return null
    return tris.map((t) => [order[t[0]], order[t[1]], order[t[2]]] as Tri)
  }
  const hull = new ConvexHull().setFromPoints(pts.map((p) => new Vector3(p[0], p[1], p[2])))
  const at = new Map(pts.map((p, i) => [pointKey(p), i]))
  const out: Tris = []
  for (const face of hull.faces) {
    const corners: number[] = []
    let e = face.edge
    do { corners.push(at.get(pointKey([e.head().point.x, e.head().point.y, e.head().point.z] as P3)) as number); e = e.next } while (e !== face.edge)
    if (corners.length === 3 && corners.every((i) => i !== undefined)) out.push([corners[0], corners[1], corners[2]])
  }
  if (out.length === 0) return null
  out.hull = true
  return out
}

/** The face wound so its normal points away from `centre`. */
function awayFrom(s: ShardModel, f: Tri, centre: P3): Tri {
  const [a, b, c] = f.map((i) => ticksOf(s.vertices[i]))
  const n = newell([a, b, c])
  const m: P3 = [(a[0] + b[0] + c[0]) / 3 - centre[0], (a[1] + b[1] + c[1]) / 3 - centre[1], (a[2] + b[2] + c[2]) / 3 - centre[2]]
  return n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0 ? [f[0], f[2], f[1]] : f
}

export const useWorkshop = create<WorkshopState>((set, get) => {
  /** Apply an edit to the current shard, remember what it was, stamp it, persist. */
  const edit = (fn: (s: ShardModel) => ShardModel | null, notice: string | null = null): boolean => {
    const { shards, currentId, past } = get()
    const i = shards.findIndex((s) => s.id === currentId)
    if (i < 0) return false
    const next = fn(shards[i])
    if (!next) return false
    const list = shards.slice()
    list[i] = { ...next, updatedAt: Date.now() }
    set({ shards: list, past: [...past.slice(-(HISTORY - 1)), shards[i]], future: [], notice, turnPivot: null })
    save(list)
    return true
  }

  /** Faces show only in SOLID: a shard's first faces switch it there. */
  const solidIfFirstFaces = (before: ShardModel, after: ShardModel): { mode: ShardMode; notice: string | null } =>
    before.faces.length === 0 && after.faces.length > 0 && before.mode !== 'solid'
      ? { mode: 'solid', notice: 'Switched to SOLID so the faces show. POINTS and LINES are one tap away.' }
      : { mode: after.mode, notice: null }

  return {
    shards: load(),
    currentId: null,
    open: false,
    tool: 'view',
    selection: [],
    facePick: [],
    selectedFace: null,
    palette: loadPalette(),
    level: 0,
    division: 1,
    turnPivot: null,
    showAvatar: loadShowAvatar(),
    color: [0, 0.9, 1],
    stampKind: 'block',
    stampSize: 2,
    stampFacing: 0,
    aim: null,
    past: [],
    future: [],
    notice: null,

    openWorkshop: (id) => {
      const { shards } = get()
      const currentId = id ?? get().currentId ?? shards[0]?.id ?? get().create()
      set({ open: true, currentId, selection: [], selectedFace: null, facePick: [], tool: 'view', aim: null, past: [], future: [], notice: null })
    },

    closeWorkshop: () => set({ open: false, selection: [], selectedFace: null, facePick: [], aim: null }),

    create: (name) => {
      const s = newShard(name ?? `Shard ${get().shards.length + 1}`)
      const list = [...get().shards, s]
      set({ shards: list, currentId: s.id, selection: [], selectedFace: null, facePick: [], past: [], future: [], notice: null })
      save(list)
      return s.id
    },

    select: (id) => set({ currentId: id, selection: [], selectedFace: null, facePick: [], past: [], future: [], notice: null }),

    rename: (id, name) => {
      const list = get().shards.map((s) => (s.id === id ? { ...s, name: name.slice(0, 64), updatedAt: Date.now() } : s))
      set({ shards: list }); save(list)
    },

    duplicate: (id) => {
      const src = get().shards.find((s) => s.id === id)
      if (!src) return id
      const copy: ShardModel = { ...src, id: uuid(), name: `${src.name} copy`, vertices: src.vertices.map((v) => ({ p: [...v.p] as P3, c: [...v.c] as ShardVertex['c'] })), faces: src.faces.map((f) => [...f] as [number, number, number]), updatedAt: Date.now() }
      const list = [...get().shards, copy]
      set({ shards: list, currentId: copy.id, selection: [], selectedFace: null, facePick: [], past: [], future: [], notice: null }); save(list)
      return copy.id
    },

    remove: (id) => {
      const list = get().shards.filter((s) => s.id !== id)
      const currentId = get().currentId === id ? (list[0]?.id ?? null) : get().currentId
      set({ shards: list, currentId, selection: [], selectedFace: null, facePick: [], past: [], future: [], notice: null }); save(list)
    },

    setMode: (mode) => edit((s) => ({ ...s, mode })),
    setUnit: (unit) => edit((s) => ({ ...s, unit: Math.max(0, Math.min(84, Math.round(unit))) })),
    setTool: (tool) => set({ tool, facePick: [], selectedFace: null, aim: null }),
    setExtent: (extent) => {
      const s = get().current()
      if (!s) return
      const e = Math.max(Math.max(MIN_EXTENT, neededExtent(s)), Math.min(MAX_EXTENT, Math.round(extent)))
      if (e === s.extent) return
      edit((cur) => ({ ...cur, extent: e }))
      set({ level: Math.max(-e * TICKS_PER_UNIT, Math.min(e * TICKS_PER_UNIT, get().level)) })
    },
    setLevel: (level) => {
      const e = (get().current()?.extent ?? GRID_HALF) * TICKS_PER_UNIT
      set({ level: Math.max(-e, Math.min(e, Math.round(level))) })
    },
    setDivision: (division) => { if (DIVISIONS.includes(division)) set({ division }) },
    setShowAvatar: (on) => { set({ showAvatar: on }); try { localStorage.setItem(AVATAR_KEY, on ? '1' : '0') } catch { /* private mode */ } },
    step: () => TICKS_PER_UNIT / get().division,
    setColor: (c) => set({ color: clampColor(c) }),
    setStampKind: (stampKind) => set({ stampKind }),
    setStampSize: (size) => set({ stampSize: Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(size))) }),
    turnStamp: () => set({ stampFacing: ((get().stampFacing + 1) % 4) as Facing }),

    setAim: (p) => {
      const a = get().aim
      if (a === p || (a && p && a[0] === p[0] && a[1] === p[1] && a[2] === p[2])) return
      set({ aim: p })
    },

    placeStamp: (at) => {
      const { stampKind, stampSize, stampFacing, color } = get()
      const s = get().current()
      if (!s || !validPoint(at, s.extent)) return
      const res = stamp(s, stampKind, stampSize, stampFacing, at, color)
      if (!res) { set({ notice: `No room: a shard holds up to ${MAX_VERTICES} vertices and ${MAX_FACES} faces.` }); return }
      const { mode, notice } = solidIfFirstFaces(s, res.shard)
      edit(() => ({ ...res.shard, mode }), notice)
      set({ selection: [], selectedFace: null, facePick: [] })
    },

    addVertex: (p) => {
      if (!validPoint(p, get().current()?.extent ?? GRID_HALF)) return
      let added = -1
      edit((s) => {
        // One vertex per point by hand: adding where one already is selects it instead.
        const existing = s.vertices.findIndex((v) => pointKey(ticksOf(v)) === pointKey(p))
        if (existing >= 0) { added = existing; return null }
        added = s.vertices.length
        return { ...s, vertices: [...s.vertices, vertexAt(p, [...get().color] as ShardVertex['c'])] }
      })
      if (added >= 0) set({ selection: group(get().current()!, added), selectedFace: null })
    },

    selectVertex: (index) => {
      const s = get().current()
      set({ selection: index === null || !s ? [] : group(s, index), selectedFace: null })
    },

    toggleVertex: (index) => {
      const s = get().current()
      if (!s || !s.vertices[index]) return
      const g = group(s, index)
      const has = get().selection.includes(index)
      set({ selection: has ? get().selection.filter((i) => !g.includes(i)) : [...get().selection, ...g], selectedFace: null })
    },

    setSelection: (indices) => {
      const s = get().current()
      if (!s) { set({ selection: [] }); return }
      const out = new Set<number>()
      for (const i of indices) if (s.vertices[i]) for (const j of group(s, i)) out.add(j)
      set({ selection: [...out].sort((a, b) => a - b), selectedFace: null })
    },

    selectConnected: () => {
      const s = get().current()
      const { selection } = get()
      if (!s || selection.length === 0) return
      // Union-find over vertices: a shared point joins, a face joins its three corners.
      const parent = s.vertices.map((_, i) => i)
      const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
      const join = (a: number, b: number): void => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
      const byPoint = new Map<string, number>()
      s.vertices.forEach((v, i) => { const k = pointKey(ticksOf(v)); const first = byPoint.get(k); if (first === undefined) byPoint.set(k, i); else join(first, i) })
      for (const f of s.faces) { join(f[0], f[1]); join(f[1], f[2]) }
      const roots = new Set(selection.map(find))
      const out = s.vertices.map((_, i) => i).filter((i) => roots.has(find(i)))
      const grew = out.length > selection.length
      set({ selection: out, selectedFace: null, notice: grew ? `${new Set(out.map((i) => pointKey(ticksOf(s.vertices[i])))).size} points connected by faces.` : 'Nothing else is joined to the selection by faces.' })
    },

    selectFace: (index) => set({ selectedFace: index, selection: index === null ? get().selection : [] }),

    deleteSelectedFace: () => {
      const { selectedFace } = get()
      if (selectedFace === null) return
      get().removeFace(selectedFace)
      set({ selectedFace: null })
    },

    rememberColor: (hex) => {
      const h = hex.toLowerCase()
      if (!HEX.test(h)) return
      const palette = [h, ...get().palette.filter((x) => x !== h)].slice(0, PALETTE_MAX)
      set({ palette }); savePalette(palette)
    },

    forgetColor: (hex) => {
      const palette = get().palette.filter((x) => x !== hex.toLowerCase())
      set({ palette }); savePalette(palette)
    },

    moveSelected: (axis, delta) => {
      const { selection } = get()
      if (selection.length === 0) return
      edit((s) => {
        // Every selected point moves the same unit; if any would leave the
        // grid the whole move is refused, so a shape never tears.
        const chosen = new Set(selection.filter((i) => s.vertices[i]))
        if (chosen.size === 0) return null
        const vertices = s.vertices.slice()
        for (const i of chosen) {
          const p = ticksOf(vertices[i])
          p[axis] += delta
          if (!validPoint(p, s.extent)) return null
          vertices[i] = vertexAt(p, vertices[i].c)
        }
        return { ...s, vertices }
      })
    },

    rotateSelected: (turns) => {
      const { selection, turnPivot } = get()
      const s = get().current()
      if (!s || selection.length === 0) return
      const step = get().step()
      const chosen = [...new Set(selection.filter((i) => s.vertices[i]))]
      if (chosen.length === 0) return
      const pts = chosen.map((i) => ticksOf(s.vertices[i]))
      // The same selection turned again turns about the same point; any other
      // edit forgets it (edit() clears it), and so does a change of DIVISION.
      const key = `${step}:${[...chosen].sort((a, b) => a - b).join(',')}`
      const at = turnPivot?.key === key ? turnPivot.at : turnPivotFor(pts, step)
      const [cx, cz] = at
      let refused = false
      edit((m) => {
        const vertices = m.vertices.slice()
        chosen.forEach((i, k) => {
          const [x, y, z] = pts[k]
          const dx = x - cx, dz = z - cz
          const p: P3 = turns === 1 ? [cx + dz, y, cz - dx] : [cx - dz, y, cz + dx]
          if (!validPoint(p, m.extent)) refused = true
          vertices[i] = vertexAt(p, vertices[i].c)
        })
        return refused ? null : { ...m, vertices }
      })
      if (refused) set({ notice: 'That turn would carry a point off the grid.' })
      else set({ turnPivot: { key, at } })
    },

    colorSelected: (c) => {
      const { selection, selectedFace } = get()
      set({ color: clampColor(c) })
      // With no points selected, a selected face takes the color for its corners.
      const face = selection.length === 0 && selectedFace !== null ? get().current()?.faces[selectedFace] : undefined
      if (selection.length === 0 && !face) return
      edit((s) => {
        const chosen = new Set((face ?? selection).filter((i) => s.vertices[i]))
        if (chosen.size === 0) return null
        const vertices = s.vertices.slice()
        for (const i of chosen) vertices[i] = { ...vertices[i], c: clampColor(c) }
        return { ...s, vertices }
      })
    },

    colorAll: (c) => {
      set({ color: clampColor(c) })
      edit((s) => ({ ...s, vertices: s.vertices.map((v) => ({ ...v, c: clampColor(c) })) }))
    },

    deleteSelected: () => {
      const { selection } = get()
      if (selection.length === 0) return
      edit((s) => {
        // Every selected vertex goes; faces that used any of them go; the rest renumber.
        const gone = new Set(selection.filter((i) => s.vertices[i]))
        if (gone.size === 0) return null
        const remap = new Map<number, number>()
        s.vertices.forEach((_, i) => { if (!gone.has(i)) remap.set(i, remap.size) })
        const faces = s.faces
          .filter((f) => !f.some((i) => gone.has(i)))
          .map((f) => f.map((i) => remap.get(i) as number) as [number, number, number])
        return { ...s, vertices: s.vertices.filter((_, i) => !gone.has(i)), faces }
      })
      set({ selection: [], selectedFace: null, facePick: [] })
    },

    pickForFace: (index) => {
      const s = get().current()
      const { facePick } = get()
      if (!s || !s.vertices[index]) return
      // Picks are points, not vertices: any vertex on a picked point counts as that pick.
      const key = pointKey(ticksOf(s.vertices[index]))
      const at = facePick.findIndex((i) => pointKey(ticksOf(s.vertices[i])) === key)
      // Tapping the first corner again closes the loop.
      if (at === 0 && facePick.length >= 3) { get().fill(); return }
      if (at >= 0) { set({ facePick: facePick.filter((_, i) => i !== at), selectedFace: null }); return }
      set({ facePick: [...facePick, index], selectedFace: null })
    },

    clearFacePick: () => set({ facePick: [] }),

    fill: () => {
      const s = get().current()
      const { facePick } = get()
      if (!s || facePick.length < 3) return
      const tris = triangulate(facePick.map((i) => ticksOf(s.vertices[i])))
      if (!tris) { set({ notice: 'Those corners do not make a face. Pick them in order around its edge.' }); return }
      edit((cur) => {
        const have = new Set(cur.faces.map(faceKey))
        const faces = tris
          .map((t) => [facePick[t[0]], facePick[t[1]], facePick[t[2]]] as [number, number, number])
          .filter((f) => validFace(f, cur.vertices.length) && !have.has(faceKey(f)))
        if (!faces.length) return null
        const next = { ...cur, faces: [...cur.faces, ...faces] }
        return { ...next, mode: solidIfFirstFaces(cur, next).mode }
      }, solidIfFirstFaces(s, { ...s, faces: [[0, 0, 0]] }).notice)
      set({ facePick: [] })
    },

    fillSelection: () => {
      const s = get().current()
      const { selection } = get()
      if (!s) return
      // One vertex per point, so a shared point counts once.
      const firstAt = new Map<string, number>()
      for (const i of selection) { const v = s.vertices[i]; if (v && !firstAt.has(pointKey(ticksOf(v)))) firstAt.set(pointKey(ticksOf(v)), i) }
      const idx = [...firstAt.values()]
      if (idx.length < 3) { set({ notice: 'Select three or more points to fill.' }); return }
      const pts = idx.map((i) => ticksOf(s.vertices[i]))
      const faces = facesFor(pts)
      if (!faces) { set({ notice: 'Those points do not make a face: they lie on one line.' }); return }
      const centre = centroid(s)
      const before = s.faces.length
      edit((cur) => {
        const have = new Set(cur.faces.map(faceKey))
        const fresh = faces
          .map((t) => [idx[t[0]], idx[t[1]], idx[t[2]]] as [number, number, number])
          .filter((f) => validFace(f, cur.vertices.length) && !have.has(faceKey(f)))
          // A flat fill faces away from the shard's middle; the hull already does.
          .map((f) => faces.hull ? f : awayFrom(cur, f, centre))
        if (!fresh.length) return null
        const next = { ...cur, faces: [...cur.faces, ...fresh] }
        return { ...next, mode: solidIfFirstFaces(cur, next).mode }
      })
      const added = (get().current()?.faces.length ?? before) - before
      set({ notice: added ? `${added} face${added === 1 ? '' : 's'} ${faces.hull ? 'around' : 'across'} ${idx.length} points.` : 'Those faces are already there.' })
    },

    removeFace: (index) => edit((s) => (s.faces[index] ? { ...s, faces: s.faces.filter((_, i) => i !== index) } : null)),

    clearShard: () => { edit((s) => ({ ...s, vertices: [], faces: [] })); set({ selection: [], selectedFace: null, facePick: [] }) },

    undo: () => {
      const { past, shards, currentId } = get()
      const i = shards.findIndex((s) => s.id === currentId)
      if (i < 0 || !past.length) return
      const list = shards.slice()
      list[i] = past[past.length - 1]
      set({ shards: list, past: past.slice(0, -1), future: [...get().future, shards[i]], selection: [], selectedFace: null, facePick: [], notice: null })
      save(list)
    },

    redo: () => {
      const { future, shards, currentId } = get()
      const i = shards.findIndex((s) => s.id === currentId)
      if (i < 0 || !future.length) return
      const list = shards.slice()
      list[i] = future[future.length - 1]
      set({ shards: list, future: future.slice(0, -1), past: [...get().past, shards[i]], selection: [], selectedFace: null, facePick: [], notice: null })
      save(list)
    },

    exportCurrent: () => {
      const s = get().current()
      return s ? JSON.stringify(toPayload(s)) : null
    },

    importText: (text) => {
      let raw: unknown
      try { raw = JSON.parse(text) } catch { return null }
      const s = fromPayload(raw, uuid())
      if (!s) return null
      const list = [...get().shards, s]
      set({ shards: list, currentId: s.id, selection: [], selectedFace: null, facePick: [], past: [], future: [], notice: null })
      save(list)
      return s.id
    },

    importShard: (model) => {
      const taken = new Set(get().shards.map((s) => s.name))
      const name = taken.has(model.name) ? `${model.name} copy` : model.name
      const copy: ShardModel = { ...model, id: uuid(), name, vertices: model.vertices.map((v) => ({ p: [...v.p] as ShardVertex['p'], c: [...v.c] as ShardVertex['c'] })), faces: model.faces.map((f) => [...f] as [number, number, number]), updatedAt: Date.now() }
      const list = [...get().shards, copy]
      set({ shards: list }); save(list)
      return copy.id
    },

    current: () => get().shards.find((s) => s.id === get().currentId) ?? null,
  }
})

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __workshop?: unknown }).__workshop = useWorkshop
}
