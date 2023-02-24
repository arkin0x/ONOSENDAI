/**
 * Test POW for coordinate manipulation
 * Just import this file on the main.js to use it like this:
 * import './test-pow.js'
 */
import { scene } from './ONOSENDAI'
import { simhash, embed_number_3d, downscale } from './simhash.js'
import { addObject } from './GRAPH'
import { NIC } from './NIC'

function getCoords(str,nonce=''){
 let semanticHash = simhash(nonce + str)
 let semanticCoordinate = embed_number_3d(semanticHash.hash)
 let downscaledSemanticCoordinate = downscale(semanticCoordinate, 2n**72n) // this downscale is for debugging only
 
 // console.log(downscaledSemanticCoordinate)
 return downscaledSemanticCoordinate
}

let nonce = 0
let obj = null

// see where events go when they start from nothing
export function POW(eventID){
 let str = 'Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and dedicated to the proposition that all men are created equal.' + eventID
 // console.log(str)
 if (obj) scene.remove(obj) 
 obj = addObject({id: nonce, pubkey: nonce}, getCoords(str))
 nonce++
}

const { pool, relays } = NIC()

// listen for notes
const sub_notes = pool.sub(relays,[{kinds:[1]}])

sub_notes.on('event', event => {
 POW(event.id)
})





