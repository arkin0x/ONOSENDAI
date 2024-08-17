import { Event } from 'nostr-tools'
import { Decimal } from 'decimal.js'
import { DecimalVector3 } from '../libraries/DecimalVector3'
import { Quaternion } from 'three'

// Base type for all 256-bit hex strings
type Hex256Bit = `${
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' 
  | '8' | '9' | 'a' | 'b' | 'c' | 'd' | 'e' | 'f'
}{64}`;

// Specific types for different entities
export type NostrEventId = Hex256Bit & { readonly __brand: unique symbol };
export type NostrPublicKey = Hex256Bit & { readonly __brand: unique symbol };
export type Sha256Hash = Hex256Bit & { readonly __brand: unique symbol };

export type CyberspaceAction = 
  | 'drift'
  | 'hop'
  | 'freeze'
  | 'derezz'
  | 'vortex'
  | 'bubble'
  | 'armor'
  | 'stealth'
  | 'noop'

export enum CyberspacePlane {
  DSpace = "d-space",
  ISpace = "i-space"
}
  
export type CyberspaceCoordinateRaw = Hex256Bit & { readonly __brand: unique symbol };

export type CyberspaceCoordinateFull = DecimalVector3 & { readonly __brand: unique symbol };

export type CyberspaceDimension = Decimal & { readonly __brand: 'CyberspaceDimension' };
 
// Cyberspace X/Y/Z coordinates must be reprersented by Decimal objects that can represent the truly huge values.
export type CyberspaceCoordinate = {
  raw: CyberspaceCoordinateRaw
  full: CyberspaceCoordinateFull
  x: CyberspaceDimension 
  y: CyberspaceDimension
  z: CyberspaceDimension
  plane: CyberspacePlane
}

export function factoryCyberspacePlane(value: string | number | boolean): CyberspacePlane {
  if (value === CyberspacePlane.DSpace) {
    return CyberspacePlane.DSpace
  }
  if (value === CyberspacePlane.ISpace) {
    return CyberspacePlane.ISpace
  }
  if (value == 0) {
    return CyberspacePlane.DSpace
  } else {
    return CyberspacePlane.ISpace
  }
}

export function factoryCyberspaceCoordinateRaw(value: Hex256Bit): CyberspaceCoordinateRaw {
  return value as CyberspaceCoordinateRaw
}

export function factoryCyberspaceCoordinateFull(x: Decimal | number | string, y: Decimal | number | string, z: Decimal | number | string): CyberspaceCoordinateFull {
  return new DecimalVector3(x, y, z) as CyberspaceCoordinateFull
}

export function factoryCyberspaceDimension(value: Decimal | number | string): CyberspaceDimension {
  return new Decimal(value) as CyberspaceDimension
}

export function factoryCyberspaceCoordinate(
  raw: CyberspaceCoordinateRaw, 
  x: Decimal | string | number, 
  y: Decimal | string | number, 
  z: Decimal | string | number, 
  plane: CyberspacePlane
): CyberspaceCoordinate {
  return {
    raw: factoryCyberspaceCoordinateRaw(raw),
    full: factoryCyberspaceCoordinateFull(x, y, z),
    x: factoryCyberspaceDimension(x),
    y: factoryCyberspaceDimension(y),
    z: factoryCyberspaceDimension(z),
    plane
  }
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