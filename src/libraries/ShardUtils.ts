import { UnsignedEvent } from "nostr-tools"
import { CyberspaceKinds, CyberspaceCoordinate, getTime } from "./Cyberspace"
import { CyberspaceShard, Vertex, Face } from "../store/BuilderStore"

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