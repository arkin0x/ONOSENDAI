import { sha256 } from '@noble/hashes/sha256'
import { incrementNonceBuffer, setNonceBuffer } from "../libraries/Miner"
import { countLeadingZeroesBin, uint8ToHex } from "../libraries/Hash"

let active = false
let currentNonce = 0

self.onmessage = function(message) {
  const { command, data } = message.data
  switch (command) {
    case 'start':
      active = true
      initiateMining(data)
      break
    case 'stop':
      active = false
      break
  }
}

function initiateMining(data) {
  let {
    shardEvent,
    nonceBounds,
    nonceStartValue,
    nonceEndValue,
    targetPOW,
  } = data

  currentNonce = nonceStartValue

  shardEvent = setNonceBuffer(shardEvent, nonceBounds[0], nonceBounds[1], nonceStartValue)

  function mine(){
    if (active && currentNonce <= nonceEndValue) {
      let digest = sha256(shardEvent)
      let POW = countLeadingZeroesBin(digest)

      if (POW >= targetPOW) {
        const id = uint8ToHex(digest)
        postMessage({ status: 'pow-target-found', shardEvent, nonceBounds, digest, id, currentNonce, POW })
        active = false
        return
      }

      currentNonce++
      shardEvent = incrementNonceBuffer(shardEvent, nonceBounds[0], nonceBounds[1])
      setTimeout(mine, 0)
    } else if (!active) {
      postMessage({ status: 'stopped' })
    } else {
      postMessage({ status: 'batch-complete', currentNonce })
    }
  }

  mine()
}