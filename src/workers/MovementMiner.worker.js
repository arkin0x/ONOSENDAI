import { sha256 } from '@noble/hashes/sha256'
import { incrementNonceBuffer, incrementNonceBufferBy, setNonceBuffer } from "../libraries/Miner"
import { countLeadingZeroesBin } from "../libraries/Hash"

let threadID = undefined
let threadCountNum = 0
let NONCE_OFFSET = 0
let active = false
let currentNonce = 0

self.onmessage = function(message) {
  const { thread, threadCount, nonceOffset, command, data } = message.data
  threadID = thread
  threadCountNum = threadCount
  NONCE_OFFSET = nonceOffset
  switch (command) {
    case 'start':
      safeInterrupt(data)
      break
    case 'stop':
      active = false
      break
  }
}

// if we call 'start' while mining, we need to stop mining, wait a tick, then start again to allow the previous mining loop to finish
function safeInterrupt(data) {
  active = false
  setTimeout(() => {
    active = true
    initiateMining(data)
  }, 1)
}

// called with the data needed to mine the next action in the chain
function initiateMining(data) {
  let {
    action,
    nonceBounds,
    nonceStartValue,
    nonceEndValue,
    targetPOW,
  } = data

  currentNonce = nonceStartValue

  // get binary nonce to start value

  action = setNonceBuffer(action, nonceBounds[0], nonceBounds[1], nonceStartValue)

  // start mining loop
  function mine(){
    if (active && currentNonce <= nonceEndValue) {

      let digest = sha256(action)
      let POW = countLeadingZeroesBin(digest)

      if (POW === targetPOW) {
        postMessage({ thread: threadID, status: 'pow-target-found', data: { action, digest, POW } })
        active = false
        return
      }

      currentNonce++

      action = incrementNonceBuffer(action, nonceBounds[0], nonceBounds[1])

      setTimeout(mine, 0)

      return

    }

    if (currentNonce > nonceEndValue) {
      // figure out what the next nonce range will be based on our threadID and threadCount; use NONCE_OFFSET to change our starting point
      data.nonceStartValue = data.nonceStartValue + threadCountNum * NONCE_OFFSET
      data.nonceEndValue += data.nonceStartValue + NONCE_OFFSET
      initiateMining // LEFTOFF
    }
  }

  mine()

}
