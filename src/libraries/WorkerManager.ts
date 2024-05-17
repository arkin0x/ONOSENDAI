import ObservationWorker from '../workers/Miner.worker?worker'
import ActionWorker from '../workers/Miner.worker?worker'
import MovementWorker from '../workers/Miner.worker?worker'
import { HashpowerAllocation, HashpowerAllocationTarget } from './HashpowerManager'

export type HashpowerAllocationTarget = 'observation' | 'movement' | 'action'

export type HashpowerAllocation = {
  [key in HashpowerAllocationTarget]: number
}

type WorkerTypes = {
  [key in HashpowerAllocationTarget]: new () => Worker
}

const workerTypes: WorkerTypes = {
  'observation': ObservationWorker,
  'movement': MovementWorker,
  'action': ActionWorker,
}

type Workzone = {
  [key in HashpowerAllocationTarget]: Worker[]
}

// This is where the spawned workers live
export const workzone: Workzone = {
  'observation': [],
  'movement': [],
  'action': [],
}

type WorkerCallbacks = {
  [key in HashpowerAllocationTarget]: (event: MessageEvent) => void
}

const workerCallbacks: WorkerCallbacks = {
  'observation': () => {},
  'movement': () => {},
  'action': () => {},
}

const hashpowerAllocation: HashpowerAllocation = {
  'observation': 0,
  'movement': 10,
  'action': 0,
}


// Dispose and Spawn workers according to the hashpower allocation
export const adjustLabor = (hashpowerAllocation: HashpowerAllocation) => {
  console.log('adjustLabor called')
  // dispose of workers
  Object.keys(workzone).forEach((key) => {
    const target = key as HashpowerAllocationTarget
    const workers = workzone[target]
    const numWorkers = workers.length
    const targetAllocation = hashpowerAllocation[target]
    if (numWorkers > targetAllocation) {
      const numWorkersToDispose = numWorkers - targetAllocation
      const workersToDispose = workers.slice(0, numWorkersToDispose)
      workersToDispose.forEach((worker) => {
        worker.terminate()
      })
      workzone[target].splice(0, numWorkersToDispose) // delete the terminated workers but keep the array
    }
  })
  // spawn workers
  Object.keys(workzone).forEach((key) => {
    const target = key as HashpowerAllocationTarget
    const workers = workzone[target]
    const numWorkers = workers.length
    const targetAllocation = hashpowerAllocation[target]
    if (numWorkers < targetAllocation) {
      const numWorkersToSpawn = targetAllocation - numWorkers
      for (let i = 0; i < numWorkersToSpawn; i++) {
        const worker = new workerTypes[target]()
        // set up worker.onmessage here to listen for messages from the worker
        worker.onmessage = workerCallbacks[target]
        workers.push(worker)
      }
    }
  })
}

// use this to set what happens when a movement worker sends a message
export function setWorkerCallback(target: HashpowerAllocationTarget, callback: (event: MessageEvent) => void) {
  console.log('setWorkerCallback called')
  workerCallbacks[target] = callback
  adjustLabor(hashpowerAllocation) // reassigns the callbacks to the workers
}

// change hashpower allocation and then trigger adjustLabor
export const updateHashpowerAllocation = (newAllocation?: HashpowerAllocation) => {
  console.log('updateHashpowerAllocation called')

  // call with no args to return previous 
  if (!newAllocation) {
    adjustLabor(hashpowerAllocation)
    return hashpowerAllocation
  }

  // ensure that the new allocation is valid
  // test that the correct keys are being used
  const validKeys = ['observation', 'movement', 'action']
  const newAllocationKeys = Object.keys(newAllocation)
  const keysAreValid = newAllocationKeys.every((key) => validKeys.includes(key))
  // test that every value is a number
  const valuesAreValid = Object.values(newAllocation).every((value) => typeof value === 'number' && isNaN(value) === false)
  if (!keysAreValid || !valuesAreValid) {
    console.warn('Invalid hashpower allocation key received.')
    return hashpowerAllocation // just return the previous allocation
  }

  // validate that the sum of the new allocation is 10
  const sum = Object.values(newAllocation).reduce((a, b) => a + b, 0)
  if (sum !== 10) {
    console.warn('Invalid hashpower allocation sum received.')
    return hashpowerAllocation // just return the previous allocation
  }

  // copy new values into hashpowerAllocation
  Object.keys(newAllocation).forEach((key) => {
    const target = key as HashpowerAllocationTarget
    hashpowerAllocation[target] = newAllocation[target] as number
  })

  // update thermodynamic posture
  adjustLabor(hashpowerAllocation)

  return hashpowerAllocation
}

// TODO: setObservationWorkerResponseCallback, setActionWorkerResponseCallback