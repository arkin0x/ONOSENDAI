import * as THREE from "three"
import { Quaternion } from "@react-three/fiber"
import almostEqual from "almost-equal"
import { Action, BigCoords, Coords } from "../types/Cyberspace"
import { getTag, getTagValue } from "./Nostr"
import { EventTemplate, UnsignedEvent } from "nostr-tools"
import { countLeadingZeroes } from "./Hash"
import { func } from "three/examples/jsm/nodes/Nodes.js"

export const CYBERSPACE_SIZE = BigInt(2 ** 85)
export const UNIVERSE_DOWNSCALE = BigInt(2 ** 35)
export const UNIVERSE_SIZE = Number(CYBERSPACE_SIZE / UNIVERSE_DOWNSCALE)
export const UNIVERSE_SIZE_HALF = UNIVERSE_SIZE / 2

/*
Deriving the center coordinate of cyberspace:

Each axis of cyberspace is 2**85 long. However, the axes are index 0 which means the largest coordinate is actually 2**85 - 1, or 38685626227668133590597631.

Dividing this by 2 yields 19342813113834066795298815.5. Having a decimal in the coordinate system is not ideal, so we round down to 19342813113834066795298815.

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

export const FRAME = 1000 / 60
export const DRAG = 0.999
export const IDENTITY_QUATERNION: Quaternion = [0, 0, 0, 1]

export const getMillisecondsTimestampFromAction = (action: Action): number => {
  return action.created_at * 1000 + parseInt(action.tags.find(getTag('ms'))![1])
}

export function decodeHexToCoordinates(hexString: string): BigCoords {
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

    const lastBit = Number(binaryString[255])

    const plane = lastBit === 0 ? "d-space" : "i-space"

    return {x: X, y: Y, z: Z, plane }
}

export function downscaleCoords(coords: BigCoords, downscale: bigint = UNIVERSE_DOWNSCALE): Coords {
  return {
    x: Number(coords.x / downscale),
    y: Number(coords.y / downscale),
    z: Number(coords.z / downscale),
    plane: coords.plane
  }
}

export const vector3Equal = (a: THREE.Vector3, b: THREE.Vector3): boolean => {
  return almostEqual(a.x, b.x) && almostEqual(a.y, b.y) && almostEqual(a.z, b.z)
}

export const getPlaneFromAction = (action: Action): 'i-space' | 'd-space' => {
  // 0 = d-space (reality, first)
  // 1 = i-space (cyberreality, second)
  return parseInt(action.tags.find((tag: string[]) => tag[0] === 'C')![1].substring(63), 16) & 1 ? 'i-space' : 'd-space'
}

export const getVector3FromCyberspaceCoordinate = (coordinate: string): THREE.Vector3 => {
  const big = decodeHexToCoordinates(coordinate)
  const small = downscaleCoords(big, UNIVERSE_DOWNSCALE)
  return new THREE.Vector3(small.x, small.y, small.z)
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

// TODO: problem: since the coordinates are downscaled and simulated, we can't really upscale them again to get the real non-scaled coordinates.

function encodeCoordinatesToHex(x: number, y: number, z: number, plane: string): string {