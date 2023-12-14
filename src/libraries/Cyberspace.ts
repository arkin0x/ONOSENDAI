import * as THREE from "three"
import { Quaternion } from "@react-three/fiber"
import { Decimal } from 'decimal.js'
import almostEqual from "almost-equal"
import { Action, CyberspaceCoordinates, MiniatureCyberspaceCoordinates } from "../types/Cyberspace"
import { getTag, getTagValue } from "./Nostr"
import { EventTemplate } from "nostr-tools"
import { countLeadingZeroes } from "./Hash"
import { DecimalVector3 } from "./DecimalVector3"

export const CYBERSPACE_AXIS = new Decimal(2).pow(85)
export const CYBERSPACE_DOWNSCALE = new Decimal(2).pow(35) // this is the size of a cyberspace axis reduced by 2**35 so that it fits into a number primitive in JavaScript (< Number.MAX_SAFE_INTEGER)
export const DOWNSCALED_CYBERSPACE_AXIS = CYBERSPACE_AXIS.div(CYBERSPACE_DOWNSCALE).toNumber()
export const HALF_DOWNSCALED_CYBERSPACE_AXIS = CYBERSPACE_AXIS.div(CYBERSPACE_DOWNSCALE).div(2).toNumber()

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

export const CENTERCOORD_BINARY = '0b0001111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111'
// usage: BigInt(CENTERCOORD_BINARY)

export const CENTERCOORD = "1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"

export const FRAME = 1000 / 60 // each frame is 1/60th of a second
export const DRAG = 0.999 // 0.999 is multiplied by each velocity component each frame to simulate drag, simply so that acceleration is not infinite.
export const IDENTITY_QUATERNION: Quaternion = [0, 0, 0, 1] // mostly so I don't forget

export const binToPlane = (bin: string|number): 'i-space' | 'd-space' => {
  return parseInt(bin.toString()) > 0 ? 'i-space' : 'd-space'
}

export const planeToBin = (plane: 'i-space' | 'd-space'): number => {
  return plane === 'i-space' ? 1 : 0
}

export function encodeCoordinatesToHex(coords: CyberspaceCoordinates): string {
    const X = coords.x
    const Y = coords.y
    const Z = coords.z
    // Convert X, Y, and Z to BigInt and then to binary strings
    const binaryX = BigInt(X.toFixed()).toString(2).padStart(85, '0')
    const binaryY = BigInt(Y.toFixed()).toString(2).padStart(85, '0')
    const binaryZ = BigInt(Z.toFixed()).toString(2).padStart(85, '0')

    // Initialize an empty string to hold the interleaved bits
    let binaryString = ''

    // Loop through the binary strings of X, Y, and Z, adding one bit from each to the interleaved string in turn
    for (let i = 0; i < 85; i++) {
        binaryString += binaryX[i] + binaryY[i] + binaryZ[i]
    }

    // Add the plane bit to the end of the string
    binaryString += planeToBin(coords.plane) 

    // Convert the binary string to a hexadecimal string
    const hexString = BigInt('0b' + binaryString).toString(16).padStart(64, '0')

    // Return the hexadecimal string
    return hexString
}

export function decodeHexToCoordinates(hexString: string): CyberspaceCoordinates {
    // Checking if the input string is a valid 64 character hexadecimal string
    if (!/^([0-9A-Fa-f]{64})$/.test(hexString)) {
        throw new Error("Invalid hexadecimal string.")
    }

    // Initialize the coordinates
    let X = BigInt(0)
    let Y = BigInt(0)
    let Z = BigInt(0)

    // Convert hex string to binary
    const binaryString = BigInt("0x" + hexString).toString(2).padStart(256, '0')

    // Traverse through the binary string
    for (let i = 0; i < 255; i++) {
        switch (i % 3) {
            case 0:
                X = (X << BigInt(1)) | BigInt(binaryString[i])
                break
            case 1:
                Y = (Y << BigInt(1)) | BigInt(binaryString[i])
                break
            case 2:
                Z = (Z << BigInt(1)) | BigInt(binaryString[i])
                break
        }
    }

    const plane = binToPlane(binaryString)

    // convert bigints to decimal objects
    const decimalX = new Decimal(X.toString())
    const decimalY = new Decimal(Y.toString())
    const decimalZ = new Decimal(Z.toString())

    return {
      x: decimalX,
      y: decimalY,
      z: decimalZ,
      plane
    } as CyberspaceCoordinates
}

/** 
 * Transform a cyberspace coordinate into a downscaled cyberspace coordinate where each axis can be represented by a number primitive in JavaScript. Normally coordinates can be values well above Number.MAX_SAFE_INTEGER, so we need to downscale them to fit into a number primitive.
 */ 
export function downscaleCoordinates(coords: CyberspaceCoordinates, downscale: Decimal = CYBERSPACE_DOWNSCALE): MiniatureCyberspaceCoordinates {
  return {
    x: coords.x.div(downscale).toNumber(),
    y: coords.y.div(downscale).toNumber(),
    z: coords.z.div(downscale).toNumber(),
    plane: coords.plane
  }
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
  return new DecimalVector3(coords.x, coords.y, coords.z)
}

export const getMillisecondsTimestampFromAction = (action: Action): number => {
  return action.created_at * 1000 + parseInt(action.tags.find(getTag('ms'))![1])
}

export const getPlaneFromAction = (action: Action): 'i-space' | 'd-space' => {
  // 0 = d-space (reality, first)
  // 1 = i-space (cyberreality, second)
  const lastNibble = action.tags.find(getTag('C'))![1].substring(63)
  const binary = parseInt(lastNibble, 16).toString(2).padStart(4, '0')
  const lastBit = parseInt(binary[3])
  return binToPlane(lastBit)
}

export const isGenesisAction = (action: Action): boolean => {
  const hasPubkeyCoordinate = action.pubkey === action.tags.find(tag => tag[0] === 'C')![1] 
  const hasNoETags = !action.tags.find(tag => tag[0] === 'e')
  const hasZeroVelocity = action.tags.find(tag => tag[0] === 'velocity')!.slice(1).join('') === "000"
  return hasPubkeyCoordinate && hasNoETags && hasZeroVelocity
}

export const simulate = (startEvent: Action, toTime: number): EventTemplate|undefined => {
  const startTimestamp = getMillisecondsTimestampFromAction(startEvent)
  if (startTimestamp >= toTime) {
    console.warn("Cannot simulate to a time before the start event.")
    return
  }
  // calculate simulation from startEvent to toTime
  let frames = Math.floor((toTime - startTimestamp) / FRAME)

  // initialize simulation state from startEvent
  let position = getVector3FromCyberspaceCoordinate(startEvent.tags.find(getTag('C'))![1])
  let velocity = new THREE.Vector3().fromArray(startEvent.tags.find(getTag('velocity'))!.slice(1).map(parseFloat))
  const rotation = new THREE.Quaternion().fromArray(startEvent.tags.find(getTag('quaternion'))!.slice(1).map(parseFloat))
  
  // add POW to velocity if the startEvent was a drift action.
  if (startEvent.tags.find(getTagValue('A','drift'))) {
    const POW = countLeadingZeroes(startEvent.id)
    const newVelocity = Math.pow(2, POW)
    const bodyVelocity = new THREE.Vector3(0, 0, newVelocity)
    const addedVelocity = bodyVelocity.applyQuaternion(rotation)
    velocity = velocity.add(addedVelocity)
  }

  // simulate frames
  while (frames--) {
    // update position from velocity
    position = position.add(velocity)
    // update velocity with drag
    velocity = velocity.multiplyScalar(DRAG)
  }  

  // simulation is complete. Construct a new action with the simulated state.

  const event: EventTemplate = {
    kind: 333,
    created_at: Math.floor(toTime / 1000),
    content: '',
    tags: [
      ['C', encodeCoordinatesToHex(position.x, position.y, position.z, startEvent.tags.find(getTag('C'))![1].substring(63))],
      ['velocity', '000'],
      ['quaternion', rotation.toArray().join(' ')],
      ['ms', (toTime % 1000).toString().padStart(3, '0')]
    ]
  }
}
