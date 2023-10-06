import * as THREE from "three"
import { Quaternion } from "@react-three/fiber"
import almostEqual from "almost-equal"
import { Action, BigCoords, Coords } from "../types/Cyberspace"
import { getTag } from "./Nostr"

export const CYBERSPACE_SIZE = BigInt(2 ** 85)
export const UNIVERSE_DOWNSCALE = BigInt(2 ** 35)
export const UNIVERSE_SIZE = Number(CYBERSPACE_SIZE / UNIVERSE_DOWNSCALE)
export const UNIVERSE_SIZE_HALF = UNIVERSE_SIZE / 2

export const CENTERCOORD = "1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE"

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

    const plane = lastBit === 0 ? "d-space" : "c-space"

    return {x: X, y: Y, z: Z, plane }
}

export function downscaleCoords(coords: BigCoords, downscale: bigint): Coords {
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

export const getPlaneFromAction = (action: Action): 'c-space' | 'd-space' => {
  // 0 = d-space (reality, first)
  // 1 = c-space (cyberreality, second)
  return parseInt(action.tags.find((tag: string[]) => tag[0] === 'C')![1].substring(63), 16) & 1 ? 'c-space' : 'd-space'
}

export const getVector3FromCyberspaceCoordinate = (coordinate: string): THREE.Vector3 => {
  const big = decodeHexToCoordinates(coordinate)
  const small = downscaleCoords(big, UNIVERSE_DOWNSCALE)
  return new THREE.Vector3(small.x, small.y, small.z)
}