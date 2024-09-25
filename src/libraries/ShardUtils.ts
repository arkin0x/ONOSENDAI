import { UnsignedEvent } from "nostr-tools"
import { CyberspaceKinds, CyberspaceCoordinate, getTime } from "./Cyberspace"
import { CyberspaceShard, Vertex, Face } from "../store/BuilderStore"
import { Event } from 'nostr-tools'
import { Shard3DData } from '../components/Build/Shards'


export function createUnsignedShardEvent(shard: CyberspaceShard, pubkey: string, coordinate: CyberspaceCoordinate): UnsignedEvent {
  const { created_at, ms_padded } = getTime()

  const limitDecimals = (n: number) => parseFloat(n.toFixed(8)).toString();

  const vertices = shard.vertices.flatMap((v: Vertex) => v.position).map(limitDecimals).join(',')
  const colors = shard.vertices.flatMap((v: Vertex) => v.color).map(limitDecimals).join(',')
  const indices = shard.faces.flatMap((f: Face) => f.vertices).map(limitDecimals).join(',')
  
  const event: UnsignedEvent = {
    kind: CyberspaceKinds.Shard,
    pubkey,
    created_at,
    tags: [
      ["C", coordinate.raw],
      ["Cd", "0", "0", "0"], // Assuming the shard is placed at the exact coordinate
      ["S", coordinate.sector.id],
      ["ms", ms_padded],
      ["version", "1"],
      ["vertices", vertices],
      ["colors", colors],
      ["indices", indices],
      ["position", `${coordinate.local.x.toString()},${coordinate.local.y.toString()},${coordinate.local.z.toString()}`],
      ["display", shard.display],
      ["nonce", "0000000000000000"],
    ],
    content: "",
  }

  return event
}

export function parseShard3DDataFromEvent(event: Event): Shard3DData | null {
  try {
    const vertices = event.tags.find(tag => tag[0] === 'vertices')?.[1].split(',').map(Number)
    const colors = event.tags.find(tag => tag[0] === 'colors')?.[1].split(',').map(Number)
    const indices = event.tags.find(tag => tag[0] === 'indices')?.[1].split(',').map(Number)
    const position = event.tags.find(tag => tag[0] === 'position')?.[1].split(',').map(Number)
    const display = event.tags.find(tag => tag[0] === 'display')?.[1]

    if (!vertices || !colors || !indices || !position || !display) {
      throw new Error('Missing required shard data')
    }

    return {
      vertices,
      colors,
      indices,
      position: { x: position[0], y: position[1], z: position[2] },
      display: display as "solid" | "wireframe" | "points"
    }
  } catch (error) {
    console.error('Error parsing shard data:', error)
    return null
  }
}