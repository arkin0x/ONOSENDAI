import { sha256 } from '@noble/hashes/sha256'
import { incrementNonceBuffer, setNonceBuffer } from "../libraries/Miner"
import { countLeadingZeroesBin, uint8ToHex } from "../libraries/Hash"

let threadID = undefined
let threadCountNum = 0
let NONCE_OFFSET = 0
let active = false
let currentNonce = 0

self.onmessage = function(message) {
  const { command, data } = message.data
  if (data.thread) threadID = data.thread
  if (data.threadCount) threadCountNum = data.threadCount
  if (data.nonceOffset) NONCE_OFFSET = data.nonceOffset
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
  }, 2)
}

// called with the data needed to mine the next action in the chain
function initiateMining(data) {
  // console.log('worker',threadID,'starting')
  let {
    action,
    nonceBounds,
    nonceStartValue,
    nonceEndValue,
    targetPOW,
    chainHeight,
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
        // console.log('worker',threadID, 'pow',POW)
        const id = uint8ToHex(digest)
        postMessage({ thread: threadID, status: 'pow-target-found', action, nonceBounds, digest, id, currentNonce, POW, chainHeight })
        active = false
        return
      }

      currentNonce++

      action = incrementNonceBuffer(action, nonceBounds[0], nonceBounds[1])

      setTimeout(mine, 0)

      return

    } else if (!active) {
      console.log('worker',threadID,'stopped')
    }

    if (currentNonce > nonceEndValue) {
      console.log('worker',threadID,'finished')
      // figure out what the next nonce range will be for this worker based on our threadCount; use NONCE_OFFSET to change our starting point
      data.nonceStartValue += threadCountNum * NONCE_OFFSET
      data.nonceEndValue += data.nonceStartValue + NONCE_OFFSET
      // keep mining at new nonce range
      setTimeout(() => initiateMining(data), 1)
    }
  }

  mine()

}
