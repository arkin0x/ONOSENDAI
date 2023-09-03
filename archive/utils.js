// utilities

export function sha256ToBitArray(hash) {
  let bitArray = [];
  for (let i = 0; i < hash.length; i++) {
    const byte = parseInt(hash[i], 16);
    const bits = byte.toString(2).padStart(4, '0');
    bitArray.push(...bits.split('').map(bit => parseInt(bit)));
  }
  return bitArray;
}
