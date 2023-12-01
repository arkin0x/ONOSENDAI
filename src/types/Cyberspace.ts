import { Event } from 'nostr-tools'
import { Decimal } from 'decimal.js'

export type Action = Event<333> & {
  kind: 333,
}
 
// Cyberspace X/Y/Z coordinates must be reprersented by Decimal objects that can represent the truly huge values.
export type CyberspaceCoordinates = {
  x: Decimal
  y: Decimal
  z: Decimal 
  plane: "i-space" | "d-space"
}

// MiniatureCyberspaceCoordinates are the same as CyberspaceCoordinates but with an x/y/z that is scaled down to be smaller than Number.MAX_SAFE_INTEGER. Useful for ThreeJS, as ThreeJS can only operate on number primitives.
export type MiniatureCyberspaceCoordinates = {
  x: number,
  y: number,
  z: number,
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