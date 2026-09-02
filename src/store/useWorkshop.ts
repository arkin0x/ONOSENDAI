/**
 * useWorkshop.ts — the shards you are building, and the one on the bench.
 *
 * Everything here is local: shards persist in localStorage until deployed,
 * and a deployed shard stays here too, so it can be deployed again somewhere
 * else or edited into a new one. The editing model is deliberately small:
 * select a vertex, nudge it a unit along an axis, colour it, join three into
 * a face. It fits a thumb, and it is exact.
 */

import { create } from 'zustand'
import {
  GRID_HALF,
  clampColor,
  newShard,
  uuid,
  validFace,
  validPoint,
  type ShardMode,
  type ShardModel,
  type ShardVertex,
} from '../lib/shards'

export type Tool = 'add' | 'select' | 'face'

const STORAGE = 'onosendai:shards'

export interface WorkshopState {
  shards: ShardModel[]
  currentId: string | null
  /** The workshop overlay is up. */
  open: boolean
  tool: Tool
  /** Selected vertex index, for moving, colouring and deleting. */
  selected: number | null
  /** Vertices picked so far for the next face. */
  facePick: number[]
  /** The Y the add tool places on: the grid plane moves up and down. */
  level: number
  /** The colour new vertices get, and the colour input shows. */
  color: [number, number, number]

  openWorkshop: (id?: string) => void
  /** Add a deep copy of a model from elsewhere (a found shard) to your Stash; returns its new id. */
  importShard: (model: ShardModel) => string
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
  addVertex: (p: [number, number, number]) => void
  selectVertex: (index: number | null) => void
  moveSelected: (axis: 0 | 1 | 2, delta: number) => void
  colorSelected: (c: [number, number, number]) => void
  colorAll: (c: [number, number, number]) => void
  deleteSelected: () => void
  pickForFace: (index: number) => void
  clearFacePick: () => void
  removeLastFace: () => void
  removeFace: (index: number) => void
  clearShard: () => void
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

export const useWorkshop = create<WorkshopState>((set, get) => {
  /** Apply an edit to the current shard, stamp it, persist. */
  const edit = (fn: (s: ShardModel) => ShardModel | null): void => {
    const { shards, currentId } = get()
    const i = shards.findIndex((s) => s.id === currentId)
    if (i < 0) return
    const next = fn(shards[i])
    if (!next) return
    const list = shards.slice()
    list[i] = { ...next, updatedAt: Date.now() }
    set({ shards: list })
    save(list)
  }

  return {
    shards: load(),
    currentId: null,
    open: false,
    tool: 'add',
    selected: null,
    facePick: [],
    level: 0,
    color: [0, 0.9, 1],

    openWorkshop: (id) => {
      const { shards } = get()
      const currentId = id ?? get().currentId ?? shards[0]?.id ?? get().create()
      set({ open: true, currentId, selected: null, facePick: [], tool: 'add' })
    },

    closeWorkshop: () => set({ open: false, selected: null, facePick: [] }),

    create: (name) => {
      const s = newShard(name ?? `Shard ${get().shards.length + 1}`)
      const list = [...get().shards, s]
      set({ shards: list, currentId: s.id, selected: null, facePick: [] })
      save(list)
      return s.id
    },

    select: (id) => set({ currentId: id, selected: null, facePick: [] }),

    rename: (id, name) => {
      const list = get().shards.map((s) => (s.id === id ? { ...s, name: name.slice(0, 64), updatedAt: Date.now() } : s))
      set({ shards: list }); save(list)
    },

    duplicate: (id) => {
      const src = get().shards.find((s) => s.id === id)
      if (!src) return id
      const copy: ShardModel = { ...src, id: uuid(), name: `${src.name} copy`, vertices: src.vertices.map((v) => ({ p: [...v.p] as ShardVertex['p'], c: [...v.c] as ShardVertex['c'] })), faces: src.faces.map((f) => [...f] as [number, number, number]), updatedAt: Date.now() }
      const list = [...get().shards, copy]
      set({ shards: list, currentId: copy.id, selected: null, facePick: [] }); save(list)
      return copy.id
    },

    importShard: (model) => {
      const taken = new Set(get().shards.map((s) => s.name))
      const name = taken.has(model.name) ? `${model.name} copy` : model.name
      const copy: ShardModel = { ...model, id: uuid(), name, vertices: model.vertices.map((v) => ({ p: [...v.p] as ShardVertex['p'], c: [...v.c] as ShardVertex['c'] })), faces: model.faces.map((f) => [...f] as [number, number, number]), updatedAt: Date.now() }
      const list = [...get().shards, copy]
      set({ shards: list }); save(list)
      return copy.id
    },

    remove: (id) => {
      const list = get().shards.filter((s) => s.id !== id)
      const currentId = get().currentId === id ? (list[0]?.id ?? null) : get().currentId
      set({ shards: list, currentId, selected: null, facePick: [] }); save(list)
    },

    setMode: (mode) => edit((s) => ({ ...s, mode })),
    setUnit: (unit) => edit((s) => ({ ...s, unit: Math.max(0, Math.min(84, Math.round(unit))) })),
    setTool: (tool) => set({ tool, facePick: [] }),
    setLevel: (level) => set({ level: Math.max(-GRID_HALF, Math.min(GRID_HALF, Math.round(level))) }),
    setColor: (c) => set({ color: clampColor(c) }),

    addVertex: (p) => {
      if (!validPoint(p)) return
      let added = -1
      edit((s) => {
        // One vertex per point: adding where one already is selects it instead.
        const existing = s.vertices.findIndex((v) => v.p[0] === p[0] && v.p[1] === p[1] && v.p[2] === p[2])
        if (existing >= 0) { added = existing; return null }
        added = s.vertices.length
        return { ...s, vertices: [...s.vertices, { p: [...p] as ShardVertex['p'], c: [...get().color] as ShardVertex['c'] }] }
      })
      if (added >= 0) set({ selected: added })
    },

    selectVertex: (index) => set({ selected: index }),

    moveSelected: (axis, delta) => {
      const { selected } = get()
      if (selected === null) return
      edit((s) => {
        const v = s.vertices[selected]
        if (!v) return null
        const p = [...v.p] as ShardVertex['p']
        p[axis] += delta
        if (!validPoint(p)) return null
        // Never two vertices on one point.
        if (s.vertices.some((o, i) => i !== selected && o.p[0] === p[0] && o.p[1] === p[1] && o.p[2] === p[2])) return null
        const vertices = s.vertices.slice()
        vertices[selected] = { ...v, p }
        return { ...s, vertices }
      })
    },

    colorSelected: (c) => {
      const { selected } = get()
      set({ color: clampColor(c) })
      if (selected === null) return
      edit((s) => {
        const vertices = s.vertices.slice()
        if (!vertices[selected]) return null
        vertices[selected] = { ...vertices[selected], c: clampColor(c) }
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
        // Faces that used it go; faces above it shift down one.
        const faces = s.faces
          .filter((f) => !f.includes(selected))
          .map((f) => f.map((i) => (i > selected ? i - 1 : i)) as [number, number, number])
        return { ...s, vertices: s.vertices.filter((_, i) => i !== selected), faces }
      })
      set({ selected: null, facePick: [] })
    },

    pickForFace: (index) => {
      const { facePick } = get()
      if (facePick.includes(index)) { set({ facePick: facePick.filter((i) => i !== index) }); return }
      const pick = [...facePick, index]
      if (pick.length < 3) { set({ facePick: pick }); return }
      const face = pick as [number, number, number]
      edit((s) => {
        if (!validFace(face, s.vertices.length)) return null
        // The same three vertices in any order is the same face.
        const key = [...face].sort().join(',')
        if (s.faces.some((f) => [...f].sort().join(',') === key)) return null
        return { ...s, faces: [...s.faces, face] }
      })
      set({ facePick: [] })
    },

    clearFacePick: () => set({ facePick: [] }),

    removeLastFace: () => edit((s) => (s.faces.length ? { ...s, faces: s.faces.slice(0, -1) } : null)),

    removeFace: (index) => edit((s) => (s.faces[index] ? { ...s, faces: s.faces.filter((_, i) => i !== index) } : null)),

    clearShard: () => { edit((s) => ({ ...s, vertices: [], faces: [] })); set({ selected: null, facePick: [] }) },

    current: () => get().shards.find((s) => s.id === get().currentId) ?? null,
  }
})

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __workshop?: unknown }).__workshop = useWorkshop
}
