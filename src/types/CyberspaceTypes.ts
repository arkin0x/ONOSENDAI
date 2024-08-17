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

// CYBERSPACE

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


// COORDINATES

export enum CyberspacePlane {
  DSpace = "d-space",
  ISpace = "i-space"
}
  
export type CyberspaceCoordinateRaw = Hex256Bit & { readonly __brand: unique symbol };

export type CyberspaceCoordinateFull = DecimalVector3 & { readonly __brand: unique symbol };

export type CyberspaceCoordinateDimension = Decimal & { readonly __brand: 'CyberspaceDimension' };
 
// Cyberspace X/Y/Z coordinates must be reprersented by Decimal objects that can represent the truly huge values.
export type CyberspaceCoordinate = {
  raw: CyberspaceCoordinateRaw
  full: CyberspaceCoordinateFull
  x: CyberspaceCoordinateDimension 
  y: CyberspaceCoordinateDimension
  z: CyberspaceCoordinateDimension
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

export function factoryCyberspaceDimension(value: Decimal | number | string): CyberspaceCoordinateDimension {
  return new Decimal(value) as CyberspaceCoordinateDimension
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

// SECTORS
// TODO - a sector should contain the Plane as well???

// For the string representation of a sector ID
export type CyberspaceSectorId = string & { readonly __brand: 'CyberspaceSectorId' };

// For the vector representation of a sector's indices
export type CyberspaceSectorFull = DecimalVector3 & { readonly __brand: 'CyberspaceSectorVector' };

// For individual sector indices(x, y, or z of a sector ID). It's the index of the sector on the axis.
export type CyberspaceSectorIndex = Decimal & { readonly __brand: 'CyberspaceSectorIndex' };

export type CyberspaceSector = {
  id: CyberspaceSectorId
  full: CyberspaceSectorFull
  x: CyberspaceSectorIndex
  y: CyberspaceSectorIndex
  z: CyberspaceSectorIndex
}

// Factory functions
export function createCyberspaceSectorId(id: string): CyberspaceSectorId {
  if (!/^\d+-\d+-\d+$/.test(id)) {
    throw new Error('Invalid sector ID format');
  }
  return id as CyberspaceSectorId;
}

export function createCyberspaceSectorIndex(value: number | string | Decimal): CyberspaceSectorIndex {
  return new Decimal(value) as CyberspaceSectorIndex;
}

export function createCyberspaceSectorVector(x: number | string | Decimal, y: number | string | Decimal, z: number | string | Decimal): CyberspaceSectorVector {
  return new DecimalVector3(
    createCyberspaceSectorIndex(x),
    createCyberspaceSectorIndex(y),
    createCyberspaceSectorIndex(z)
  ) as CyberspaceSectorVector;
}

// Utility functions
export function splitCyberspaceSectorId(sectorId: CyberspaceSectorId): CyberspaceSectorIndices {
  const [x, y, z] = sectorId.split('-');
  return {
    x: createCyberspaceSectorIndex(x),
    y: createCyberspaceSectorIndex(y),
    z: createCyberspaceSectorIndex(z)
  };
}

export function cyberspaceSectorToVector(sectorId: CyberspaceSectorId): CyberspaceSectorVector {
  const { x, y, z } = splitCyberspaceSectorId(sectorId);
  return createCyberspaceSectorVector(x, y, z);
}

// Function to convert a sector to a CyberspaceCoordinate
export function sectorToCyberspaceCoordinate(sectorId: CyberspaceSectorId, plane: Plane): CyberspaceCoordinate {
  const sectorVector = cyberspaceSectorToVector(sectorId);
  const sectorSize = new Decimal(2).pow(30); // Assuming sectors are 2^30 in size
  
  const x = sectorVector.x.mul(sectorSize);
  const y = sectorVector.y.mul(sectorSize);
  const z = sectorVector.z.mul(sectorSize);
  
  // Here you would need to implement the logic to convert the sector corner to a raw hex coordinate
  const rawHex = convertToRawHex(x, y, z); // This function needs to be implemented
  
  return createCyberspaceCoordinate(
    rawHex,
    createCyberspaceDimension(x),
    createCyberspaceDimension(y),
    createCyberspaceDimension(z),
    plane
  );
}

// // // // //

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