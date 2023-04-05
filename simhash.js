import { sha256 } from '@noble/hashes/sha256'

/**
 * @param {string} input_text content to calculate a simhash for
 * @returns Object {hash, hex}
 *  hash: array of 256 1s or 0s of simhash
 *  hex: string of hex digits of simhash
 */
export function simhash(input_text) {
  const featureVector = computeFeatureVector(input_text)
  const featureHashes = featureVector.map(v => sha256(v))
  const BITLENGTH = 256

  const arr = Array(BITLENGTH).fill(0)
  for (let bit = 0; bit < BITLENGTH; bit++) {
    for (const feature of featureHashes) {
      let currentBit = getBit(bit,feature)
      arr[bit] += currentBit === 1 ? 1 : -1
    }
  }

  const similarityHash = arr.map(b => b > 0 ? 1 : 0)
  const similarityHex = binaryArrayToHex(similarityHash)
  return {
    hash: similarityHash,
    hex: similarityHex,
  }
}

/**
 * 
 * @param {int} bitIndex the index of the bit to retrieve from the sha256 hash
 * @param {Uint8Array} simhashUint8Array the output of the sha256
 * @returns the bit's value (0 or 1)
 */
function getBit(bitIndex, simhashUint8Array){
  let arrayIndex = Math.floor(bitIndex / 8)
  let byteIndex = bitIndex % 8
  let byte = simhashUint8Array[arrayIndex]
  let bit = (byte & (1 << byteIndex)) >> byteIndex
  return bit
}

/**
 * Compute the feature vector of the input.
 * A shingle is a discrete overlapping substring of 2 or more characters taken from a larger string. The shingles are used to create a lexical fingerprint of the whole string.
 * @param {string} input the content to simhash
 * @returns an array of shingles
 */
function computeFeatureVector(input) {
  const shingles = []
  for (let i = 0; i < input.length-1; i++) {
    const char1 = input[i];
    const char2 = input[i+1];
    const shingle = `${char1}${char2}`
    shingles.push(shingle)
  }
  return shingles
}

/**
 * Embedding is splitting a number into parts.
 * We split the simhash (array of 256 1s and 0s) into 3 parts of 85 bits for our x/y/z coordinates.
 * @param {binary Array} bits 256 1s and 0s
 * @returns 
 */
export function embedNumber3D(bits) {
  const mask85 = (1n << 85n) - 1n;
  const x = ((bits.slice(0, 85).reduce((acc, bit, i) => acc + BigInt(bit) * (1n << (84n - BigInt(i))), 0n) & mask85) - (1n << 84n));
  const y = ((bits.slice(85, 170).reduce((acc, bit, i) => acc + BigInt(bit) * (1n << (84n - BigInt(i))), 0n) & mask85) - (1n << 84n));
  const z = ((bits.slice(170, 255).reduce((acc, bit, i) => acc + BigInt(bit) * (1n << (84n - BigInt(i))), 0n) & mask85) - (1n << 84n));
  return [BigInt(x), BigInt(y), BigInt(z)];
}

export function Uint8ArrayToRadix(bits, radix=2) {
  let pad = {
    2: 8,
    16: 2
  }
  let arrayBits = Array.from(bits)
  let out = '';
  for (let i = 0; i < arrayBits.length; i++) {
   let byte = arrayBits[i].toString(radix)
   while(byte.length < pad[radix]) byte = `0${byte}`
   out = out + `${byte}`
  }
  return out;
}

function binaryArrayToHex(bits) {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const chunk = bits.slice(i, i + 4).join('');
    const nibble = parseInt(chunk, 2).toString(16);
    hex += nibble;
  }
  return hex;
}

export const downscale = (arrayOfBigInts, scale) => {
  return arrayOfBigInts.map(BN => Number(BN / scale))
}
