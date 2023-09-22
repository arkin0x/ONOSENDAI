import { Event } from "nostr-tools"

export type Action = Event<333> & {
  kind: 333,
}

export type BigCoords = {
  x: bigint
  y: bigint
  z: bigint
  plane: "c-space" | "d-space"
}

export type Coords = {
  x: number
  y: number
  z: number
  plane: "c-space" | "d-space"
}
