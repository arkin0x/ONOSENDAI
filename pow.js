// test this file like this in node.js:
// $ npx nodemon pow.js

import { sha256 } from '@noble/hashes/sha256'
import { pow } from './simhash.js'

// pow(1)
// pow(2)
// pow(3)
// pow(4)
pow(20)

// let startHashTime = +new Date
// for (let nonce = 0; nonce < 1_000_000; nonce++) {
//  sha256(''+nonce)
// }
// let endHashTime = +new Date

// let duration = (endHashTime-startHashTime)/1000
// let megahashes = 1_000_000 / duration / 1_000_000

// console.log(`${megahashes.toFixed(6)} MH/s\n`)