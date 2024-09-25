import { UnsignedEvent } from "nostr-tools"
import { CyberspaceKinds, CyberspaceCoordinate, getTime } from "./Cyberspace"
import { CyberspaceShard, Vertex, Face } from "../store/BuilderStore"

export function createUnsignedShardEvent(shard: CyberspaceShard, pubkey: string, coordinate: CyberspaceCoordinate): UnsignedEvent {
  const { created_at, ms_padded } = getTime()

  const vertices = shard.vertices.flatMap((v: Vertex) => v.position).join(',')
  const colors = shard.vertices.flatMap((v: Vertex) => v.color).join(',')
  const indices = shard.faces.flatMap((f: Face) => f.vertices).join(',')
  
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
      ["position", `${coordinate.x.toString()},${coordinate.y.toString()},${coordinate.z.toString()}`],
      ["display", shard.display],
      ["nonce", "0000000000000000"],
    ],
    content: "",
  }

  return event
}