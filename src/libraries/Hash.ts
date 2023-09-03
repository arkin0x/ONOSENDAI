export const encoder = new TextEncoder()
export const decoder = new TextDecoder()

export function validateHash(value: string): boolean {
  if (value && value.length === 64 && value.match(/^[0-9a-fA-F]+$/)) {
    return true
  }
  return false
}

// hex should be a hexadecimal string (with no 0x prefix)
export function countLeadingZeroes(hex: string) {
  let count = 0

  for (let i = 0; i < hex.length; i++) {
    const nibble = parseInt(hex[i], 16)
    if (nibble === 0) {
      count += 4
    } else {
      count += Math.clz32(nibble) - 28
      break
    }
  }

  return count
}

export function uint8ToHex(hash: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < hash.length; i++) {
    let byte = hash[i].toString(16)
    if (byte.length < 2) {
      byte = '0' + byte  // pad with leading zero if necessary
    }
    hex += byte
  }
  return hex
}

export function hexToUint8(hexString: string) {
  if (hexString.length % 2 !== 0 || hexString.length !== 64) {
    throw new Error('Invalid hexadecimal string length')
  }

  const uint8Array = new Uint8Array(hexString.length / 2)

  for (let i = 0, j = 0; i < hexString.length; i += 2, j++) {
    const byte = parseInt(hexString.substring(i, i+2), 16)
    if (isNaN(byte)) {
      throw new Error('Invalid hexadecimal string')
    }
    uint8Array[j] = byte
  }

  return uint8Array
}

export function uint8ArrayToBinaryArray(uint8Array: Uint8Array): Array<number> {
  const binaryArray = []

  for (let i = 0; i < uint8Array.length; i++) {
    const byte = uint8Array[i]
    for (let j = 7; j >= 0; j--) {
      binaryArray.push((byte >> j) & 1)
    }
  }

  return binaryArray
}

export function padBinaryString(binaryString: string): string {
  const paddingLength = 8 - binaryString.length
  if (paddingLength <= 0) {
    return binaryString
  }
  
  const paddingZeros = '0'.repeat(paddingLength)
  return paddingZeros + binaryString
}

export function generateSecureEntropyString(length: number) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const charactersLength = characters.length

  let entropyString = ''
  const uint32Array = new Uint32Array(length)

  window.crypto.getRandomValues(uint32Array)

  for (let i = 0; i < length; i++) {
    entropyString += characters.charAt(uint32Array[i] % charactersLength)
  }

  return entropyString
}

export function hammingDistance(arr1: Uint8Array, arr2: Uint8Array): number {
  if (arr1.length !== arr2.length) {
    throw new Error('Input arrays must have the same length')
  }

  let dist = 0
  for (let i = 0; i < arr1.length; i++) {
    let xorResult = arr1[i] ^ arr2[i]  // XOR the bytes

    // Count the number of set bits in xorResult
    while (xorResult) {
      dist += xorResult & 1  // Increment dist if the least significant bit is 1
      xorResult >>= 1  // Right shift by 1
    }
  }

  return dist
}

export function getConstructProofOfWork(targetHash: Uint8Array, currentHash: Uint8Array, length = 255) {
  // ignore 256th bit (it's ignored in the spec)
  // we do this before calculating the hamming distance because we shouldn't change how hamming function works but we need to ignore the last bit as it is not used in any coordinate.
  // zero out last bit in last byte of targetHash
  targetHash[targetHash.length - 1] &= 0b01111111
  // zero out last bit in last byte of currentHash
  currentHash[currentHash.length - 1] &= 0b01111111
  const distance = hammingDistance(targetHash, currentHash)
  const similarity = length - distance
  // We subtract 128 because any random hash will have an average similarity of 128.
  const validWork = Math.max(0, similarity - 128)
  return validWork
}
