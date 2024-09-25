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

      console.log('POW', POW, 'targetPOW', targetPOW)

      if (POW >= targetPOW) {
        console.log('POW found', POW, 'targetPOW', targetPOW)
        const id = uint8ToHex(digest)
        self.postMessage({ status: 'pow-target-found', data: { shardEvent, nonceBounds, digest, id, currentNonce, POW }})
        active = false
        return
      }

      currentNonce++
      shardEvent = incrementNonceBuffer(shardEvent, nonceBounds[0], nonceBounds[1])
      setTimeout(mine, 0)
    } else if (!active) {
      self.postMessage({ status: 'stopped' })
    } else {
      self.postMessage({ status: 'batch-complete', data: { currentNonce }})
    }
  }

  mine()
}

export {} // This line is necessary to make it a module