/**
 * Test the distribution of the simhash function.
 */
import { simhash, embed_number_3d, downscale } from './simhash.js'
import { addObject } from './GRAPH'

function getCoords(str,nonce=''){
 let semanticHash = simhash(nonce + str)
 let semanticCoordinate = embed_number_3d(semanticHash.hash)
 let downscaledSemanticCoordinate = downscale(semanticCoordinate, 2n**78n) // this downscale is for debugging only
 // console.log(downscaledSemanticCoordinate)
 return downscaledSemanticCoordinate
}

let nonce = 0

// see where events go when they start from nothing
export function gradient(){
 let str = String.fromCharCode(nonce)
 // console.log(str)
 addObject({id: nonce, pubkey: nonce}, getCoords(str))
 nonce++
}

