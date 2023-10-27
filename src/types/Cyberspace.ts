import { Event } from "nostr-tools"

export type Action = Event<333> & {
  kind: 333,
}

export type BigCoords = {
  x: bigint
  y: bigint
  z: bigint
  plane: "i-space" | "d-space"
}

export type Coords = {
  x: number
  y: number
  z: number
  plane: "i-space" | "d-space"
}

// GenesisAction can be one of the following values:
// - false: we have not loaded the whole chain yet, so please wait
// - true: we have loaded the whole chain and it is invalid, so we need to start over with a new genesis event. TRUE MEANS THE CHAIN IS INVALID! AND WE NEED TO START OVER.
// - Action: we have loaded the whole chain and it is valid, so this is the genesis event
export type GenesisAction = Action | boolean

// LatestAction wil be one of the following values:
// - false: we don't have any actions yet
// - Action: the most recent action in the chain
// - it won't ever be true.
export type LatestAction = Action | false