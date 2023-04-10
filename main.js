import './global.scss'
import './ONOSENDAI'
import scrollLock from './scroll-lock.mjs'

document.body.classList.add('no-warn')


// ten for zaps
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