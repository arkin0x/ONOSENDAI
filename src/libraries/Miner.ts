import { UnsignedEvent } from "nostr-tools"

// a status response from the miner
export type MinerStatus = "stopped" | "error" | "heartbeat" | "newhigh" | "batchcomplete" | "complete"

// a message from the miner
export type MinerMessage = {
  status: MinerStatus,
  data: {
    batch: number,
    binaryEvent: Uint8Array,
    binaryTarget: Uint8Array,
    createdAt: number,
    duration?: number,
    event: UnsignedEvent,
    hash: Uint8Array,
    nonce: number,
    nonceBounds: Array<number>,
    nonceStart: number,
    targetWork: number,
    work: number,
    workerNumber: number,
  }
}

export type MinerCommandStatus = "startmining" | "stopmining"

export type MinerCommand = {
  command: MinerCommandStatus
}

export const WORKER_COUNT = 10
// 6 bytes is 281474976710655, which is slightly less than the max size of a number in javascript that still fits nicely into a Uint8Array 6 elemenst long.
// Divide up the max nonce into 6 equal parts, one for each worker.
export const BATCH_SIZE = Math.floor( 281474976710655 / WORKER_COUNT )

/**
 * Determine the beginning and ending index of the nonce in the serialized event
 * @param serializedEvent string
 * @returns beginning and end index of the nonce in the buffer
 */
export const getNonceBounds = (serializedEvent: string): Array<number> => {
  const nonceTag = '"nonce","'
  const nonceStart = serializedEvent.indexOf(nonceTag) + nonceTag.length
  const nonceEnd = serializedEvent.indexOf('"', nonceStart)
  return [nonceStart, nonceEnd]
}

/**
 * Seralize a nostr event into a string
 * @param event UnsignedEvent
 * @returns string
 */
export const serializeEvent = (event: UnsignedEvent): string => {
  return JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content
  ])
}

/**
 * Used to convert a nonce buffer into a number (big-endian)
 * 6 bytes is (slightly less than) the max size of a number in javascript: 
 * 6 bytes max is 281474976710655
 * A 6 byte nonce would take 89 years to mine every nonce at 100_000 hashes per
 * second, which is a typical speed on my gaming laptop.
 * @param uint8Array 
 * @returns number
 */
export const convertUint8ArrayToNumber = (uint8Array: Uint8Array): number => {
    // Ensure the Uint8Array is not longer than 6 bytes, 
    // because JavaScript's max safe integer is 2^53 - 1.
    if (uint8Array.length > 6) {
        throw new Error('Uint8Array too large, max 6 bytes for Number type')
    }

    let result = 0
    for (let i = 0; i < uint8Array.length; i++) {
        // Shift the current result to the left by 8 bits (i.e., multiply by 256) 
        // and add the next byte. This interprets the Uint8Array as a big-endian integer.
        result = (result * 256) + uint8Array[i]
    }
    return result
}

export const convertNumberToUint8Array = (num: number): Uint8Array => {
    if (num > Number.MAX_SAFE_INTEGER) {
        throw new Error('Number too large, must be less than or equal to ' + Number.MAX_SAFE_INTEGER)
    }

    const byteArray = []
    for(let i = 0; i < 6; i++) {
        // Extract the last byte of the number and unshift it into the array,
        // effectively creating a big-endian array of bytes.
        byteArray.unshift(num & 0xFF)

        // Right shift the number by 8 to move on to the next byte.
        // num = Math.floor(num / 256)
        num = num >> 8
    }

    // Remove leading zeros.
    while (byteArray.length > 0 && byteArray[0] === 0) {
        byteArray.shift()
    }

    return new Uint8Array(byteArray)
}

export const incrementNonceBuffer = (buffer: Uint8Array, startIndex: number, endIndex: number): Uint8Array => {
  // go from right to left to update count, because the number is big-endian
  for (let i = endIndex-1; i >= startIndex; i--) {
    if (buffer[i] === 63) {
      // we are using 16 UTF-8 symbols between decimal 48 and 63 (0-9, :, ;, <, =, >, ?)
      // 16 nonce digits * 4 bits per digit = 64 bits of possible entropy, which is more than enough for a nonce, especially since the created_at will be incremented and serve as entropy too.
      // wrap around if the symbol is 63 (?) and set to 48 (0)
      buffer[i] = 48
    } else {
      buffer[i]++
      break
    }
  }
  return buffer
}

export const calculateHashrate = (duration: number): number => {
  // we know that this duration is milliseconds to do 1 million hashes.
  // convert into a hashes per second number.
  return Math.floor(1_000_000 / (duration / 1_000))
}