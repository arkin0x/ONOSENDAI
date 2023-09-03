import { PublishedConstructType, UnpublishedConstructType } from "../types/Construct"
import { getConstructProofOfWork, hexToUint8 } from "./Hash"
import { getTag } from "./Nostr"

function summation(n: number): number {
  if (n < 2) {
    return n
  } else {
    return n + summation(n - 1)
  }
}

export function constructSizeByValidProofOfWork(pow: number): number {
  return Math.floor(Math.pow(summation(pow), pow / 32))
}

export const emptyHex256 = "0000000000000000000000000000000000000000000000000000000000000000"

export type BigCoords = {
  x: bigint
  y: bigint
  z: bigint
  plane: "c-space" | "d-space"
}

export type Coords = {
  x: number
  y: number
  z: number
  plane: "c-space" | "d-space"
}

// @todo this decoding doesn't work as described in the cyberspace spec. Each most significant bit should divide the space in half.
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

export const sortUnpublishedConstructsPOW = (a: UnpublishedConstructType,b: UnpublishedConstructType) => {
  // sort by highest proof of work
  return b.workCompleted - a.workCompleted
}

export const sortPublishedConstructsPOW = (a: PublishedConstructType,b: PublishedConstructType) => {
  // determine work completed
  const aNonce = a.tags.find(getTag('nonce'))
  const aNonceValue = aNonce?.[2]
  if (!aNonceValue) return 0
  const aWork = getConstructProofOfWork(hexToUint8(a.id), hexToUint8(aNonceValue))

  const bNonce = b.tags.find(getTag('nonce'))
  const bNonceValue = bNonce?.[2]
  if (!bNonceValue) return 0
  const bWork = getConstructProofOfWork(hexToUint8(b.id), hexToUint8(bNonceValue))

  // sort by highest proof of work
  return bWork - aWork
}
