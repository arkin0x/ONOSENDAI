import { useRef, useState } from 'react'
import * as THREE from 'three'
import { createUnsignedDriftAction, createUnsignedGenesisAction } from '../../libraries/Cyberspace'
import { RelayObject } from '../../types/NostrRelay'
import { getGenesisAction, getLatestAction, updateGenesisAction, updateLatestAction } from '../../libraries/ActionTracker'
import { setWorkerCallback, workzone } from '../../libraries/WorkerManager'
import { deserializeEvent, getNonceBounds, serializeEvent } from '../../libraries/Miner'
import { publishEvent } from '../../libraries/Nostr'
import { Event, UnsignedEvent } from 'nostr-tools'

// New version of Engine.ts
const NONCE_OFFSET = 1_000_000

export function useEngine(pubkey: string, relays: RelayObject) {
  const [quaternion, setQuaternionState] = useState<THREE.Quaternion|null>(null)
  const [throttle, setThrottleState] = useState<number>(0)
  const [genesisAction, setGenesisActionState] = useState<Event|null>(null)
  const [latestAction, setLatestActionState] = useState<Event|null>(null)
  const [chainHeight, setChainHeightState] = useState<number>(0)
  const [currentMovementActionToMine, setMovementActionToMineState] = useState<UnsignedEvent|null>(null)
  const [movementActionNonce, setMovementActionNonceState] = useState<number>(0)

  const throttleRef = useRef<number | null>(null)
  const quaternionRef = useRef<THREE.Quaternion | null>(null)

    // ... other code ...

  function drift(throttle: number, quaternion: THREE.Quaternion) {
    if (throttle === throttleRef.current && quaternionRef.current !== null && quaternion.equals(quaternionRef.current)) {
        // Arguments haven't changed, so do nothing
        return
      }

    // Update the refs with the new values
    throttleRef.current = throttle
    quaternionRef.current = quaternion

      // Check if there is a latestAction
      const latestAction = getLatestAction()
      if (!latestAction) {
        // No latestAction, so create and publish a genesisAction
        const genesisAction = createUnsignedGenesisAction(pubkey, throttle, quaternion)
        publishEvent(genesisAction)
        updateGenesisAction(genesisAction)
        incrementChainHeight()
        updateLatestAction(genesisAction)
      } else {
        // There is a latestAction, so create a new event to mine and dispatch it to the movement workers
        const action = createUnsignedDriftAction(pubkey, throttle, quaternion, getGenesisAction()!, latestAction)
        setMovementActionToMine(action)
        triggerMovementWorkers()
      }
    }

    return {
      // ... other returned variables and functions ...
      drift,
    }
  }

  return {setGenesisActionState, setLatestActionState, drift, stopDrift}
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
  console.warn('setGenesisAction', genesis)
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