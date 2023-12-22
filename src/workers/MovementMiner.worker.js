import { getConstructProofOfWork } from "../libraries/Hash"
import { sha256 } from '@noble/hashes/sha256'
import { incrementNonceBuffer } from "../libraries/Miner"
import { getTime } from "../libraries/Cyberspace"


/**
 * we've got to mine an event like this:
 * 
 * event = {
 *  pubkey: ...,
 *  kind: 333,
 *  created_at: Date.now(),
 *  content: '',
 *  tags: [
 *    ['nonce', '<current nonce>', '<target nonce>'],
 *    ['ms', '<milliseconds>'],
 *    ['C', '<cyberspace coordinate>'],
 *    ['quaternion', '<quaternion>'],
 *    ['velocity', '<velocity>'],
 *    ['A', 'drift'],
 *    ['version','1'],
 *    ['e', '<event id>', '<relay hint>', 'genesis'],
 *    ['e', '<event id>', '<relay hint>', 'previous'],
 *  ]
 * }
 */

let active = false

self.onmessage = function(message) {
  const { command, data } = message.data
  switch (command) {
    case 'start':
      active = true
      initiateMining(data)
      break
    case 'stop':
      active = false
      stopMining()
      break
  }
}

// called with the data needed to mine the next action in the chain
function initiateMining(data) {
  let {
    throttle,
    quaternion,
    genesisAction,
    latestAction,
    pubkey,
    eventToMine,
  } = data

  // LEFTOFF put new mining logic here

/**
 * ConstructMiner.worker.js
 * 1. receive message from main thread
 * 2. set starting nonce locally, set target work locally
 * 3. start mining loop
 * 3a. splice current nonce into serialized event
 * 3b. encode serialized event
 * 3c. digest encoded event
 * 3d. get construct proof of work
 * 4. if work is higher than current highest work, update highest work and send digest and completed work to main thread
 */

let highestWork = 0
let hash = null
let work = null
let start = null
let hashDurationBegin = null
  

function initiateMining(data){
  // let { serializedEvent, targetWork, targetHexBytes, nonce, createdAt, batch } = data
  let { 
    batch,
    binaryEvent,
    binaryTarget,
    createdAt,
    nonceBounds,
    nonceStart,
    targetWork,
    workerNumber,
  } = data

  let nonce = nonceStart
  highestWork = 0

  function mine() {

    start = performance.now()
    hashDurationBegin = start

    while(nonce < batch && active){

      binaryEvent = incrementNonceBuffer(binaryEvent, nonceBounds[0], nonceBounds[1])
      nonce++
      hash = sha256(binaryEvent)
      work = getConstructProofOfWork(hash, binaryTarget)

      if (work > highestWork) {
        highestWork = work
        // send highest work to main thread
        reportHighestWork(workerNumber, work, nonce, binaryEvent, hash, data )
        if (work >= targetWork) {
          // send completed work to main thread
          postMessage({
            status: 'complete',
            data: {
              workerNumber, work, nonce, createdAt, hash 
            },
          })
          active = false
        }
      }
      if (nonce % 1_000_000 === 0){
        reportHeartbeat(workerNumber, highestWork, nonce, createdAt, performance.now()-hashDurationBegin)
        hashDurationBegin = performance.now()
      }
    }

    batchComplete(workerNumber, work, nonce, createdAt, hash, performance.now()-start)
    active = false
  }

  mine()
}

function batchComplete(workerNumber, work, nonce, createdAt, hash, duration){
  postMessage({
    status: 'batchcomplete',
    data: {
      workerNumber, work, nonce, createdAt, hash, duration
    },
  })
}

function reportHeartbeat(workerNumber, work, nonce, createdAt, duration){
  postMessage({
    status: 'heartbeat',
    data: {
      workerNumber, work, nonce, createdAt, duration
    },
  })
}

function reportHighestWork(workerNumber, work, nonce, binaryEvent, hash, data){
  postMessage({
    status: 'newhigh',
    data: {
      ...data, workerNumber, work, nonce, binaryEvent, hash
    },
  })
}
