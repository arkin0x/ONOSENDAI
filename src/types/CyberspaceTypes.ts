import { Event } from 'nostr-tools'
import { Decimal } from 'decimal.js'
import { DecimalVector3 } from '../libraries/DecimalVector3'
import { Quaternion } from 'three'

export type Plane = "d-space" | "i-space"
 
// Cyberspace X/Y/Z coordinates must be reprersented by Decimal objects that can represent the truly huge values.
export type CyberspaceCoordinates = {
  vector: DecimalVector3
  x: Decimal
  y: Decimal
  z: Decimal 
  plane: Plane
}

// MiniatureCyberspaceCoordinates are the same as CyberspaceCoordinates but with an x/y/z that is scaled down to be smaller than Number.MAX_SAFE_INTEGER. Useful for ThreeJS, as ThreeJS can only operate on number primitives.
export type MiniatureCyberspaceCoordinates = {
  x: number,
  y: number,
  z: number,
  plane: Plane
}

export type ActionChainState = 
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'valid', genesisAction: Event, latestAction: Event};

export type MillisecondsTimestamp = number // typical JS timestamp
export type SecondsTimestamp = number // created_at seconds timestamp with no milliseconds
export type Milliseconds = number // 0 - 999
export type MillisecondsPadded = string // 000 - 999
export type Time = {
  created_at: SecondsTimestamp
  ms_timestamp: MillisecondsTimestamp
  ms_only: Milliseconds
  ms_padded: MillisecondsPadded 
}

// Presence is the current state of an Avatar derived from its most recent action chain state.
export type Presence = {
  position: DecimalVector3
  velocity: DecimalVector3
  quaternion: Quaternion
  ms_timestamp: MillisecondsTimestamp
}