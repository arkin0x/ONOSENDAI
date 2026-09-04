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
 * nudge pad, the color and DELETE act on every vertex at the selected point
 * together. What you see is one dot, and it behaves like one dot.
 *
 * Every change to the current shard goes through `edit`, which is also where
 * undo lives: the shard as it was is pushed onto a stack, redo holds what
 * undo popped, and switching shards clears both. Renaming is not an edit.
 */

import { create } from 'zustand'
import {
  GRID_HALF,
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
import { triangulate } from '../lib/triangulate'

export type Tool = 'stamp' | 'add' | 'select' | 'face'

const STORAGE = 'onosendai:shards'
const PALETTE_STORAGE = 'onosendai:palette'
/** Undo depth per shard. */
const HISTORY = 64
/** The swatches every workshop starts with. */
export const DEFAULT_PALETTE = ['#00e5ff', '#ff2323', '#52e39f', '#ffb020', '#c07dff', '#f7931a', '#ffffff', '#2f81f7']
/** Swatches the palette keeps before the oldest falls off the end. */
const PALETTE_MAX = 24
const HEX = /^#[0-9a-f]{6}$/

type P3 = [number, number, number]

export interface WorkshopState {
  shards: ShardModel[]
  currentId: string | null
  /** The workshop overlay is up. */
  open: boolean
  tool: Tool
  /** Selected vertex index; every vertex on the same point moves with it. */
  selected: number | null
  /** Corners picked so far for the next face, in order. */
  facePick: number[]
  /** The face tapped in FACE mode, an index into the shard's faces, so DELETE can take it. */
  selectedFace: number | null
  /** Swatches to hand: newest first, every color the picker ever settled on, then the defaults. */
  palette: string[]
  /** The Y the add and stamp tools place on: the grid plane moves up and down. */
  level: number
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

  openWorkshop: (id?: string) => void
  closeWorkshop: () => void
  create: (name?: string) => string
  select: (id: string | null) => void
  rename: (id: string, name: string) => void
  duplicate: (id: string) => string
  remove: (id: string) => void
  setMode: (mode: ShardMode) => void
  setUnit: (unit: number) => void
  setTool: (tool: Tool) => void
  setLevel: (level: number) => void
  setColor: (c: [number, number, number]) => void
  setStampKind: (kind: StampKind) => void
  setStampSize: (size: number) => void
  turnStamp: () => void
  setAim: (p: P3 | null) => void
  placeStamp: (at: P3) => void
  addVertex: (p: P3) => void
  /** Also drops any selected face: a point and a face are never selected together. */
  selectVertex: (index: number | null) => void
  selectFace: (index: number | null) => void
  deleteSelectedFace: () => void
  /** Put a color at the front of the palette (moving it there if it is already in). */
  rememberColor: (hex: string) => void
  forgetColor: (hex: string) => void
  moveSelected: (axis: 0 | 1 | 2, delta: number) => void
  colorSelected: (c: [number, number, number]) => void
  colorAll: (c: [number, number, number]) => void
  deleteSelected: () => void
  pickForFace: (index: number) => void
  clearFacePick: () => void
  /** Make faces from the picked corners, in order. */
  fill: () => void
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
    return Array.isArray(list) ? list.filter((s) => s && typeof s.id === 'string' && Array.isArray(s.vertices)) : []
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

function savePalette(palette: string[]): void {
  try { localStorage.setItem(PALETTE_STORAGE, JSON.stringify(palette)) } catch { /* quota or private mode */ }
}

/** Every vertex on the same point as vertex `index`, itself included. */
function group(s: ShardModel, index: number): number[] {
  const v = s.vertices[index]
  if (!v) return []
  const key = pointKey(v.p)
  const out: number[] = []
  s.vertices.forEach((o, i) => { if (pointKey(o.p) === key) out.push(i) })
  return out
}

const faceKey = (f: [number, number, number]): string => [...f].sort((a, b) => a - b).join(',')

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
    set({ shards: list, past: [...past.slice(-(HISTORY - 1)), shards[i]], future: [], notice })
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
    tool: 'stamp',
    selected: null,
    facePick: [],
    selectedFace: null,
    palette: loadPalette(),
    level: 0,
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
      set({ open: true, currentId, selected: null, selectedFace: null, facePick: [], tool: 'stamp', aim: null, past: [], future: [], notice: null })
    },

    closeWorkshop: () => set({ open: false, selected: null, selectedFace: null, facePick: [], aim: null }),

    create: (name) => {
      const s = newShard(name ?? `Shard ${get().shards.length + 1}`)
      const list = [...get().shards, s]
      set({ shards: list, currentId: s.id, selected: null, selectedFace: null, facePick: [], past: [], future: [], notice: null })
      save(list)
      return s.id
    },

    select: (id) => set({ currentId: id, selected: null, selectedFace: null, facePick: [], past: [], future: [], notice: null }),

    rename: (id, name) => {
      const list = get().shards.map((s) => (s.id === id ? { ...s, name: name.slice(0, 64), updatedAt: Date.now() } : s))
      set({ shards: list }); save(list)
    },

    duplicate: (id) => {
      const src = get().shards.find((s) => s.id === id)
      if (!src) return id
      const copy: ShardModel = { ...src, id: uuid(), name: `${src.name} copy`, vertices: src.vertices.map((v) => ({ p: [...v.p] as P3, c: [...v.c] as ShardVertex['c'] })), faces: src.faces.map((f) => [...f] as [number, number, number]), updatedAt: Date.now() }
      const list = [...get().shards, copy]
      set({ shards: list, currentId: copy.id, selected: null, selectedFace: null, facePick: [], past: [], future: [], notice: null }); save(list)
      return copy.id
    },

    remove: (id) => {
      const list = get().shards.filter((s) => s.id !== id)
      const currentId = get().currentId === id ? (list[0]?.id ?? null) : get().currentId
      set({ shards: list, currentId, selected: null, selectedFace: null, facePick: [], past: [], future: [], notice: null }); save(list)
    },

    setMode: (mode) => edit((s) => ({ ...s, mode })),
    setUnit: (unit) => edit((s) => ({ ...s, unit: Math.max(0, Math.min(84, Math.round(unit))) })),
    setTool: (tool) => set({ tool, facePick: [], selectedFace: null, aim: null }),
    setLevel: (level) => set({ level: Math.max(-GRID_HALF, Math.min(GRID_HALF, Math.round(level))) }),
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
      if (!s || !validPoint(at)) return
      const res = stamp(s, stampKind, stampSize, stampFacing, at, color)
      if (!res) { set({ notice: `No room: a shard holds up to ${MAX_VERTICES} vertices and ${MAX_FACES} faces.` }); return }
      const { mode, notice } = solidIfFirstFaces(s, res.shard)
      edit(() => ({ ...res.shard, mode }), notice)
      set({ selected: null, selectedFace: null, facePick: [] })
    },

    addVertex: (p) => {
      if (!validPoint(p)) return
      let added = -1
      edit((s) => {
        // One vertex per point by hand: adding where one already is selects it instead.
        const existing = s.vertices.findIndex((v) => pointKey(v.p) === pointKey(p))
        if (existing >= 0) { added = existing; return null }
        added = s.vertices.length
        return { ...s, vertices: [...s.vertices, { p: [...p] as P3, c: [...get().color] as ShardVertex['c'] }] }
      })
      if (added >= 0) set({ selected: added })
    },

    selectVertex: (index) => set({ selected: index, selectedFace: null }),

    selectFace: (index) => set({ selectedFace: index, selected: index === null ? get().selected : null }),

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
      const { selected } = get()
      if (selected === null) return
      edit((s) => {
        const v = s.vertices[selected]
        if (!v) return null
        const p = [...v.p] as P3
        p[axis] += delta
        if (!validPoint(p)) return null
        const vertices = s.vertices.slice()
        for (const i of group(s, selected)) vertices[i] = { ...vertices[i], p: [...p] as P3 }
        return { ...s, vertices }
      })
    },

    colorSelected: (c) => {
      const { selected } = get()
      set({ color: clampColor(c) })
      if (selected === null) return
      edit((s) => {
        if (!s.vertices[selected]) return null
        const vertices = s.vertices.slice()
        for (const i of group(s, selected)) vertices[i] = { ...vertices[i], c: clampColor(c) }
        return { ...s, vertices }
      })
    },

    colorAll: (c) => {
      set({ color: clampColor(c) })
      edit((s) => ({ ...s, vertices: s.vertices.map((v) => ({ ...v, c: clampColor(c) })) }))
    },

    deleteSelected: () => {
      const { selected } = get()
      if (selected === null) return
      edit((s) => {
        if (!s.vertices[selected]) return null
        // Every vertex on the point goes; faces that used any of them go; the rest renumber.
        const gone = new Set(group(s, selected))
        const remap = new Map<number, number>()
        s.vertices.forEach((_, i) => { if (!gone.has(i)) remap.set(i, remap.size) })
        const faces = s.faces
          .filter((f) => !f.some((i) => gone.has(i)))
          .map((f) => f.map((i) => remap.get(i) as number) as [number, number, number])
        return { ...s, vertices: s.vertices.filter((_, i) => !gone.has(i)), faces }
      })
      set({ selected: null, selectedFace: null, facePick: [] })
    },

    pickForFace: (index) => {
      const s = get().current()
      const { facePick } = get()
      if (!s || !s.vertices[index]) return
      // Picks are points, not vertices: any vertex on a picked point counts as that pick.
      const key = pointKey(s.vertices[index].p)
      const at = facePick.findIndex((i) => pointKey(s.vertices[i].p) === key)
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
      const tris = triangulate(facePick.map((i) => s.vertices[i].p))
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

    removeFace: (index) => edit((s) => (s.faces[index] ? { ...s, faces: s.faces.filter((_, i) => i !== index) } : null)),

    clearShard: () => { edit((s) => ({ ...s, vertices: [], faces: [] })); set({ selected: null, selectedFace: null, facePick: [] }) },

    undo: () => {
      const { past, shards, currentId } = get()
      const i = shards.findIndex((s) => s.id === currentId)
      if (i < 0 || !past.length) return
      const list = shards.slice()
      list[i] = past[past.length - 1]
      set({ shards: list, past: past.slice(0, -1), future: [...get().future, shards[i]], selected: null, selectedFace: null, facePick: [], notice: null })
      save(list)
    },

    redo: () => {
      const { future, shards, currentId } = get()
      const i = shards.findIndex((s) => s.id === currentId)
      if (i < 0 || !future.length) return
      const list = shards.slice()
      list[i] = future[future.length - 1]
      set({ shards: list, future: future.slice(0, -1), past: [...get().past, shards[i]], selected: null, selectedFace: null, facePick: [], notice: null })
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
      set({ shards: list, currentId: s.id, selected: null, selectedFace: null, facePick: [], past: [], future: [], notice: null })
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
