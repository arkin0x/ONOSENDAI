import ObservationWorker from '../workers/MovementMiner.worker?worker'
import ActionWorker from '../workers/MovementMiner.worker?worker'
import MovementWorker from '../workers/MovementMiner.worker?worker'
import { HashpowerAllocation, HashpowerAllocationTarget } from './HashpowerManager'

// This defines the worker types
type WorkerTypes = {
  'observation': typeof ObservationWorker
  'movement': typeof MovementWorker
  'action': typeof ActionWorker
}

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
    console.log('spawningworker')
    const target = key as HashpowerAllocationTarget
    const workers = workzone[target]
    const numWorkers = workers.length
    const targetAllocation = hashpowerAllocation[target]
    if (numWorkers < targetAllocation) {
      const numWorkersToSpawn = targetAllocation - numWorkers
      for (let i = 0; i < numWorkersToSpawn; i++) {
        const worker = new workerTypes[target]()
        // set up worker.onmessage here to listen for messages from the worker
        worker.onmessage = workerMessage
        workers.push(worker)
      }
    }
  })
}
