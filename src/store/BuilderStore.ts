import create from 'zustand';
import { persist } from 'zustand/middleware';

interface Vertex {
  id: string;
  position: [number, number, number];
  color: [number, number, number];
}

interface Face {
  id: string;
  vertices: string[];
}

interface Shard {
  id: string;
  vertices: Vertex[];
  faces: Face[];
}

interface BuilderState {
  shards: Shard[];
  currentShard: Shard | null;
  gridSize: number;
  addShard: () => void;
  updateShard: (shard: Shard) => void;
  setCurrentShard: (shardId: string | null) => void;
  addVertex: (position: [number, number, number], color: [number, number, number]) => void;
  updateVertex: (id: string, position: [number, number, number], color: [number, number, number]) => void;
  addFace: (vertices: string[]) => void;
  setGridSize: (size: number) => void;
  calculateShardSize: (shard: Shard) => number;
}

export const useBuilderStore = create<BuilderState>()(
  persist(
    (set, get) => ({
      shards: [],
      currentShard: null,
      gridSize: 1,

      addShard: () => set((state) => {
        const newShard: Shard = { id: Date.now().toString(), vertices: [], faces: [] };
        return { shards: [...state.shards, newShard], currentShard: newShard };
      }),

      updateShard: (shard) => set((state) => ({
        shards: state.shards.map((s) => (s.id === shard.id ? shard : s)),
        currentShard: shard,
      })),

      setCurrentShard: (shardId) => set((state) => ({
        currentShard: state.shards.find((s) => s.id === shardId) || null,
      })),

      addVertex: (position, color) => set((state) => {
        if (!state.currentShard) return state;
        const newVertex: Vertex = { id: Date.now().toString(), position, color };
        const updatedShard = {
          ...state.currentShard,
          vertices: [...state.currentShard.vertices, newVertex],
        };
        return {
          currentShard: updatedShard,
          shards: state.shards.map((s) => (s.id === updatedShard.id ? updatedShard : s)),
        };
      }),

      updateVertex: (id, position, color) => set((state) => {
        if (!state.currentShard) return state;
        const updatedShard = {
          ...state.currentShard,
          vertices: state.currentShard.vertices.map((v) =>
            v.id === id ? { ...v, position, color } : v
          ),
        };
        return {
          currentShard: updatedShard,
          shards: state.shards.map((s) => (s.id === updatedShard.id ? updatedShard : s)),
        };
      }),

      addFace: (vertices) => set((state) => {
        if (!state.currentShard) return state;
        const newFace: Face = { id: Date.now().toString(), vertices };
        const updatedShard = {
          ...state.currentShard,
          faces: [...state.currentShard.faces, newFace],
        };
        return {
          currentShard: updatedShard,
          shards: state.shards.map((s) => (s.id === updatedShard.id ? updatedShard : s)),
        };
      }),

      setGridSize: (size) => set({ gridSize: size }),

      calculateShardSize: (shard) => {
        return shard.vertices.reduce((sum, vertex) => {
          return sum + Math.abs(vertex.position[0]) + Math.abs(vertex.position[1]) + Math.abs(vertex.position[2]);
        }, 0);
      },
    }),
    {
      name: 'builder-storage',
      getStorage: () => localStorage,
    }
  )
);