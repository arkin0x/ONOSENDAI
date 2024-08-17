import * as THREE from "three"
import { Decimal } from 'decimal.js'
import almostEqual from "almost-equal"
import { CyberspaceCoordinate, CyberspaceCoordinateRaw, CyberspaceCoordinates, CyberspacePlane, factoryCyberspaceCoordinate, factoryCyberspaceDimension, Milliseconds, MillisecondsPadded, MillisecondsTimestamp, Plane, SecondsTimestamp, Time } from "../types/CyberspaceTypes"
import { getTag, getTagValue } from "./Nostr"
import type { Event, UnsignedEvent } from "nostr-tools"
import { countLeadingZeroesHex } from "./Hash"
import { DecimalVector3 } from "./DecimalVector3"

export const CYBERSPACE_AXIS = new Decimal(2).pow(85)
export const CYBERSPACE_SECTOR = new Decimal(2).pow(30)
export const CYBERSPACE_SECTORS_PER_AXIS = new Decimal(2).pow(55)
export const CYBERSPACE_DOWNSCALE = new Decimal(2).pow(35) // this is the size of a cyberspace axis reduced by 2**35 so that it fits into a number primitive in JavaScript (< Number.MAX_SAFE_INTEGER)
export const DOWNSCALED_CYBERSPACE_AXIS = CYBERSPACE_AXIS.div(CYBERSPACE_DOWNSCALE).toNumber()
export const HALF_DOWNSCALED_CYBERSPACE_AXIS = CYBERSPACE_AXIS.div(CYBERSPACE_DOWNSCALE).div(2).toNumber()

export const ZERO_VELOCITY = 0.0009765625 // Math.POW(2,-10) and below is rounded to zero.

/*
Deriving the center coordinate of cyberspace:

Each axis of cyberspace is 2**85 long. However, the axes are index 0 which means the largest coordinate is actually 2**85 - 1, or 38685626227668133590597631.

Dividing this by 2 yields 19342813113834066795298815.5. Having a decimal in the coordinate system is not possible, so we round down to 19342813113834066795298815.

Python:
from decimal import Decimal
axis = Decimal(2 ** 85 - 1)
half_axis = axis // Decimal(2)
print(half_axis)

The 85-bit representation of 19342813113834066795298815 is 0b01...1.

Python:
bin(19342813113834066795298815)[2:] # 111111111111111111111111111111111111111111111111111111111111111111111111111111111111
len(bin(19342813113834066795298815)[2:]) # 84 (84 1's; the leftmost bit is 0 and omitted as it is implied)

The 85 bits of each axis are interleaved to form the 255-bit cyberspace coordinate. From left (most significant) to right (least significant) the final 255-bit coordinate is formed as follows:

XYZXYZXYZ...XYZP

Since the leftmost bit of the center coordinate on each axis is 0, the resulting 255-bit coordinate will be:

000111111...111P (all implied bits are 1's)

P may be replaced with a 0 for d-space or a 1 for i-space.

*/

export const CENTERCOORD_BINARY = "0b0001111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111"
// usage: BigInt(CENTERCOORD_BINARY)

export const CENTERCOORD = "1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"

export const FRAME = 1000 / 60 // each frame is 1/60th of a second
export const FRACTIONAL_PRECISION = 100_000_000 // 8 decimal places for Avatar position precision in "Cd" tag.

export const IDENTITY_QUATERNION = [0, 0, 0, 1] // mostly so I don't forget

export const binToPlane = (bin: string|number): Plane => {
  return parseInt(bin.toString()) > 0 ? Plane.ISpace : Plane.DSpace
}

export const planeToBin = (plane: Plane): number => {
  return plane === Plane.ISpace ? 1 : 0
}

export const getCoordinatesObj = (position: DecimalVector3, plane: Plane): CyberspaceCoordinates => {
  return {
    vector: position,
    x: position.x,
    y: position.y,
    z: position.z,
    plane
  }
}

export function encodeCoordinatesToHex(coords: CyberspaceCoordinates): string {
    const X = new Decimal(coords.vector.x).floor()
    const Y = new Decimal(coords.vector.y).floor()
    const Z = new Decimal(coords.vector.z).floor()

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
    binaryString += planeToBin(coords.plane) 

    // Convert binary string to hexadecimal
    let hexString = ''
    for (let i = 0; i < 256; i += 4) {
        const chunk = binaryString.slice(i, i + 4)
        hexString += parseInt(chunk, 2).toString(16)
    }

    return hexString
}

export function decodeHexToCoordinates(hexString: CyberspaceCoordinateRaw): CyberspaceCoordinate {
    // Convert hex string to binary
    const binaryString = BigInt("0x" + hexString).toString(2).padStart(256, '0')

    const plane = binaryString[255] === '0' ? CyberspacePlane.DSpace : CyberspacePlane.ISpace
    
    // Initialize the coordinates
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
    const decimalX = new Decimal(X.toString())
    const decimalY = new Decimal(Y.toString())
    const decimalZ = new Decimal(Z.toString())

    return factoryCyberspaceCoordinate(
        hexString,
        factoryCyberspaceDimension(decimalX),
        factoryCyberspaceDimension(decimalY),
        factoryCyberspaceDimension(decimalZ),
        plane
    )
}


const decimalFLT_EPSILON = new Decimal(1.19209290e-7)
const decimalDBL_EPSILON = new Decimal(2.2204460492503131e-16)
/**
 * Decimal Almost Equal
 * almost-equal implemented with decimal.js
 */
export const decimalAlmostEqual = (a: Decimal, b: Decimal): boolean => {
  const difference = a.minus(b).abs()
  if (difference.lessThanOrEqualTo(decimalFLT_EPSILON)) {
    return true
  }
  if (difference.lessThanOrEqualTo(decimalDBL_EPSILON.times(Decimal.min(a.abs(), b.abs())))) {
    return true
  }
  return a.equals(b)
}

/**
 * @NOTE This function is NOT compatible wiith DecimalVector3
 */
export const vector3Equal = (a: THREE.Vector3, b: THREE.Vector3): boolean => {
  return almostEqual(a.x, b.x) && almostEqual(a.y, b.y) && almostEqual(a.z, b.z)
}

export const getVector3FromCyberspaceCoordinate = (coordinate: string): DecimalVector3 => {
  const coords = decodeHexToCoordinates(coordinate)
  return coords.vector
}

export const getMillisecondsTimestampFromAction = (action: Event|UnsignedEvent): number => {
  return action.created_at * 1000 + parseInt(action.tags.find(getTag('ms'))![1])
}

export const getPlaneFromAction = (action: Event|UnsignedEvent): 'i-space' | 'd-space' => {
  // 0 = d-space (reality, first)
  // 1 = i-space (cyberreality, second)
  const lastNibble = action.tags.find(getTag('C'))![1].substring(63)
  const binary = parseInt(lastNibble, 16).toString(2).padStart(4, '0')
  const lastBit = parseInt(binary[3])
  return binToPlane(lastBit)
}

export const getTime = (action?: Event|UnsignedEvent): Time => {
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

export const createUnsignedGenesisAction = (pubkey: string): UnsignedEvent => {
  const {created_at, ms_padded} = getTime()
  const sector = getSectorIdFromCoordinate(pubkey) 
  const sectorId = getSectorIdFromDecimal(sector)
  return {
    pubkey, 
    kind: 333,
    created_at,
    content: '',
    tags: [
      ['C', pubkey],
      ['velocity', '0', '0', '0'],
      ['quaternion', ...IDENTITY_QUATERNION.map(n => n.toString())],
      ['ms', ms_padded],
      ['version', '1'],
      ['A', 'noop'],
      ['S', sectorId],
    ]
  } as UnsignedEvent
}

export const nowIsAfterLatestAction = (latestAction: Event): boolean => {
  const now = getTime()
  try {
    // getMilliseconds is unsafe because it relies on tags that may not exist.
    // hence the try/catch.
    const latestActionTimestamp = getMillisecondsTimestampFromAction(latestAction)
    if (latestActionTimestamp >= now.ms_timestamp) {
      // not sure how this happens
      return false
    }
    return true
  } catch (e) {
    return false
  }
}

export const createUnsignedDriftAction = async (pubkey: string, throttle: number, _quaternion: THREE.Quaternion, genesisAction: Event, latestAction: Event): Promise<UnsignedEvent> => {
  const time = getTime()
  const newAction = simulateNextEvent(latestAction, time)
  if (newAction === undefined) {
    // This shouldn't happen because the action chain needs to be valid to get to this point.
    throw new Error("Simulation failed for latest event.")
  }
  const coord = newAction.tags.find(getTag('C'))![1]
  const sector = getSectorIdFromCoordinate(coord) 
  const sectorId = getSectorIdFromDecimal(sector)
  newAction.pubkey = pubkey
  newAction.tags.push(['A', 'drift'])
  newAction.tags.push(['quaternion', ..._quaternion.toArray().map(n => n.toFixed(8))])
  newAction.tags.push(['e', genesisAction.id, '', 'genesis'])
  newAction.tags.push(['e', latestAction.id, '', 'previous'])
  newAction.tags.push(['nonce', '0000000000000000', throttle.toString()])
  newAction.tags.push(['S', sectorId])
  return newAction as UnsignedEvent
}

export const isGenesisAction = (action: Event): boolean => {
  const hasPubkeyCoordinate = action.pubkey === action.tags.find(tag => tag[0] === 'C')![1] 
  const hasNoETags = !action.tags.find(tag => tag[0] === 'e')
  const hasZeroVelocity = action.tags.find(tag => tag[0] === 'velocity')!.slice(1).join('') === "000"
  return hasPubkeyCoordinate && hasNoETags && hasZeroVelocity
}

export type ExtractedActionState = ReturnType<typeof extractActionState>
// get the state from a cyberspace action
export const extractActionState = (action: Event|UnsignedEvent): {cyberspaceCoordinate: string, sectorId: string,  position: DecimalVector3, sectorPosition: DecimalVector3, plane: Plane, velocity: DecimalVector3, rotation: THREE.Quaternion, time: Time} => {
// debug
  // console.log('extractActionState: action', action)
  // get position
  const cyberspaceCoordinate = action.tags.find(getTag('C'))![1]
  const sectorId = getSectorIdFromDecimal(getSectorIdFromCoordinate(cyberspaceCoordinate))
  const position = getVector3FromCyberspaceCoordinate(cyberspaceCoordinate)
  // add fractional position if present
  const positionDecimalsTag = action.tags.find(getTag('Cd'))
  if (positionDecimalsTag) {
    const decimals = positionDecimalsTag.slice(1).map(v => parseInt(v) / FRACTIONAL_PRECISION)
    position.x = position.x.plus(new Decimal(decimals[0]))
    position.y = position.y.plus(new Decimal(decimals[1]))
    position.z = position.z.plus(new Decimal(decimals[2]))
  }
  const sectorPosition = cyberspaceVectorToSectorDecimal(position)
  // get plane
  const plane = getPlaneFromAction(action)
  // get velocity
  const velocity = new DecimalVector3().fromArray(action.tags.find(getTag('velocity'))!.slice(1))
  // get rotation
  // @TODO: should we accept floating point precision errors in rotation? If not, we need to implement a new quaternion based on Decimal.
  const quaternionTag = action.tags.find(getTag('quaternion'))
  let rotation = new THREE.Quaternion()
  if (quaternionTag) {
    rotation = new THREE.Quaternion().fromArray(quaternionTag.slice(1).map(parseFloat))
  }
  const time = getTime(action)
  return {cyberspaceCoordinate, sectorId, position, sectorPosition, plane, velocity, rotation, time}
}

// @TODO: this simulate function must take into account any other cyberspace objects that would affect its trajectory, such as vortices and bubbles targeting this avatar.
export const simulateNextEvent = (startEvent: Event|UnsignedEvent, toTime: Time): UnsignedEvent => {
  const startTimestamp = getMillisecondsTimestampFromAction(startEvent)
  if (startTimestamp >= toTime.ms_timestamp) {
    // This shouldn't happen. The time passed in is generated from the current time, so it should always be greater than the start time.
    throw new Error ("Cannot simulate to a time before the start event.")
  }
  // calculate simulation from startEvent to toTime
  const frames = Math.floor((toTime.ms_timestamp - startTimestamp) / FRAME)

  // console.log('frames', frames, startTimestamp)

  if (frames === 0) {
    // no need to simulate if the time difference is less than a frame.
    return startEvent
  }

  const { position, plane, velocity, rotation } = extractActionState(startEvent)

  const updatedPosition = position.clone()
  let updatedVelocity = velocity.clone()

  // add POW to velocity if the startEvent was a drift action.
  if ((startEvent as Event).id && startEvent.tags.find(getTagValue('A','drift'))) {
    const POW = countLeadingZeroesHex((startEvent as Event).id)
    let velocityPOW = Math.pow(2, POW-10)
    if (velocityPOW <= ZERO_VELOCITY) {
      // POW=0 will result in zero velocity.
      velocityPOW = 0
    }
    const bodyVelocity = new DecimalVector3(0, 0, velocityPOW)
    const addedVelocity = bodyVelocity.applyQuaternion(rotation || new THREE.Quaternion(0,0,0,1))
    updatedVelocity = updatedVelocity.add(addedVelocity)
  }

  // simulate position based on number of frames that have passed
  const simulatedVelocity = updatedVelocity.clone().multiplyScalar(frames)
  updatedPosition.add(simulatedVelocity)

  // simulation is complete. Construct a new action that represents the current valid state from the simulated state.

  const cyberspaceCoord = getCoordinatesObj(updatedPosition, plane)
  const hexCoord = encodeCoordinatesToHex(cyberspaceCoord)

  const velocityArray = updatedVelocity.toArray()

  // const rotationArray = rotation.toArray().map(n => n.toString())

  // decimal array is 8-digit integers representing the fractional part of the position, because the fractional part can't be stored in the cyberspace coordinate.
  const decimalArray = updatedPosition.toArrayDecimals()

  // this event is agnostic of the type of action it may represent. The 'A' tag and POW must still be added.
  const event: UnsignedEvent = {
    pubkey: startEvent.pubkey,
    kind: 333,
    created_at: toTime.created_at,
    content: '',
    tags: [
      ['C', hexCoord],
      ['Cd', ...decimalArray ],
      ['velocity', ...velocityArray],
      // ['quaternion', ...rotationArray], // this will be set by the UI
      ['ms', toTime.ms_padded],
      ['version', '1'],
    ]
  }
  return event
}

/**
 * Used for converting a hex cyberspace coordinate into a DecimalVector3 representing the sector id that the coordinate is in.
 * @param coordinate string
 * @returns DecimalVector3
 */
export const getSectorIdFromCoordinate = (coordinate: string): DecimalVector3 => {
  const coord = decodeHexToCoordinates(coordinate)

  const sectorX = coord.x.div(CYBERSPACE_SECTOR).floor()
  const sectorY = coord.y.div(CYBERSPACE_SECTOR).floor()
  const sectorZ = coord.z.div(CYBERSPACE_SECTOR).floor()
  
  const sector = new DecimalVector3(sectorX, sectorY, sectorZ)

  return sector
}

/**
 * Render the sector identifier from a DecimalVector3 sector. This is used in the "S" tag for querying objects in a sector.
 */
export const getSectorIdFromDecimal = (sector: DecimalVector3): string => {
  return sector.toArray(0).join('-')
}

/**
 * Turn a sectorId string into a DecimalVector3.
 * @param sectorId string
 * @returns DecimalVector3
 */
export const getSectorDecimalFromId = (sectorId: string): DecimalVector3 => {
  const [x, y, z] = sectorId.split('-').map(coord => new Decimal(coord))
  return new DecimalVector3(x, y, z)
}

/**
 * Transform a global cyberspace position to a local sector position for rendering in Three.js.
 * @param cyberspacePosition DecimalVector3
 */
export const cyberspaceVectorToSectorDecimal = (cyberspacePosition: DecimalVector3): DecimalVector3 => {

  const localX = cyberspacePosition.x.mod(CYBERSPACE_SECTOR)
  const localY = cyberspacePosition.y.mod(CYBERSPACE_SECTOR)
  const localZ = cyberspacePosition.z.mod(CYBERSPACE_SECTOR)

  const local = new DecimalVector3(localX, localY, localZ)

  return local
}

/**
 * Global cyberspace position to local sector position for rendering in Three.js.
 * Used to get the sector-based coordinates (different from the global cyberspace coordinates) from a 256-bit hex string.
 * @param coordinate 
 * @returns 
 */
export const getSectorCoordinatesFromCyberspaceCoordinate = (coordinate: string): DecimalVector3 => {
  const coord = decodeHexToCoordinates(coordinate)
  const position = new DecimalVector3(coord.x, coord.y, coord.z)
  return cyberspaceVectorToSectorDecimal(position)
}

export const relativeSectorPosition = (baseSectorId: string, targetSectorId: string): DecimalVector3 => {
  const baseSector = getSectorDecimalFromId(baseSectorId)
  const targetSector = getSectorDecimalFromId(targetSectorId)
  const position = targetSector.sub(baseSector).multiplyScalar(CYBERSPACE_SECTOR)
  return position
}