import { Quaternion } from "three"
import { Decimal } from 'decimal.js'
import { DecimalVector3 } from "./DecimalVector3"
import { getTag, getTagValue } from "./Nostr"
import type { Event, UnsignedEvent } from "nostr-tools"
import { countLeadingZeroesHex } from "./Hash"

// CONSTANTS

export const CYBERSPACE_AXIS = new Decimal(2).pow(85)
export const CYBERSPACE_SECTOR = new Decimal(2).pow(30)
export const CYBERSPACE_SECTORS_PER_AXIS = CYBERSPACE_AXIS.div(CYBERSPACE_SECTOR) // 2^55 sectors per axis

// Avatar velocity Math.POW(2,-10) and below is rounded to zero.
export const ZERO_VELOCITY = 0.0009765625 

// center coordinates
export const CENTERCOORD_DSPACE = "1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe"
export const CENTERCOORD_ISPACE = "1fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
export const CENTERCOORD_BINARY_DSPACE = "0b0001111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111110"
export const CENTERCOORD_BINARY_ISPACE = "0b0001111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111"

// quanta of time
export const FRAME = 1000 / 60 // milliseconds. Each frame is 1/60th of a second

// precision for fractional position
export const FRACTIONAL_PRECISION = 100_000_000 // 8 decimal places for Avatar position precision in "Cd" tag.

export const IDENTITY_QUATERNION = [0, 0, 0, 1] // mostly so I don't forget

// TYPES

// Base type for all 256-bit hex strings
type Hex256Bit = `${
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' 
  | '8' | '9' | 'a' | 'b' | 'c' | 'd' | 'e' | 'f'
}{64}`

// Factory function to create a Hex256Bit from a string
function factoryHex256Bit(hex: string): Hex256Bit {
  // Check if the input string is exactly 64 hex characters
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('Invalid Hex256Bit string: must be exactly 64 hex characters')
  }
  // Return the string as Hex256Bit
  return hex.toLowerCase() as Hex256Bit
}

// Specific types for different entities
export type NostrEventId = Hex256Bit & { readonly __brand: unique symbol }
export type NostrPublicKey = Hex256Bit & { readonly __brand: unique symbol }
export type Sha256Hash = Hex256Bit & { readonly __brand: unique symbol }

// CYBERSPACE

// NOSTR KINDS
export enum CyberspaceKinds {
  Hyperjump = 321,
  Construct = 331,
  Action = 333
}

// COORDINATES
// A Cyberspace coordinate is either a raw hex coordinate or a coordinate object including the raw hex, vector, individual dimensions, and plane.

export type CyberspaceCoordinateRaw = Hex256Bit & { readonly __brand: unique symbol }

// a global coordinate
export type CyberspaceCoordinate = {
  raw: CyberspaceCoordinateRaw
  vector: CyberspaceCoordinateVector
  x: CyberspaceCoordinateDimension 
  y: CyberspaceCoordinateDimension
  z: CyberspaceCoordinateDimension
  local: CyberspaceLocalCoordinate
  plane: CyberspacePlane
  sector: CyberspaceSector
}

// partial type to express a single dimension of a global coordinate
export type CyberspaceCoordinateDimension = Decimal & { readonly __brand: unique symbol }

// partial type to express a vector of dimensions as global coordinates
export type CyberspaceCoordinateVector = DecimalVector3 & { readonly __brand: unique symbol }

// a local coordinate within the current sector
export type CyberspaceLocalCoordinate = {
  raw: CyberspaceCoordinateRaw // still global
  vector: CyberspaceLocalCoordinateVector
  x: CyberspaceLocalCoordinateDimension
  y: CyberspaceLocalCoordinateDimension
  z: CyberspaceLocalCoordinateDimension
  plane: CyberspacePlane
  sector: CyberspaceSector
}

// partial type to differentiate between local coordinates and global coordinates
export type CyberspaceLocalCoordinateDimension = Decimal & { readonly __brand: unique symbol }

// partial type to differenctiate between local coordinates and global coordinates
export type CyberspaceLocalCoordinateVector = DecimalVector3 & { readonly __brand: unique symbol }

// partial type to express a plane in cyberspace
export enum CyberspacePlane {
  DSpace = "d-space",
  ISpace = "i-space"
}

// Usage functions

// Takes a hex string and returns a CyberspaceCoordinate object
export function integerCyberspaceCoordinateFromString(coordinateString: string): CyberspaceCoordinate {
  const hex = factoryHex256Bit(coordinateString)
  return factoryCyberspaceCoordinate(hex as CyberspaceCoordinateRaw) as CyberspaceCoordinate
}

// Takes a hex string and a decimal axes array and returns a CyberspaceCoordinate object with decimal precision
export function decimalCyberspaceCoordinateFromStrings(coordinateString: string, decimalAxes: string[]): CyberspaceCoordinate {
  const hex = factoryHex256Bit(coordinateString)
  return factoryCyberspaceCoordinate(hex as CyberspaceCoordinateRaw, decimalAxes) as CyberspaceCoordinate
}

// Takes a vector and a plane and returns a 256-bit hex string
// This is used when simulating a position and converting the new position to a coordinate hex string.
// "Partial" here refers to the separated vector and plane as opposed to the full coordinate object.
export function cyberspaceEncodePartialToRaw(vector: CyberspaceCoordinateVector, plane: CyberspacePlane): CyberspaceCoordinateRaw {
    const X = vector.x.floor()
    const Y = vector.y.floor()
    const Z = vector.z.floor()

    // Convert to binary strings, ensuring 85 bits for each coordinate
    const binaryX = X.toBinary().slice(2).padStart(85, '0')
    const binaryY = Y.toBinary().slice(2).padStart(85, '0')
    const binaryZ = Z.toBinary().slice(2).padStart(85, '0')

    // Interleave the binary strings
    let binaryString = ''
    for (let i = 0; i < 85; i++) {
        binaryString += binaryX[i] + binaryY[i] + binaryZ[i]
    }

    // Add the plane bit
    binaryString += cyberspacePlaneToBin(plane) 

    // Convert binary string to hexadecimal
    let hexString = ''
    for (let i = 0; i < 256; i += 4) {
        const chunk = binaryString.slice(i, i + 4)
        hexString += parseInt(chunk, 2).toString(16)
    }

    return factoryHex256Bit(hexString) as CyberspaceCoordinateRaw
}

// Utility functions

export function cyberspacePlaneToBin(plane: CyberspacePlane): number {
  return plane === CyberspacePlane.DSpace ? 0 : 1
}

// Behind-the-scenes Factory functions

function factoryCyberspacePlane(value: string | number | boolean): CyberspacePlane {
  if (typeof value === 'string') {
    if (value.toLowerCase() === CyberspacePlane.DSpace) {
      return CyberspacePlane.DSpace
    }
    if (value.toLowerCase() === CyberspacePlane.ISpace) {
      return CyberspacePlane.ISpace
    }
    if (value === 'dspace' || value === 'd') {
      return CyberspacePlane.DSpace
    }
    if (value === 'ispace' || value === 'i') {
      return CyberspacePlane.ISpace
    }
    throw new Error('Invalid CyberspacePlane string')
  }
  if (value == 0) {
    return CyberspacePlane.DSpace
  } else {
    // note: any non-zero value will return ISpace
    return CyberspacePlane.ISpace
  }
}

function factoryCyberspaceCoordinateVector(x: Decimal | number | string, y: Decimal | number | string, z: Decimal | number | string): CyberspaceCoordinateVector {
  return new DecimalVector3(x, y, z) as CyberspaceCoordinateVector
}

function factoryCyberspaceLocalCoordinateVector(x: Decimal | number | string, y: Decimal | number | string, z: Decimal | number | string): CyberspaceLocalCoordinateVector {
  return new DecimalVector3(x, y, z) as CyberspaceLocalCoordinateVector
}

function factoryCyberspaceDimension(value: Decimal | number | string): CyberspaceCoordinateDimension {
  return new Decimal(value) as CyberspaceCoordinateDimension
}

function factoryCyberspaceLocalCoordinateDimension(value: Decimal | number | string): CyberspaceLocalCoordinateDimension {
  return new Decimal(value) as CyberspaceLocalCoordinateDimension
}

/**
 * Parse a raw hex coordinate into a CyberspaceCoordinate object, optionally adding the decimal axes if provided.
 * @param coordinateRaw CyberspaceCoordinateRaw
 * @param decimalAxes the full decimal tag, ie ["Cd", "00000000", "00000000", "00000000"]
 * @returns CyberspaceCoordinate
 */
function factoryCyberspaceCoordinate(coordinateRaw: CyberspaceCoordinateRaw, decimalAxes?: string[]): CyberspaceCoordinate {
  const hex = factoryHex256Bit(coordinateRaw)
  // Convert hex string to binary
  const binaryString = BigInt("0x" + hex).toString(2).padStart(256, '0')
  const plane = binaryString[255] === '0' ? CyberspacePlane.DSpace : CyberspacePlane.ISpace
  // Initialize the dimensions 
  let X = BigInt(0)
  let Y = BigInt(0)
  let Z = BigInt(0)
  // Traverse through the binary string
  for (let i = 0; i < 255; i++) {
    switch (i % 3) {
      case 0:
        X = (X << BigInt(1)) | BigInt(parseInt(binaryString[i]))
        break
      case 1:
        Y = (Y << BigInt(1)) | BigInt(parseInt(binaryString[i]))
        break
      case 2:
        Z = (Z << BigInt(1)) | BigInt(parseInt(binaryString[i]))
        break
    }
  }
  // Convert BigInts to Decimal objects
  let dimensionX = new Decimal(X.toString())
  let dimensionY = new Decimal(Y.toString())
  let dimensionZ = new Decimal(Z.toString())

  // Parse the decimal axes if provided & valid
  if (decimalAxes && decimalAxes.length === 4) {
    const decimals = decimalAxes.slice(1,4).map(v => parseInt(v))
    if (!decimals.some(v => isNaN(v))) {
      dimensionX = dimensionX.add((new Decimal(decimals[0])).div(FRACTIONAL_PRECISION))
      dimensionY = dimensionY.add((new Decimal(decimals[1])).div(FRACTIONAL_PRECISION))
      dimensionZ = dimensionZ.add((new Decimal(decimals[2])).div(FRACTIONAL_PRECISION))
    }
  }

  const vector = factoryCyberspaceCoordinateVector(dimensionX, dimensionY, dimensionZ)
  const localVector = factoryCyberspaceLocalCoordinateVector(dimensionX.mod(CYBERSPACE_SECTOR), dimensionY.mod(CYBERSPACE_SECTOR), dimensionZ.mod(CYBERSPACE_SECTOR))
  const sector = cyberspaceSectorFromCoordinateVector(vector)
  return {
    raw: hex as CyberspaceCoordinateRaw,
    vector,
    x: factoryCyberspaceDimension(dimensionX),
    y: factoryCyberspaceDimension(dimensionY),
    z: factoryCyberspaceDimension(dimensionZ),
    local: {
      raw: hex as CyberspaceCoordinateRaw,
      vector: localVector,
      x: factoryCyberspaceLocalCoordinateDimension(localVector.x),
      y: factoryCyberspaceLocalCoordinateDimension(localVector.y),
      z: factoryCyberspaceLocalCoordinateDimension(localVector.z),
    } as CyberspaceLocalCoordinate,
    plane,
    sector,
  } as CyberspaceCoordinate
}

// SECTORS
// A sector is either a string representation of its indices or a full sector object including the raw string, vector, and indices.

export type CyberspaceSectorRaw = string & { readonly __brand: 'CyberspaceSectorId' }

export type CyberspaceSector = {
  id: CyberspaceSectorRaw
  vector: CyberspaceSectorVector
  x: CyberspaceSectorIndex
  y: CyberspaceSectorIndex
  z: CyberspaceSectorIndex
  corner: CyberspaceCoordinateVector
  center: CyberspaceCoordinateVector
}

// partial type for individual sector indices(x, y, or z of a sector ID). It's the index of the sector on the axis.
type CyberspaceSectorIndex = Decimal & { readonly __brand: 'CyberspaceSectorIndex' }

// partial type for the vector representation of a sector's indices
type CyberspaceSectorVector = DecimalVector3 & { readonly __brand: 'CyberspaceSectorVector' }

// Usage functions
export function cyberspaceSectorStringToRaw(sectorString: string): CyberspaceSectorRaw {
  return factoryCyberspaceSectorRaw(sectorString)
}

export function cyberspaceSectorStringToObject(sectorString: string): CyberspaceSector {
  const sectorId: CyberspaceSectorRaw = cyberspaceSectorStringToRaw(sectorString)
  return factoryCyberspaceSector(sectorId)
}

// Utility functions
export function cyberspaceSectorIdToVector(sectorId: CyberspaceSectorRaw): CyberspaceSectorVector {
  const [x, y, z] = sectorId.split('-')
  return factoryCyberspaceSectorVector(x, y, z)
}

export function cyberspaceSectorFromCoordinateVector(vector: CyberspaceCoordinateVector): CyberspaceSector {
  const x = vector.x.div(CYBERSPACE_SECTOR).floor().toString()
  const y = vector.y.div(CYBERSPACE_SECTOR).floor().toString()
  const z = vector.z.div(CYBERSPACE_SECTOR).floor().toString()
  const sectorId = factoryCyberspaceSectorRaw(`${x}-${y}-${z}`)
  const sector = factoryCyberspaceSector(sectorId)
  return sector
}

// Behind-the-scenes Factory functions
function factoryCyberspaceSectorRaw(id: string): CyberspaceSectorRaw {
  if (!/^\d+-\d+-\d+$/.test(id)) {
    throw new Error('Invalid sector ID format')
  }
  return id as CyberspaceSectorRaw
}

function factoryCyberspaceSector(id: CyberspaceSectorRaw): CyberspaceSector {
  const vector = cyberspaceSectorIdToVector(id)

  // The lowest coordinate corner of the sector cube.
  const cornerVector = factoryCyberspaceCoordinateVector(vector.x.mul(CYBERSPACE_SECTOR), vector.y.mul(CYBERSPACE_SECTOR), vector.z.mul(CYBERSPACE_SECTOR)) as CyberspaceCoordinateVector

  // The center of the sector is calculated by multiplying the sector index by the size of the sector and adding half of the sector size. This center will be used to downscale and display the sector in the Map UI, so it doesn't need to be rounded even though it may have a fractional Gibson.
  const centerVector = factoryCyberspaceCoordinateVector(cornerVector.x.add(CYBERSPACE_SECTOR.div(2)), cornerVector.y.add(CYBERSPACE_SECTOR.div(2)), cornerVector.z.add(CYBERSPACE_SECTOR.div(2))) as CyberspaceCoordinateVector

  return {
    id,
    vector,
    x: factoryCyberspaceSectorIndex(vector.x),
    y: factoryCyberspaceSectorIndex(vector.y),
    z: factoryCyberspaceSectorIndex(vector.z),
    corner: cornerVector,
    center: centerVector
  } as CyberspaceSector
}

function factoryCyberspaceSectorIndex(value: number | string | Decimal): CyberspaceSectorIndex {
  return new Decimal(value) as CyberspaceSectorIndex
}

function factoryCyberspaceSectorVector(x: number | string | Decimal, y: number | string | Decimal, z: number | string | Decimal): CyberspaceSectorVector {
  return new DecimalVector3(
    factoryCyberspaceSectorIndex(x),
    factoryCyberspaceSectorIndex(y),
    factoryCyberspaceSectorIndex(z)
  ) as CyberspaceSectorVector
}

// VELOCITY

export type CyberspaceVelocity = DecimalVector3 & { readonly __brand: unique symbol }

// TIME

export type SecondsTimestamp = number & { readonly __brand: unique symbol } // created_at seconds timestamp with no milliseconds
export type MillisecondsTimestamp = number & { readonly __brand: unique symbol } // typical JS timestamp
export type Milliseconds = number & { readonly __brand: unique symbol } // 0 - 999
export type MillisecondsPadded = string & { readonly __brand: unique symbol } // "000" - "999"
export type Time = {
  created_at: SecondsTimestamp
  ms_timestamp: MillisecondsTimestamp
  ms_only: Milliseconds
  ms_padded: MillisecondsPadded 
}

export const getMillisecondsTimestampFromAction = (action: CyberspaceAction): MillisecondsTimestamp => {
  return action.created_at * 1000 + parseInt(action.tags.find(getTag('ms'))![1]) as MillisecondsTimestamp
}

export const getTime = (action?: CyberspaceAction): Time => {
  let now
  if (action) {
    now = new Date(getMillisecondsTimestampFromAction(action))
  } else {
    now = new Date()
  }
  const created_at = Math.floor( (+now) / 1000) as SecondsTimestamp
  const ms_timestamp = +now as MillisecondsTimestamp
  const ms_only = now.getMilliseconds() as Milliseconds
  const ms_padded = now.getMilliseconds().toString().padStart(3, '0') as MillisecondsPadded
  return {created_at, ms_timestamp, ms_only, ms_padded}
}

export const nowIsAfterLatestAction = (latestAction: CyberspaceAction): boolean => {
  const now = getTime()
  const latestActionTimestamp = getMillisecondsTimestampFromAction(latestAction)
  if (latestActionTimestamp >= now.ms_timestamp) {
    // not sure how this happens
    return false
  }
  return true
}


// ACTIONS

// CyberspaceAction is a validated Event or valid UnsignedEvent. Its tags will be valid.
export type CyberspaceAction = Event & { readonly __brand: unique symbol}

export function validateCyberspaceAction(action: Event): CyberspaceAction|false {
  if (action.kind !== CyberspaceKinds.Action) {
    return false
  }
  const tagsToCheck = ['ms', 'C', 'Cd', 'quaternion', 'velocity', 'S', 'A', 'nonce', 'version']

  // stipulations for each tag
  // ms must be a 2-element array where the second element is a 3-digit string
  // C must be a 64-character hex string
  // Cd must be a 4-element array where the second thru fourth elements are 
    // integer strings each a maximum of 8 digits long
  // quaternion must be a 4-element array where the second thru fourth elements 
    // are floating point number strings with a maximum of 8 decimal places
  // velocity must be a 4-element array where the second thru fourth elements
    // are floating point number strings with a maximum of 8 decimal places
  // S must be a 2-element array where the second element is a sector id in the
    // form "x-y-z" where x, y, and z are integers with no leading zeros
  // nonce must be a 3-element array where the second element is a string and
    // the third element is an integer string
  // version must be a 2-element array where the second element is the string "1"

  for (const tag of tagsToCheck) {
    const tagItem = action.tags.find(getTag(tag))
    if (!tagItem) {
      return false
    }

    switch (tag) {
      case 'ms':
        if (!Array.isArray(tagItem) || tagItem.length !== 2 || !/^\d{3}$/.test(tagItem[1])) {
          return false
        }
        break
      case 'C':
        if (!Array.isArray(tagItem) || tagItem.length !== 2 || !/^[a-fA-F0-9]{64}$/.test(tagItem[1])) {
          return false
        }
        break
      case 'Cd':
        if (!Array.isArray(tagItem) || tagItem.length !== 4 || !tagItem.slice(1, 4).every(v => /^\d{1,8}$/.test(v))) {
          return false
        }
        break
      case 'quaternion':
      case 'velocity':
        if (!Array.isArray(tagItem) || tagItem.length !== 4 || !tagItem.slice(1, 4).every(v => /^\d+\.\d{1,8}$/.test(v))) {
          return false
        }
        break
      case 'S':
        if (!Array.isArray(tagItem) || tagItem.length !== 2 || !/^\d+-\d+-\d+$/.test(tagItem[1])) {
          return false
        }
        break
      case 'nonce':
        if (!Array.isArray(tagItem) || tagItem.length !== 3 || !/^\d+$/.test(tagItem[2])) {
          return false
        }
        break
      case 'version':
        if (!Array.isArray(tagItem) || tagItem.length !== 2 || tagItem[1] !== '1') {
          return false
        }
        break
      default:
        break
    }

  }
  
  // TODO: ...? what else should we validate here?
  // NDK should handle signature checking already

  return action as CyberspaceAction
}

export type CyberspaceActionTypes = 
  | 'drift'
  | 'hop'
  | 'freeze'
  | 'derezz'
  | 'vortex'
  | 'bubble'
  | 'armor'
  | 'stealth'
  | 'noop'

export const createUnsignedGenesisAction = (pubkey: string): UnsignedEvent => {
  const {created_at, ms_padded} = getTime()
  const coordinate = integerCyberspaceCoordinateFromString(pubkey)
  const sector = coordinate.sector
  const sectorId = sector.id
  return {
    pubkey, 
    kind: 333,
    created_at,
    content: '',
    tags: [
      ['C', pubkey],
      ['S', sectorId],
      ['ms', ms_padded],
      ['velocity', '0', '0', '0'],
      ['quaternion', ...IDENTITY_QUATERNION.map(n => n.toString())],
      ['A', 'noop'],
      ['version', '1'],
    ]
  } as UnsignedEvent
}

export const createUnsignedDriftAction = async (pubkey: string, throttle: number, _quaternion: Quaternion, genesisAction: CyberspaceAction, latestAction: CyberspaceAction): Promise<UnsignedEvent> => {
  const time = getTime()
  const newAction = simulateNextEvent(latestAction, time)
  if (newAction === undefined) {
    // This shouldn't happen because the action chain needs to be valid to get to this point.
    throw new Error("Simulation failed for latest event.")
  }
  newAction.pubkey = pubkey
  newAction.tags.push(['A', 'drift'])
  newAction.tags.push(['quaternion', ..._quaternion.toArray().map(n => n.toFixed(8))])
  newAction.tags.push(['e', genesisAction.id, '', 'genesis'])
  newAction.tags.push(['e', latestAction.id, '', 'previous'])
  newAction.tags.push(['nonce', '0000000000000000', throttle.toString()])
  return newAction as UnsignedEvent
}

export const isGenesisAction = (action: Event): boolean => {
  const hasPubkeyCoordinate = action.pubkey === action.tags.find(tag => tag[0] === 'C')![1] 
  const hasNoETags = !action.tags.find(tag => tag[0] === 'e')
  const hasZeroVelocity = action.tags.find(tag => tag[0] === 'velocity')!.slice(1).join('') === "000"
  return hasPubkeyCoordinate && hasNoETags && hasZeroVelocity
}

export type ExtractedCyberspaceActionState = {
  coordinate: CyberspaceCoordinate
  localCoordinate: CyberspaceLocalCoordinate
  plane: CyberspacePlane
  sector: CyberspaceSector
  velocity: CyberspaceVelocity
  rotation: Quaternion
  time: Time
}
// get the state from a cyberspace action
// note: type CyberspaceAction are events that have been validated so we don't need to handle missing tags.
export function extractCyberspaceActionState(action: CyberspaceAction): ExtractedCyberspaceActionState {
  const coordinateTag = action.tags.find(getTag('C'))![1]
  const coordinateDecimalsTag = action.tags.find(getTag('Cd'))!
  const coordinate = decimalCyberspaceCoordinateFromStrings(coordinateTag, coordinateDecimalsTag)
  const localCoordinate = coordinate.local
  const plane = coordinate.plane
  const sector = coordinate.sector
  // get velocity
  const velocityTag = action.tags.find(getTag('velocity'))!
  const velocity = new DecimalVector3().fromArray(velocityTag.slice(1,4)) as CyberspaceVelocity
  // get rotation
  const quaternionTag = action.tags.find(getTag('quaternion'))!
  let rotation = new Quaternion()
  if (quaternionTag) {
    rotation = new Quaternion().fromArray(quaternionTag.slice(1,4).map(parseFloat))
  }
  const time = getTime(action)
  return {
    coordinate,
    localCoordinate,
    plane,
    sector,
    velocity,
    rotation,
    time,
  }
}

// @TODO: this simulate function must take into account any other cyberspace objects that would affect its trajectory, such as vortices and bubbles targeting this avatar.
export function simulateNextEvent(startEvent: CyberspaceAction, toTime: Time): UnsignedEvent {
  const startTimestamp = getMillisecondsTimestampFromAction(startEvent)
  if (startTimestamp >= toTime.ms_timestamp) {
    // This shouldn't happen. The time passed in is generated from the current time, so it should always be greater than the start time.
    throw new Error ("Cannot simulate to a time before event.")
  }
  // calculate simulation from startEvent to toTime
  const frames = Math.floor((toTime.ms_timestamp - startTimestamp) / FRAME)

  // console.log('frames', frames, startTimestamp)

  if (frames === 0) {
    // no need to simulate if the time difference is less than a frame.
    return startEvent
  }

  const { coordinate, plane, velocity, rotation } = extractCyberspaceActionState(startEvent)

  const updatedPosition = coordinate.vector.clone()
  let updatedVelocity = velocity.clone()

  // Handle POW
  const POW = countLeadingZeroesHex(startEvent.id)

  // add POW to velocity if the startEvent was a drift action.
  if (startEvent.tags.find(getTagValue('A','drift'))) {
    let velocityPOW = Math.pow(2, POW-10)
    if (velocityPOW <= ZERO_VELOCITY) {
      // POW=0 will result in zero velocity.
      velocityPOW = 0
    }
    const bodyVelocity = new DecimalVector3(0, 0, velocityPOW) as CyberspaceVelocity
    const appliedVelocity = bodyVelocity.applyQuaternion(rotation)
    updatedVelocity = updatedVelocity.add(appliedVelocity)
  }

  // Todo: handle offensive actions like vortex and bubble

  // simulate position based on number of frames that have passed
  const simulatedVelocity = updatedVelocity.clone().multiplyScalar(frames)
  updatedPosition.add(simulatedVelocity)

  // simulation is complete. Construct a new action that represents the current valid simulated state.

  const positionVector = factoryCyberspaceCoordinateVector(updatedPosition.x, updatedPosition.y, updatedPosition.z)

  // turn the new position into a hex coordinate
  const hexCoord: Hex256Bit = cyberspaceEncodePartialToRaw(positionVector, plane) as Hex256Bit

  const velocityArray = updatedVelocity.toArray()

  // decimal array is 8-digit integers representing the fractional part of the position, because the fractional part can't be stored in the cyberspace coordinate.
  const decimalArray = updatedPosition.toArrayDecimals()

  const sector = cyberspaceSectorFromCoordinateVector(positionVector)

  // this event is agnostic of the type of action it may represent. The 'A' tag and POW must still be added.
  const event: UnsignedEvent = {
    pubkey: startEvent.pubkey,
    kind: 333,
    created_at: toTime.created_at,
    content: '',
    tags: [
      ['C', hexCoord],
      ['Cd', ...decimalArray ],
      ['S', sector.id],
      ['velocity', ...velocityArray],
      ['ms', toTime.ms_padded],
      ['version', '1'],
    ] // we omit quaternion tag because it should be set by the client.
  }
  return event
}

// ACTION CHAIN

export type ActionChainState = 
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'valid', genesisAction: Event, latestAction: Event}


/**
 * Example output: [0, 1, -1]
 * @param baseSectorId string
 * @param targetSectorId string
 * @returns CyberspaceSectorVector representing the difference in sector indices between the base and target sectors.
 */
export const relativeSectorIndex = (baseSectorId: string, targetSectorId: string): DecimalVector3 => {
  const base = cyberspaceSectorStringToRaw(baseSectorId)
  const target = cyberspaceSectorStringToRaw(targetSectorId)
  const baseVector = cyberspaceSectorIdToVector(base)
  const targetVector = cyberspaceSectorIdToVector(target)
  const position = targetVector.sub(baseVector)
  return position
}
