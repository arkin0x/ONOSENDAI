import * as THREE from 'three'
import { createUnsignedDriftAction, createUnsignedGenesisAction } from './Cyberspace'
import { RelayObject } from '../types/NostrRelay'
import { getGenesisAction, getLatestAction, updateGenesisAction, updateLatestAction } from './ActionTracker'
import { setWorkerCallback, workzone } from './WorkerManager'
import { deserializeEvent, getNonceBounds, serializeEvent } from './Miner'
import { publishEvent } from './Nostr'
import { Event, UnsignedEvent } from 'nostr-tools'

// New version of Engine.ts
const NONCE_OFFSET = 1_000_000

// Define the state variables.
let _pubkey: string | null = null
let _relays: RelayObject | null = null
let _throttle: number | null = null
let _quaternion: THREE.Quaternion | null = null
let _movement: boolean = false
let _genesis: boolean = false // do we have a genesis action? If not, this is the first thing that will be created.
let _previousMovementActionToMine: UnsignedEvent | null = null
let _movementActionToMine: UnsignedEvent | null = null
let _movementActionNonce: number = 0 // set to 0 whenever we have a new action to mine.

// DEBUG ONLY
let _chainHeight: number = 0

function incrementChainHeight() {
  _chainHeight += 1
  console.log('chain height', _chainHeight)
}

// Define the setters for the state variables.
function setPubkey(value: string) {
  if (_pubkey === value) { // reject if the value is the same. Effectively memoizes the value.
    return
  }
  _pubkey = value
  updateMovementAction()
}

function setRelays(value: RelayObject) {
  if (_relays === value) {
    return
  }
  _relays = value
  updateMovementAction()
}

function setThrottle(value: number) {
  if (_throttle === value) {
    return
  }
  if (value < 1) {
    stopDrift()
  }
  _throttle = value
  updateMovementAction()
}

function setQuaternion(value: THREE.Quaternion) {
  if (_quaternion === value) {
    return
  }
  _quaternion = value
  updateMovementAction()
}

function toggleMovement(value: boolean) {
  if (_movement === value) {
    return
  }
  _movement = value
  updateMovementAction()
}

function createGenesisAction(): void {
  if (!_pubkey || !_relays) {
    return
  }
  // create a genesis action
  const action = createUnsignedGenesisAction(_pubkey)
  // publish it
  publishGenesisAction(action)
}

function setGenesisAction(genesis: Event) {
  updateGenesisAction(genesis)
  if (getLatestAction() === null) {
    updateLatestAction(genesis)
  }
  _genesis = true
  updateMovementAction()
}

function setLatestAction(latest: Event) {
  console.warn('setLatestAction', latest)
  updateLatestAction(latest)
  updateMovementAction()
}

function drift(throttle: number, quaternion: THREE.Quaternion): void {
  console.log('Engine:drift', _genesis)
  if (!_genesis) {
    console.log('create genesis action')
    createGenesisAction()
    return
  }
  setThrottle(throttle)
  setQuaternion(quaternion)
  if (!_movement) {
    toggleMovement(true)
  }
}

function stopDrift(): void {
  toggleMovement(false)
  stopMovementWorkers()
}

// it's OK if this is called all the time because the workers will only be triggered if the action to mine has changed, thanks to the memoization in setMovementActionToMine.
function updateMovementAction(): void {
  console.log('Engine:updateMovementAction', _movement && _pubkey && _throttle && _quaternion && _genesis)
  if (_movement && _pubkey && _throttle && _quaternion && _genesis) {
    const action = createUnsignedDriftAction(_pubkey, _throttle, _quaternion, getGenesisAction()!, getLatestAction()!)
    // we assert that getLatestAction() and getGenesisAction() are not null because _genesis is true
    setMovementActionToMine(action)
    triggerMovementWorkers()
  } 
}

// This essentially memoizes the action to mine so the workers don't get interrupted.
function setMovementActionToMine(action: UnsignedEvent): void {
  _previousMovementActionToMine = _movementActionToMine
  _movementActionToMine = action
}

function setMovementActionNonce(nonce: number): void {
  _movementActionNonce = nonce
}

function triggerMovementWorkers(): void {
  // memoized so we don't trigger the workers if the action is the same as the previous action.
  if (_movementActionToMine !== _previousMovementActionToMine) {
    const workers = workzone['movement']
    setMovementActionNonce(0)
    const actionCopySerialized = serializeEvent(_movementActionToMine!)
    const nonceBounds = getNonceBounds(actionCopySerialized)
    // @NOTE: we are assuming the action does not contain characters that encode to more than one byte, or else the nonceBounds will be incorrect and the action binary will be corrupted.
    const actionBinary = new TextEncoder().encode(actionCopySerialized)
    const targetPOW = parseInt(_movementActionToMine!.tags.find( tag => tag[0] === 'nonce')![2])
    // post a command to all applicable workers
    workers.forEach((worker, thread) => {
      worker.postMessage({
        command: 'start',
        data: {
          thread,
          threadCount: workers.length,
          nonceOffset: NONCE_OFFSET,
          action: actionBinary,
          nonceBounds,
          nonceStartValue: _movementActionNonce,
          nonceEndValue: _movementActionNonce + NONCE_OFFSET,
          targetPOW,
        }
      })
      setMovementActionNonce( _movementActionNonce + NONCE_OFFSET )
    })
  }
}

const stopMovementWorkers = () => {
  const workers = workzone['movement']
  workers.forEach((worker) => {
    worker.postMessage({
      command: 'stop',
      data: {}
    })
  })
}

const movementWorkerMessage = (event: MessageEvent) => {

  // if the worker reports 'pow-target-found', we need to stop all workers and publish the action
  
  if (event.data.status === 'pow-target-found') {
    incrementChainHeight()
    stopMovementWorkers()
    const actionBinary = event.data.action
    const actionSerialized = new TextDecoder().decode(actionBinary)
    const action = deserializeEvent(actionSerialized)
    // publish the action
    // update the latestAction action with this action
    publishMovementAction(action)
  }
  // if the worker reports 'nonce-range-completed, do nothing.
}

async function publishGenesisAction(action: UnsignedEvent): Promise<void> {
  const publishedAction = await publishEvent(action as UnsignedEvent, _relays as RelayObject)
  console.warn('genesis published:', publishedAction)
  updateGenesisAction(publishedAction)
  updateLatestAction(publishedAction) // the latest action IS the genesis action
  _genesis = true
}

async function publishMovementAction(action: UnsignedEvent): Promise<void> {
  const publishedAction = await publishEvent(action as UnsignedEvent, _relays as RelayObject)
  updateLatestAction(publishedAction)
}


setWorkerCallback('movement', movementWorkerMessage)
// setWorkerCallback('observation', observationWorkerMessage)
// setWorkerCallback('action', actionWorkerMessage)

// import into Avatar and initialize with the pubkey and relays to get the functions that can be called by the user interface.
export default function Engine(pubkey: string, relays: RelayObject): EngineControls {
  setPubkey(pubkey)
  setRelays(relays)

  return {setGenesisAction, setLatestAction, drift, stopDrift}
}

export type EngineControls = {
  setGenesisAction: (genesis: Event) => void
  setLatestAction: (latest: Event) => void
  drift: (throttle: number, quaternion: THREE.Quaternion) => void
  stopDrift: () => void
}