import * as THREE from 'three'
import ObservationWorker from '../workers/MovementMiner.worker?worker'
import ActionWorker from '../workers/MovementMiner.worker?worker'
import MovementWorker from '../workers/MovementMiner.worker?worker'
import { Event } from 'nostr-tools'
import { Action, GenesisAction, LatestAction, genesisAction } from '../types/Cyberspace'
import { isGenesisAction } from './Cyberspace'

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

// keep a list of all actions produced by the Engine
// The most recent action is the last in the array; it needs to be
// referenced by any new actions.
let genesisAction: GenesisAction = false
let latestAction: LatestAction = false

const updateGenesisAction = (action: GenesisAction, initialize?: true) => {
  // if initialize is set and genesisAction is false, update it only this time
  if (initialize && genesisAction === false) {
    genesisAction = action
    return
  }
  // always update the genesisAction if initialize is not set
  if (!initialize){
    genesisAction = action
  }
}

const updateLatestAction = (action: LatestAction, initialize?: true) => {
  // if initialize is set and latestAction is false, update it only this time
  if (initialize && latestAction === false) {
    latestAction = action
    return
  }
  // always update the latestAction if initialize is not set
  if (!initialize){
    latestAction = action
  }
}

export const updateHashpowerAllocation = (newAllocation?: HashpowerAllocation) => {

  // call with no args to get the current allocation
  if (!newAllocation) {
    adjustLabor()
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
        worker.onmessage = workerMessage
        workers.push(worker)
      }
    }
  })
}


export const move = (throttle: number, quaternion: THREE.Quaternion, genesisAction: GenesisAction, latestAction: LatestAction) => {
  issueWorkerCommand('movement', 'start', { throttle, quaternion, genesisAction, latestAction })
}

export const stopMove = () => {
  issueWorkerCommand('movement', 'stop')
}

type WorkerCommandOptions = {
  throttle?: number
  quaternion?: THREE.Quaternion
  genesisAction: GenesisAction // NOT optional if options are defined
  latestAction: LatestAction // NOT optional if options are defined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const issueWorkerCommand = (target: HashpowerAllocationTarget, command: string, options?: WorkerCommandOptions ) => {
  if (options) {
    // save the genesis action
    updateGenesisAction(options.genesisAction)
    // save the latest actions IFF it is false. If it has already been defined, then it can only be updated by receiving a workerMessage with a newly created action. This is to prevent the latest action from being overwritten by an older action by a move() call, as the cyberspaceStateReconciler may not have received the new action yet. So basically we only trust the first value we receive as the application starts, and then we only trust what we publish after that.
    updateLatestAction(options.latestAction, true)
  }
  // get all movement workers
  const workers = workzone[target]
  // post a command to start mining drift events to all movement workers
  workers.forEach((worker) => {
    worker.postMessage({
      command,
      ...(options ?? {}),
    })
  })
}

const workerMessage = (event: MessageEvent) => {
  // TODO: we must be receiving a fully formed Event from the worker, or do we need to parse the action binary into an Event? How should this work be split up?
  if (event.data.action) {
    // make sure the completed unit references the most recent action
    if (latestAction) {
      // there is a previous action, which also means that the newly created action is not a genesis action
      const latestActionID = latestAction.id
      const referenceToLatest = event.data.action.tags.find((tag: string[]) => tag[0] === 'e' && tag[3] === 'genesis')![1]
      if (latestActionID !== referenceToLatest) {
        console.warn('The completed action does not reference the most recent action. The state is not properly managed!')
        // So which is wrong: the worker thread or the latestActionID? Most likely the worker thread since it receives information last.
        // hopefully this warning just never happens because we manage state properly.
        return // dump the action
      }
      // 
    } else {
      // there is no previous action, which means that the newly created action is a genesis action
      // make sure it is a genesis action
      if (!isGenesisAction(event.data.action)) {
        console.warn('The completed action should be a genesis event but it is not! The state is not properly managed!')
        return // dump the action
      }
    }
    // OK, the action is valid.
    // LEFTOFF
    // TODO: publish the action
    // TODO: update the latestAction action with this action
    updateLatestAction(event.data.action)
    // TODO: trigger workers to use new latestAction and genesisAction values
  }
}