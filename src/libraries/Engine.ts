import * as THREE from 'three'
import ObservationWorker from '../workers/MovementMiner.worker?worker'
import ActionWorker from '../workers/MovementMiner.worker?worker'
import MovementWorker from '../workers/MovementMiner.worker?worker'

type HashpowerAllocationTarget = 'observation' | 'movement' | 'action'

type HashpowerAllocation = {
  [key in HashpowerAllocationTarget]: number
}

const hashpowerAllocation: HashpowerAllocation = {
  'observation': 4,
  'movement': 5,
  'action': 1,
}

// This defines the worker types
type WorkerTypes = {
  'observation': typeof ObservationWorker
  'movement': typeof MovementWorker
  'action': typeof ActionWorker
}

// This defines where the workers live
type Workzone = {
  'observation': Worker[]
  'movement': Worker[]
  'action': Worker[]
}

const workerTypes: WorkerTypes = {
  'observation': ObservationWorker,
  'movement': MovementWorker,
  'action': ActionWorker,
}

// This is where the spawned workers live
const workzone: Workzone = {
  'observation': [],
  'movement': [],
  'action': [],
}

export const updateHashpowerAllocation = (newAllocation?: HashpowerAllocation) => {

  // call with no args to get the current allocation
  if (!newAllocation) {
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
  adjustLabor()

  return hashpowerAllocation
}

// Dispose and Spawn workers according to the hashpower allocation
const adjustLabor = () => {
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
      workzone[target] = workers.slice(numWorkersToDispose)
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
        workers.push(worker)
      }
    }
  })
}


export const move = (throttle: number, quaternion: THREE.Quaternion) => {
  // get all movement workers
  const movementWorkers = workzone['movement']
  // post a command to start mining drift events to all movement workers
  movementWorkers.forEach((worker) => {
    worker.postMessage({
      command: 'start',
      throttle,
      quaternion,
    })
  })
}

export const stopMove = () => {
  // get all movement workers
  const movementWorkers = workzone['movement']
  // post a command to stop mining
  movementWorkers.forEach((worker) => {
    worker.postMessage({
      command: 'stop',
    })
  })
}