import * as THREE from 'three'
import ObservationWorker from '../workers/MovementMiner.worker?worker'
import ActionWorker from '../workers/MovementMiner.worker?worker'
import MovementWorker from '../workers/MovementMiner.worker?worker'
import { Event } from 'nostr-tools'
import { Action, UnsignedAction, GenesisAction, LatestAction } from '../types/Cyberspace'
import { createUnsignedGenesisAction, isGenesisAction } from './Cyberspace'
import { IdentityType } from '../types/IdentityType'
import { RelayObject } from '../types/NostrRelay'

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

// The Engine must know the genesis action and latest action to add new actions to the chain. This state is tracked here. It is updated initially from what events are received by the cyberspaceStateReconciler, but after that it is only updated by the workerMessage() function to reflect the most up-to-date state from mining, unless a new genesis action is received, in which case the latest action is reset to false so it can start a new chain.
let genesisAction: GenesisAction = false
let latestAction: LatestAction = false
let identity: IdentityType = false
let relays: RelayObject = false

const updateGenesisAction = (action: GenesisAction) => {
  if (typeof action !== 'object') return

  if (typeof genesisAction === 'object') {
    // we have an existing genesis action.
    if (genesisAction.id !== action.id) {
      // we received a new genesis action, meaning we are starting our action chain over. Save the new genesis action and reset the latest action.
      genesisAction = action
      latestAction = false
    }
  } else {
    // we did not have an existing genesis action, so save whatever we were given.
    genesisAction = action
  }
}

const updateLatestAction = (action: LatestAction, initialize?: true) => {
  // this probably won't happen, but don't let latestAction be set to a non action value (false) via this function; it's ok if it is done manually elsewhere.
  if (typeof action !== 'object') return latestAction
  if (initialize === true && latestAction === false) {
    // save the latest action IFF latestAction is false. If it has already been defined, then it can only be updated by receiving a workerMessage with a newly created action; see the call to updateLatestAction in workerMessage(). This is to prevent the latest action from being overwritten by an older action in a move() call, as the cyberspaceStateReconciler may not have received the new action yet. So basically we only trust the first value we receive from our subscription as the application starts, and then we only trust what we mine after that.
    latestAction = action
  }
  if (initialize === true && latestAction !== false) {
    // do nothing
  }
  // always update the latestAction IFF initialize is not set
  if (!initialize){
    latestAction = action
  }
  return latestAction
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


export const move = (throttle: number, quaternion: THREE.Quaternion, genesisAction: GenesisAction, latestAction: LatestAction, id: IdentityType, rel: RelayObject) => {
  identity = id
  relays = rel
  issueWorkerCommand('movement', 'start', { throttle, quaternion, genesisAction, latestAction, pubkey: identity.pubkey })
}

export const stopMove = () => {
  issueWorkerCommand('movement', 'stop')
}

type WorkerCommandOptions = {
  attackTarget?: string, // hex pubkey
  throttle?: number
  quaternion?: THREE.Quaternion
  genesisAction: GenesisAction // NOT optional if options are defined
  latestAction: LatestAction // NOT optional if options are defined
  pubkey: string
}

// @TODO I could split issueWorkerCommand into multiple different functions and parts: update the latest action/genesis, issue an Movement command or Action command, etc.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const issueWorkerCommand = (target: HashpowerAllocationTarget, command: string, options?: WorkerCommandOptions ) => {
  console.log('issueworkercommand', target, options, command, workzone)
  let eventToMine: UnsignedAction | undefined
  if (options) {
    // save the genesis action
    updateGenesisAction(options.genesisAction)
    // this call to updateLatestAction is only successful in updating the latestAction the first time it runs -- when the application starts -- so we can initialize the latest action. After that, updateLatestAction is only successfully updated from workerMessage() when a new action is created by a worker. The latest action is set by this function's return value so that the next worker can use the latest action to create a new action.
    options.latestAction = updateLatestAction(options.latestAction, true)

    // Prepare the event to be sent to the workers for mining.
    // if genesis is true and latest is false, then we need to create a new genesis action.
    if (options.genesisAction === true && options.latestAction === false) {
      // LEFTOFF
      // send a fresh genesis action to be mined
      // It doesn't matter which hashpower/worker target we have here. The genesis action will be generic to any worker.
      eventToMine = createUnsignedGenesisAction(options.pubkey)
    } else {
      if (target === 'movement') {
        // LEFTOFF
        // create this function
        // eventToMine = createUnsignedDriftAction(options.pubkey)
      } else if (target === 'action') {
        // use command to create a new action
        if (command === 'derezz') {
          // eventToMine = createUnsignedDerezzAction(options.pubkey, command, )
        } else if (command === 'vortex') {
          //
        } else if (command === 'bubble') {
          //
        } else if (command === 'armor') {
          // create an armor event
        } else if (command === 'stealth') {
          //
        } else if (command === 'shout') {
          // this one doesn't go in the action chain
        } else if (command === 'noop') {
          // this should be an easy one - no mining required.
        }
      }
    }
  } else return
  // get all movement workers
  const workers = workzone[target]
  // post a command to start mining drift events to all movement workers
  workers.forEach((worker) => {
    worker.postMessage({
      command,
      ...(options ?? {}),
      eventToMine
    })
  })
}

const workerMessage = (event: MessageEvent) => {
  // Each worker will be calling this same function with completed actions. We need to make sure that the action is valid and that it references the most recent action; then we must update it synchronously so that the next worker can use the updated value.
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
    // update the latestAction action with this action
    updateLatestAction(event.data.action)
    // TODO: trigger workers to use new latestAction and genesisAction values
  }
}