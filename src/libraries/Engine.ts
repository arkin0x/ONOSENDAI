import * as THREE from 'three'
import { Action, UnsignedAction, GenesisAction, LatestAction } from '../types/Cyberspace'
import { createUnsignedDriftAction, createUnsignedGenesisAction, isGenesisAction } from './Cyberspace'
import { IdentityType } from '../types/IdentityType'
import { RelayObject } from '../types/NostrRelay'
import { getGenesisAction, getLatestAction, initializeGenesisAction, updateLatestAction } from './ActionTracker'

// New version of Engine.ts

// Define the state variables.
let _pubkey: string | null = null
let _relays: RelayObject[] | null = null
let _throttle: number | null = null
let _quaternion: THREE.Quaternion | null = null
let _movement: boolean = false
let _genesis: boolean = false // do we have a genesis action? If not, this is the first thing that will be created.
let _movementAction: UnsignedAction | null = null

// Define the setters for the state variables.
function setPubkey(value: string) {
  _pubkey = value;
  updateMovementAction();
}

function setRelays(value: RelayObject[]) {
  _relays = value;
  updateMovementAction();
}

function setThrottle(value: number) {
  if (value < 1) {
    stopDrift()
  }
  _throttle = value;
  updateMovementAction();
}

function setQuaternion(value: THREE.Quaternion) {
  _quaternion = value;
  updateMovementAction();
}

function toggleMovement(value: boolean) {
  _movement = value;
  updateMovementAction();
}

function setActions(latest: LatestAction, genesis: GenesisAction) {
  updateLatestAction(latest)
  initializeGenesisAction(genesis)
  _genesis = true
}

export function Engine(pubkey: string, relays: RelayObject[]) {
  setPubkey(pubkey);
  setRelays(relays);

  return {setActions, drift, stopDrift}
}

function drift(throttle: number, quaternion: THREE.Quaternion): void {
  setThrottle(throttle);
  setQuaternion(quaternion);
  if (!_movement) {
    toggleMovement(true);
  }
}

function stopDrift(): void {
  toggleMovement(false);
}

function setMovementAction(action: UnsignedAction): void {
  _movementAction = action;
  // trigger update to movement workers TODO LEFTOFF
}

function updateMovementAction(): void {
  if (_movement && _pubkey && _genesis) {
    const action = createUnsignedDriftAction(_pubkey, getLatestAction()!, getGenesisAction()!)
    setMovementAction(action)
  }
}
// Define the functions that can be called by the user interface



  // increment the nonce offset by 1_000_000 and send to each worker

  // @TODO this logic can mark the worker as "busy" and the worker can mark itself as "not busy" in a response message. Then this worker busyness state can be ready by Engine to prevent duplicate requests.


  // send data to workers
  const workers = workzone[target]
  // post a command to all applicable workers
  workers.forEach((worker) => {
    worker.postMessage({
      command,
      data: {
        ...(options ?? {}),
      }
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