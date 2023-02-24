import './global.scss'
import './ONOSENDAI'
import { NIC } from './NIC'
import { simhash, embed_number_3d, downscale } from './simhash'
import { WORLD_DOWNSCALE , getEventsList, visualizeNote } from './ONOSENDAI'
import scrollLock from './scroll-lock.mjs'

document.body.classList.add('no-warn')

// Initialize network interface controller
const { pool, relays } = NIC()

// listen for notes
const sub_notes = pool.sub(relays,[{kinds:[1]}])

sub_notes.on('event', event => {
 let semanticHash = simhash(event.content)
 let semanticCoordinate = embed_number_3d(semanticHash.hash)
 let downscaledSemanticCoordinate = downscale(semanticCoordinate, WORLD_DOWNSCALE) 
 event.simhash = semanticHash.hash
 visualizeNote(event,downscaledSemanticCoordinate)

 // shutoff after 6000 events downloaded
 // TODO this is not actually our solution to performance but for now it works.
 if( getEventsList().length >= 6000 ) sub_notes.unsub()
})

// Listen for zaps
// const sub_zaps = pool.sub(relays,[{kinds:[9735]}])

// populate cyberspace
// sub_zaps.on('event', event => {
//  let bits = sha256ToBitArray(event.id)
//  let downscale = (2n**74n)
//  let coords = embedNumber3D(bits).map( bignum => Number(bignum / downscale))
//  // console.log(coords[0])
//  visualizeEvent(event,coords)
// })

scrollLock.enable()