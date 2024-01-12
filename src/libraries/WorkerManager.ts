import ObservationWorker from '../workers/Miner.worker?worker'
import ActionWorker from '../workers/Miner.worker?worker'
import MovementWorker from '../workers/Miner.worker?worker'
import { HashpowerAllocation, HashpowerAllocationTarget } from './HashpowerManager'

// This defines the worker types
type WorkerTypes = {
  'observation': typeof ObservationWorker
  'movement': typeof MovementWorker
  'action': typeof ActionWorker
}

const workerTypes: WorkerTypes = {
  'observation': ObservationWorker,
  'movement': MovementWorker,
  'action': ActionWorker,
}

type Workzone = {
  'observation': Worker[]
  'movement': Worker[]
  'action': Worker[]
}

// This is where the spawned workers live
export const workzone: Workzone = {
  'observation': [],
  'movement': [],
  'action': [],
}

type WorkerCallbacks = {
  'observation': ((event: MessageEvent) => void) | (() => void)
  'movement': ((event: MessageEvent) => void) | (() => void)
  'action': ((event: MessageEvent) => void) | (() => void)
}

const workerCallbacks: WorkerCallbacks = {
  'observation': () => {},
  'movement': () => {},
  'action': () => {},
}

// Dispose and Spawn workers according to the hashpower allocation
export const adjustLabor = (hashpowerAllocation: HashpowerAllocation) => {
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
  workerCallbacks[target] = callback
}

// TODO: setObservationWorkerResponseCallback, setActionWorkerResponseCallback