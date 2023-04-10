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

/**
 * Call timer() at the beginning of a function and save the return value;
 * Call the return value() at the end of a function to get the elapsed time
 * that the function took.
 * @returns elapsed time in milliseconds (float)
 */
export function timer() {
  let start = performance.now()
  return function(){
    return performance.now() - start
  }
}