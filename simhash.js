import { sha256 } from '@noble/hashes/sha256'

/**
   "SimHash is a locality-sensitive hashing algorithm that maps similar inputs to similar hash values. It operates on inputs that can be represented as a vector of numerical features. The algorithm computes a 256-bit hash value for each input by performing the following steps:

   1. Compute the feature vector of the input.
   2. For each feature, compute its hash value using a standard hash function (e.g., SHA-256).
   3. For each bit position in the resulting 256-bit hash, sum the hash values of all the features whose corresponding bit is set in that position, and subtract the hash values of all the features whose corresponding bit is not set in that position.
   4. Set the bit to 1 if the resulting sum is positive, and 0 otherwise.

   The resulting hash value is a 256-bit binary string that encodes the similarity of the input to other inputs that have been hashed using the same algorithm. Inputs that are more similar to each other will have hash values that differ by fewer bits than inputs that are less similar."
   https://chat.openai.com/chat#:~:text=SimHash%20is%20a,are%20less%20similar.
 */
export function simhash(input_text) {
  //debug
  // console.log('\nsimhash:', input_text)

  const featureVector = computeFeatureVector(input_text)

  const featureHashes = featureVector.map(v => sha256(v))

  //debug
  // console.log(featureHashes)
  // featureHashes.map(f => console.log(Uint8ArrayToRadix(f,16)))

  const BITLENGTH = 256

  const arr = Array(BITLENGTH).fill(0)
  for (let bit = 0; bit < BITLENGTH; bit++) {
    for (const feature of featureHashes) {
      // console.log(bit,feature)
      let currentBit = getBit(bit,feature)
      arr[bit] += currentBit === 1 ? 1 : -1
    }
  }

  //debug
  // console.log(arr)

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

function computeFeatureVector(input) {
  // Compute the feature vector of the input.
  // Here, we assume that input is a string and split it into words.
  const shingles = []
  for (let i = 0; i < input.length-1; i++) {
    const char1 = input[i];
    const char2 = input[i+1];
    const shingle = `${char1}${char2}`
    shingles.push(shingle)
  }
  return shingles
}

export function embed_number_3d(bits) {
  const x = bits.slice(0,84)
  const y = bits.slice(84,168)
  const z = bits.slice(168,252)


  const xparts = [0,0,0].map( i => Number( '0b' + x.splice(0,28).join('') ) )
  const xsum = xparts.reduce((acc, curr) => acc + curr, 0)
  const xavg = Math.floor(xsum / xparts.length)

  const yparts = [0,0,0].map( i => Number( '0b' + y.splice(0,28).join('') ) )
  const ysum = yparts.reduce((acc, curr) => acc + curr, 0)
  const yavg = Math.floor(ysum / yparts.length)

  const zparts = [0,0,0].map( i => Number( '0b' + z.splice(0,28).join('') ) )
  const zsum = zparts.reduce((acc, curr) => acc + curr, 0)
  const zavg = Math.floor(zsum / zparts.length)

  return [BigInt(xavg), BigInt(yavg), BigInt(zavg)]
}

// export function simhash_gpt(input) {
//   const featureVector = computeFeatureVector(input);
//   const hashValues = computeHashValues(featureVector);
//   const simhashBits = computeSimhashBits(hashValues);
//   return simhashBits;
// }

// function computeFeatureVector_gpt(input) {
//   // Compute the feature vector of the input.
//   // Here, we assume that input is a string and split it into words.
//   const words = input.split(/\s+/);
//   const featureVector = {};

//   // Compute the hash value of each word using a standard hash function (SHA-256).
//   for (const word of words) {
//     const hash = sha256(word)
//     const hash16 = Uint8ArrayToRadix(hash)
//     // Split the 256-bit hash into 4 64-bit values.
//     const hashParts = hash16.match(/.{16}/g).map(hexToSignedInt);
//     // const hashParts = 
//     // Update the feature vector by adding the hash values to the corresponding features.
//     for (let i = 0; i < hashParts.length; i++) {
//       const feature = `feature${i}`;
//       featureVector[feature] = (featureVector[feature] || 0) + hashParts[i];
//     }
//   }
//   return featureVector;
// }

// function computeHashValues(featureVector) {
//   // Compute the hash values of the features using a standard hash function (SHA-256).
//   console.log(featureVector)
//   const hashValues = {};
//   for (const feature of Object.keys(featureVector)) {
//     const hash = sha256(featureVector[feature]);
//     hashValues[feature] = hexToSignedInt(hash);
//   }
//   return hashValues;
// }

// function computeSimhashBits(hashValues) {
//   // Compute the Simhash bits from the hash values of the features.
//   const simhashBits = new Array(256).fill(0);
//   for (const feature of Object.keys(hashValues)) {
//     const hashValue = hashValues[feature];
//     for (let i = 0; i < 256; i++) {
//       const bitValue = (hashValue >> i) & 1;
//       simhashBits[i] += bitValue ? 1 : -1;
//     }
//   }
//   // Set each bit to 1 if the corresponding sum is positive, and 0 otherwise.
//   for (let i = 0; i < 256; i++) {
//     simhashBits[i] = simhashBits[i] >= 0 ? 1 : 0;
//   }
//   return simhashBits.join("");
// }

function hexToSignedInt(hex) {
  // Convert a hex string to a signed 64-bit integer.
  const unsignedInt = parseInt(hex, 16);
  return unsignedInt > 0x7fffffffffffffff ? unsignedInt - 0x10000000000000000 : unsignedInt;
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

export const downscale = (arrayOfBigInts, scale = 1) => {
  return arrayOfBigInts.map(BN => {
    return Number(BN / scale)
  })
}
