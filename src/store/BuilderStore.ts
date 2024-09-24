import create from 'zustand'
import { persist } from 'zustand/middleware'

export interface Vertex {
  id: string
  position: [number, number, number]
  color: [number, number, number]
}

export interface Face {
  id: string
  vertices: number[] 
}

export type ShardDisplayTypes = "solid" | "wireframe" | "points"

export interface CyberspaceShard {
  id: string
  vertices: Vertex[]
  faces: Face[]
  gridSize: number
  display: ShardDisplayTypes
}

interface BuilderState {
  shards: CyberspaceShard[]
  shardIndex: number | null
  gridSize: number
  addShard: () => void
  updateShard: (shard: CyberspaceShard) => void
  setCurrentShard: (shardId: string | null) => void
  addVertex: (position: [number, number, number], color: [number, number, number]) => void
  updateVertex: (id: string, position: [number, number, number], color: [number, number, number]) => void
  removeVertex: (id: string) => void
  addFace: (vertices: string[]) => void
  setGridSize: (size: number) => void
  calculateShardSize: (shard: CyberspaceShard) => number
}

export const useBuilderStore = create<BuilderState>()(
  persist(
    (set, get) => ({
      shards: [],
      shardIndex: null,
      gridSize: 3,

      addShard: () => set((state) => {
        const newShard: CyberspaceShard = { id: Date.now().toString(), vertices: [], faces: [], gridSize: 3, display: "solid" }
        return { shards: [...state.shards, newShard], shardIndex: state.shards.length }
      }),

      updateShard: (shard) => set((state) => ({
        shards: state.shards.map((s) => (s.id === shard.id ? shard : s)),
      })),

      setCurrentShard: (shardId) => set((state) => {
        const shardIndex = state.shards.findIndex((s) => s.id === shardId);
        return { shardIndex: shardIndex !== -1 ? shardIndex : null };
      }),

      addVertex: (position, color) => set((state) => {
        if (!state.shardIndex) return state
        const newVertex: Vertex = { id: Date.now().toString(), position, color }
        const updatedShard = {
          ...state.shards[state.shardIndex],
          vertices: [...state.shards[state.shardIndex].vertices, newVertex],
        }
        return {
          shardIndex: state.shardIndex,
          shards: state.shards.map((s) => (s.id === updatedShard.id ? updatedShard : s)),
        }
      }),

      updateVertex: (id, position, color) => set((state) => {
        if (!state.shardIndex) return state
        const updatedShard = {
          ...state.shards[state.shardIndex],
          vertices: state.shards[state.shardIndex].vertices.map((v) =>
            v.id === id ? { ...v, position, color } : v
          ),
        }
        return {
          shardIndex: state.shardIndex,
          shards: state.shards.map((s) => (s.id === updatedShard.id ? updatedShard : s)),
        }
      }),

      removeVertex: (id) => set((state) => {
        if (!state.shardIndex) return state
        const shard = state.shards[state.shardIndex]
        const vertexIndex = shard.vertices.findIndex((v) => v.id === id);

        if (vertexIndex === -1) return state;

        console.log('Removing vertex', vertexIndex)

        const facesToRemove: number[] = []

        for (let i = 0; i < shard.faces.length; i++) {
          const vertexInFace = shard.faces[i].vertices.indexOf(vertexIndex)
          if (vertexInFace > -1) {
            // remove whole face
            facesToRemove.push(i)
          }
        }

        console.log('Removing faces:', facesToRemove)

        const remainingFaces = shard.faces.filter((_, i) => !facesToRemove.includes(i));

        console.log(shard.faces, remainingFaces)

        const updatedShard = {
          ...shard,
          vertices: shard.vertices.filter((v) => v.id !== id),
          faces: remainingFaces,
        }
        return {
          shardIndex: state.shardIndex,
          shards: state.shards.map((s) => (s.id === updatedShard.id ? updatedShard : s)),
        }
      }),

      addFace: (vertexIds) => set((state) => {
        if (state.shardIndex === null) return state

        // Convert vertex IDs to indices
        const vertexIndices = vertexIds.map(id => {
          if (state.shardIndex === null) throw new Error('currentShard is null')
          const index = state.shards[state.shardIndex].vertices.findIndex(v => v.id === id)
          if (index === -1) {
            throw new Error(`Vertex ID ${id} not found in vertices array`)
          }
          return index
        })

        const newFace: Face = { id: Date.now().toString(), vertices: vertexIndices }
        const updatedShard = {
          ...state.shards[state.shardIndex],
          faces: [...state.shards[state.shardIndex].faces, newFace],
        }
        return {
          shardIndex: state.shardIndex,
          shards: state.shards.map((s) => (s.id === updatedShard.id ? updatedShard : s)),
        }
      }),

      setGridSize: (size) => set((state) => {
        if (!state.shardIndex) return state
        const updatedShard = {
          ...state.shards[state.shardIndex],
          gridSize: size,
        }
        return {
          shardIndex: state.shardIndex,
          shards: state.shards.map((s) => (s.id === updatedShard.id ? updatedShard : s)),
          gridSize: size
        }
      }),

      calculateShardSize: (shard) => {
        return shard.vertices.reduce((sum, vertex) => {
          return sum + Math.abs(vertex.position[0]) + Math.abs(vertex.position[1]) + Math.abs(vertex.position[2])
        }, 0)
      },
    }),
    {
      name: 'builder-storage',
      getStorage: () => localStorage,
    }
  )
)