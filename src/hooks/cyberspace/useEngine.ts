import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { createUnsignedDriftAction, createUnsignedGenesisAction } from '../../libraries/Cyberspace'
import { RelayObject } from '../../types/NostrRelay'
import { setWorkerCallback, workzone } from '../../libraries/WorkerManager'
import { deserializeEvent, getNonceBounds, serializeEvent } from '../../libraries/Miner'
import { publishEvent } from '../../libraries/Nostr'
import { Event, UnsignedEvent } from 'nostr-tools'
import { updateHashpowerAllocation } from '../../libraries/HashpowerManager'

// New version of Engine.ts
const NONCE_OFFSET = 1_000_000

type EngineControls = {
  setGenesisAction: (genesis: Event) => void
  setLatestAction: (latest: Event) => void
  drift: (throttle: number, quaternion: THREE.Quaternion) => void
  stopDrift: () => void
}

export function useEngine(pubkey: string, relays: RelayObject): EngineControls {
  // FIXME logging relays so we don't get a warning
  // const [genesisAction, setGenesisAction] = useState<Event|null>(null)
  // const [latestAction, setLatestAction] = useState<Event|null>(null)
  const genesisActionRef = useRef<Event|null>(null)
  const latestActionRef = useRef<Event|null>(null)
  const allowDriftRef = useRef<boolean>(false)
  // const [chainHeight, setChainHeight] = useState<number>(0) // I don't know if we need this
  const throttleRef = useRef<number | null>(null)
  const quaternionRef = useRef<THREE.Quaternion | null>(null)
  const chainHeight = useRef<number>(0)

    useEffect(() => {
      console.log('Engine: useEffect', movementWorkerMessage)
      setWorkerCallback('movement', movementWorkerMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    },[])

  async function drift(throttle: number, quaternion: THREE.Quaternion): Promise<void> {
    if (allowDriftRef.current){
      allowDriftRef.current = false
      // proceed with function
      // we just mined a new action so we should allow a new drift
    } else {
      // if nothing else has changed, we don't need to do anything
      if (throttle === throttleRef.current && quaternionRef.current !== null && quaternion.equals(quaternionRef.current)) {
        // Arguments haven't changed, so do nothing
        console.log('Engine:drift: noop (state has not changed)')
        return
      }
    }

    // Update the refs with the new values
    // throttle
    if (throttle < 1) {
      stopDrift()
    }
    throttleRef.current = throttle
    quaternionRef.current = quaternion

    // Check if there is a latestAction
    if (!latestActionRef.current) {
      // No latestAction, so create and publish a genesisAction
      const genesisAction = createUnsignedGenesisAction(pubkey)
      const genesisActionPublished = await publishEvent(genesisAction, relays) // FIXME we would normally pass in `relays` here
      // TODO might need to verify the event was published successfully
      setGenesisAction(genesisActionPublished)
      setLatestAction(genesisActionPublished)
    } else if (genesisActionRef.current && latestActionRef.current) {
      // There is a latestAction, so create a new event to mine and dispatch it to the movement workers
      const action = createUnsignedDriftAction(pubkey, throttle, quaternion, genesisActionRef.current, latestActionRef.current)
      triggerMovementWorkers(action)
    }
  }

  function stopDrift(): void {
    stopMovementWorkers()
  }

  function triggerMovementWorkers(action: UnsignedEvent): void {
    const workers = workzone['movement']
    const actionCopySerialized = serializeEvent(action!)
    const nonceBounds = getNonceBounds(actionCopySerialized)
    // @NOTE: we are assuming the action does not contain characters that encode to more than one byte, or else the nonceBounds will be incorrect and the action binary will be corrupted.
    const actionBinary = new TextEncoder().encode(actionCopySerialized)
    const targetPOW = parseInt(action!.tags.find( tag => tag[0] === 'nonce')![2]) // this is controlled by the throttle value earlier.
    // post a command to all applicable workers
    let nonce = 0
    workers.forEach((worker, thread) => {
      worker.postMessage({
        command: 'start',
        data: {
          thread, // thread number
          threadCount: workers.length, // total number of threads
          nonceOffset: NONCE_OFFSET, // the range of nonces to check for this thread. Used to automatically self-update to the next nonce range once the current range is finished unless mining is stopped. 
          action: actionBinary,
          nonceBounds, // the indices in the action binary between which the nonce is contained
          nonceStartValue: nonce,
          nonceEndValue: nonce + NONCE_OFFSET,
          targetPOW,
          chainHeight
        }
      }) // end postMessage
      // increment the nonce for the next worker
      nonce += NONCE_OFFSET 
    })
  }

  function stopMovementWorkers() {
    const workers = workzone['movement']
    workers.forEach((worker) => {
      worker.postMessage({
        command: 'stop',
        data: {}
      })
    })
  }

  const movementWorkerMessage = (msg: MessageEvent) => {
    // if the worker reports 'pow-target-found', we need to stop all workers and publish the action
    console.log('Engine: movementWorkerMessage: ',msg)
    if (msg.data.status === 'pow-target-found' && msg.data.chainHeight.current === chainHeight.current) {
      console.log('Engine: movementWorkerMessage: pow-target-found')
      chainHeight.current += 1 // now any other mined events will be ignored because their chainHeight is lower; now we won't fork our chain.
      stopMovementWorkers()
      const actionBinary = msg.data.action
      const actionSerialized = new TextDecoder().decode(actionBinary)
      const action = deserializeEvent(actionSerialized)
      // publish the action
      // update the latestAction action with this action
      publishMovementAction(action)
    }
    // if the worker reports 'nonce-range-completed, do nothing.
  }

  async function publishMovementAction(action: UnsignedEvent): Promise<void> {
    const publishedAction = await publishEvent(action, relays) // FIXME we would normally pass in `relays` here
    setLatestAction(publishedAction)
  }

  function setGenesisAction(genesis: Event) {
    genesisActionRef.current = genesis
  }

  function setLatestAction(latest: Event) {
    allowDriftRef.current = true // we just mined a new action so we should allow a new drift
    latestActionRef.current = latest
  }

  return {setGenesisAction, setLatestAction, drift, stopDrift}
}


// setWorkerCallback('observation', observationWorkerMessage)
// setWorkerCallback('action', actionWorkerMessage)