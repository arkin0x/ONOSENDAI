import { sha256 } from '@noble/hashes/sha256'

export function simhash(input_text) {
  const featureVector = computeFeatureVector(input_text)
  const featureHashes = featureVector.map(v => sha256(v))
  const BITLENGTH = 256

  const arr = Array(BITLENGTH).fill(0)
  for (let bit = 0; bit < BITLENGTH; bit++) {
    for (const feature of featureHashes) {
      // console.log(bit,feature)
      let currentBit = getBit(bit,feature)
      arr[bit] += currentBit === 1 ? 1 : -1
    }
  }

  const similarityHash = arr.map(b => b > 0 ? 1 : 0)
  const similarityHex = binaryArrayToHex(similarityHash)
  return {
    hash: similarityHash,
    hex: similarityHex,
    toString: () => similarityHex
  }
}

function getBit(bitIndex, Uint8Array){
  let arrayIndex = Math.floor(bitIndex / 8)
  let byteIndex = bitIndex % 8
  let byte = Uint8Array[arrayIndex]
  let bit = (byte & (1 << byteIndex)) >> byteIndex
  return bit
}

function computeFeatureVector(input_text) {
  // Compute the feature vector of the input.
  // Here, we assume that input is a string and split it into words.
  const shingles = []
  for (let i = 0; i < input_text.length-1; i++) {
    const char1 = input_text[i];
    const char2 = input_text[i+1];
    const shingle = `${char1}${char2}`
    shingles.push(shingle)
  }
  return shingles
}

function fromTwosComplement(bits) {
  const isNegative = bits[0] === 1;
  let value = 0;
  for (let i = 1; i < bits.length; i++) {
    value = (value << 1) + bits[i];
  }
  if (isNegative) {
    const complement = value ^ ((1 << (bits.length - 1)) - 1);
    value = -(complement + 1);
  }
  return value;
}

/**
 * 
 * @param {Array} bits - array of 256 0s and 1s 
 * @returns 
 */
export function embed_number_3d(bits) {
  const x = bits.slice(0,84)
  const y = bits.slice(84,168)
  const z = bits.slice(168,252)

  const xparts = [0,0,0].map( () => fromTwosComplement( x.splice(0,28) ) )
  const xsum = xparts.reduce((acc, curr) => acc + curr, 0)
  const xavg = Math.floor(xsum / xparts.length)

  const yparts = [0,0,0].map( () => fromTwosComplement( y.splice(0,28) ) )
  const ysum = yparts.reduce((acc, curr) => acc + curr, 0)
  const yavg = Math.floor(ysum / yparts.length)

  const zparts = [0,0,0].map( () => fromTwosComplement( z.splice(0,28) ) )
  const zsum = zparts.reduce((acc, curr) => acc + curr, 0)
  const zavg = Math.floor(zsum / zparts.length)

  return [BigInt(xavg), BigInt(yavg), BigInt(zavg)]
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

/**
 * 
 * @param {Array} bits - array of 0s and 1s 
 * @returns 
 */
function binaryArrayToHex(bits) {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const chunk = bits.slice(i, i + 4).join('');
    const nibble = parseInt(chunk, 2).toString(16);
    hex += nibble;
  }
  return hex;
}

export const downscale = (arrayOfBigInts, scale = 1) => {
  return arrayOfBigInts.map(bInt => Number(bInt / BigInt(scale)) )
}
