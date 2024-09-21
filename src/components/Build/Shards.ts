import { Face, CyberspaceShard, ShardDisplayTypes, Vertex } from "../../store/BuilderStore"

export interface Shard3DData {
  vertices: number[]
  colors: number[]
  indices: number[]
  position: { x: number; y: number; z: number }
  display: ShardDisplayTypes 
}

export function shardStateDataTo3DData(shardStateData: CyberspaceShard): Shard3DData {
  return {
    vertices: shardStateData.vertices.flatMap((v: Vertex) => v.position),
    colors: shardStateData.vertices.flatMap((v: Vertex) => v.color),
    indices: shardStateData.faces.flatMap((f: Face) => f.vertices),
    position: { x: 0, y: 0, z: 0 },
    display: "solid" as const,
  } as Shard3DData
}