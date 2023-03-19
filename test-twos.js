// function toTwosComplement(num, bits) {
//   const min = -Math.pow(2, bits-1);
//   const max = Math.pow(2, bits-1) - 1;
//   if (num < min || num > max) {
//     throw new RangeError(`Number ${num} is outside the range of ${bits}-bit signed integers.`);
//   }
//   if (num >= 0) {
//     return num.toString(2).padStart(bits, '0');
//   } else {
//     const positive = ((-num) ^ (max)) + 1;
//     return positive.toString(2).padStart(bits, '1');
//   }
// }


// function padWithZeros(num, length) {
//   let binaryStr = num.toString(2);
//   while (binaryStr.length < length) {
//     binaryStr = '0' + binaryStr;
//   }
//   return binaryStr;
// }

// const num = -15; // Example number
// const bits = 8; // Example number of bits
// const twosComplement = toTwosComplement(num, bits);
// const binaryStr = padWithZeros(twosComplement, bits);
// console.log(`Number: ${num}`);
// console.log(`Two's complement: ${twosComplement}`);
// console.log(`Binary representation: ${binaryStr}`);

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


const bits = [1, 0, 1, 0, 1, 1]; // Example two's complement binary number
const num = fromTwosComplement(bits);
console.log(`Binary representation: ${bits.join('')}`);
console.log(`Number: ${num}`);

