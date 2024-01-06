import * as THREE from 'three'
import { Action, UnsignedAction, GenesisAction, LatestAction } from '../types/Cyberspace'
import { createUnsignedDriftAction, createUnsignedGenesisAction, isGenesisAction } from './Cyberspace'
import { IdentityType } from '../types/IdentityType'
import { RelayObject } from '../types/NostrRelay'
import { getGenesisAction, getLatestAction, updateGenesisAction, updateLatestAction } from './ActionTracker'
import { update } from 'three/examples/jsm/libs/tween.module.js'
import { setWorkerCallback, workzone } from './WorkerManager'
import { getNonceBounds, serializeEvent } from './Miner'


// New version of Engine.ts

// Define the state variables.
let _pubkey: string | null = null
let _relays: RelayObject[] | null = null
let _throttle: number | null = null
let _quaternion: THREE.Quaternion | null = null
let _movement: boolean = false
let _genesis: boolean = false // do we have a genesis action? If not, this is the first thing that will be created.
let _previousMovementActionToMine: UnsignedAction | null = null
let _movementActionToMine: UnsignedAction | null = null

// Define the setters for the state variables.
function setPubkey(value: string) {
  if (_pubkey === value) { // reject if the value is the same. Effectively memoizes the value.
    return;
  }
  _pubkey = value;
  updateMovementAction();
}

function setRelays(value: RelayObject[]) {
  if (_relays === value) {
    return;
  }
  _relays = value;
  updateMovementAction();
}

function setThrottle(value: number) {
  if (_throttle === value) {
    return;
  }
  if (value < 1) {
    stopDrift()
  }
  _throttle = value;
  updateMovementAction();
}

function setQuaternion(value: THREE.Quaternion) {
  if (_quaternion === value) {
    return;
  }
  _quaternion = value;
  updateMovementAction();
}

function toggleMovement(value: boolean) {
  if (_movement === value) {
    return;
  }
  _movement = value;
  updateMovementAction();
}

function createGenesisAction(): void {
  if (!_pubkey) {
    return
  }
  // create a genesis action
  const action = createUnsignedGenesisAction(_pubkey)
  // publish it
  // ....... publishy stuff
  // TODO LEFTOFF
  updateGenesisAction(publishedAction)
  updateLatestAction(publishedAction) // the latest action IS the genesis action
  _genesis = true
  updateMovementAction();
}

function setGenesisAction(genesis: GenesisAction) {
  updateGenesisAction(genesis)
  _genesis = true
  updateMovementAction();
}

function setLatestAction(latest: LatestAction) {
  updateLatestAction(latest)
  updateMovementAction();
}

function drift(throttle: number, quaternion: THREE.Quaternion): void {
  if (!_genesis) {
    createGenesisAction();
    return
  }
  setThrottle(throttle);
  setQuaternion(quaternion);
  if (!_movement) {
    toggleMovement(true);
  }
}

function stopDrift(): void {
  toggleMovement(false);
}

// import into Avatar and initialize with the pubkey and relays to get the functions that can be called by the user interface.
export function Engine(pubkey: string, relays: RelayObject[]) {
  setPubkey(pubkey);
  setRelays(relays);

  return {setGenesisAction, setLatestAction, drift, stopDrift}
}

function updateMovementAction(): void {
  if (_movement && _pubkey && _throttle && _genesis) {
    const action = createUnsignedDriftAction(_pubkey, _throttle, getLatestAction()!, getGenesisAction()!)
    // we assert that getLatestAction() and getGenesisAction() are not null because _genesis is true
    setMovementActionToMine(action)
    triggerMovementWorkers()
  } 
}

function setMovementActionToMine(action: UnsignedAction): void {
  _previousMovementActionToMine = _movementActionToMine
  _movementActionToMine = action;
}

function triggerMovementWorkers(): void {
  if (_movementActionToMine !== _previousMovementActionToMine) {
    const workers = workzone['movement']
    const NONCE_OFFSET = 1_000_000
    let nonce = 0
    const actionCopySerialized = serializeEvent(_movementActionToMine!)
    const nonceBounds = getNonceBounds(actionCopySerialized)
    const actionBinary = new TextEncoder().encode(actionCopySerialized)
    const targetPOW = parseInt(_movementActionToMine!.tags.find( tag => tag[0] === 'nonce')![2])
    // post a command to all applicable workers
    workers.forEach((worker) => {
      worker.postMessage({
        command: 'start',
        data: {
          action: actionBinary,
          nonceBounds,
          nonceStartValue: nonce,
          nonceEndValue: nonce + NONCE_OFFSET,
          targetPOW,
        }
      })
      nonce += NONCE_OFFSET
    })
  }
}

// TODO rewrite this whole thing.
const movementWorkerMessage = (event: MessageEvent) => {
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
    // TODO: publish the action
    // update the latestAction action with this action
    updateLatestAction(event.data.action)
    // TODO: trigger workers to use new latestAction and genesisAction values
  }
}

setWorkerCallback('movement', movementWorkerMessage)