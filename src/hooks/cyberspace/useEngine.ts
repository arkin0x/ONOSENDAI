import { useContext, useEffect, useRef, useState } from 'react'
import { Quaternion } from 'three'
import { createUnsignedDriftAction, createUnsignedGenesisAction, nowIsAfterLatestAction } from '../../libraries/Cyberspace'
import { RelayObject } from '../../types/NostrRelay'
import { setWorkerCallback, workzone } from '../../libraries/WorkerManager'
import { deserializeEvent, getNonceBounds, serializeEvent } from '../../libraries/Miner'
import { Event, UnsignedEvent } from 'nostr-tools'
import { AvatarContext } from '../../providers/AvatarContext'
import { NDKContext } from '../../providers/NDKProvider'

// New version of Engine.ts
const NONCE_OFFSET = 1_000_000

type EngineControls = {
  setGenesisAction: (genesis: Event) => void
  setLatestAction: (latest: Event) => void
  drift: (throttle: number, quaternion: Quaternion) => void
  stopDrift: () => void
  freeze: () => void
  respawn: () => void
}

export function useEngine(pubkey: string, relays: RelayObject): EngineControls {
  const {dispatchActionState} = useContext(AvatarContext)
  const [genesis, setGenesis] = useState<Event|null>(null)
  const [latest, setLatest] = useState<Event|null>(null)
  const {publishEvent} = useContext(NDKContext)
  const throttleRef = useRef<number | null>(null)
  const quaternionRef = useRef<Quaternion | null>(null)
  const chainHeight = useRef<number>(0)
  const restartMinersRef = useRef<boolean>(false)

  // debug reruns
  // console.log('/// ENGINE RERUN', genesis?.id.substring(0,8), latest?.id.substring(0,8))

  // initialize engine
  useEffect(() => {
    console.log('// Engine initialized')
    setWorkerCallback('movement', movementWorkerMessage)
    // setWorkerCallback('observation', observationWorkerMessage)
    // setWorkerCallback('action', actionWorkerMessage)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])

  async function drift(throttle: number, quaternion: Quaternion): Promise<void> {
    console.log('drift', throttle, quaternion.toArray().join(','))
    // if nothing else has changed, we don't need to do anything
    if (restartMinersRef.current === false && throttle === throttleRef.current && quaternionRef.current !== null && quaternion.equals(quaternionRef.current)) {
      // We don't need to restart the miners, and the arguments haven't changed, so do nothing.
      // console.log('Engine:drift: noop (state has not changed)')
      return
    }

    // Update the refs with the new values
    // throttle
    throttleRef.current = throttle
    quaternionRef.current = quaternion
    if (throttle < 1) { // note: negative throttle is not possible. To go in reverse (to slow down) you use the inverted quaternion with positive throttle.
      stopDrift()
      return
    }

    // Check if there is a latestAction
    // FIXME: is this a race condition? If we haven't received events from relays when this loads, it publishes a new action chain???
    if (!latest) {
      // No latestAction, so create and publish a genesisAction
      const genesisAction = createUnsignedGenesisAction(pubkey)
      const genesisActionPublished = await publishEvent(genesisAction) // FIXME we would normally pass in `relays` here
      if (!genesisActionPublished) {
        throw new Error('Engine.drift: failed to publish genesis action')
      } else {
        // set actions
        setGenesisAction(genesisActionPublished.rawEvent())
        setLatestAction(genesisActionPublished.rawEvent())
      }
    } else if (genesis && latest) {
      // determine if now is after the latestAction's created_at+ms
      if (nowIsAfterLatestAction(latest)) {
        // There is a latestAction, so create a new event to mine and dispatch it to the movement workers
        const action = await createUnsignedDriftAction(pubkey, throttle, quaternion, genesis, latest)
        triggerMovementWorkers(action)
        restartMinersRef.current = false
      } else {
        console.warn('Engine:drift: latestAction is not old enough to drift from')
      }
    }
  }

  async function respawn(): Promise<void> {
    console.log('respawn')
    stopDrift()
    restartMinersRef.current = false
    setGenesis(null)
    setLatest(null)
    const genesisAction = createUnsignedGenesisAction(pubkey)
    const genesisActionPublished = await publishEvent(genesisAction) // FIXME we would normally pass in `relays` here
    setGenesisAction(genesisActionPublished)
    setLatestAction(genesisActionPublished)
    console.log('new genesis:', genesisActionPublished)
    dispatchActionState({type: 'reset', pubkey: pubkey})
    dispatchActionState({type: 'push', actions: [genesisActionPublished], pubkey: pubkey})
  }

  function freeze(): void {
    // todo: implement freeze
    // this will be like drift but will mine an action with a type of 'freeze' instead of 'drift'
    // Freeze will be used to decay the avatar's velocity. The POW on the freeze event determines how much the velocity is decayed. This is useful because without freeze it would be nearly impossible to completely stop the avatar's movement.
  }

  function stopDrift(): void {
    stopMovementWorkers()
    restartMinersRef.current = true
  }

  function triggerMovementWorkers(action: UnsignedEvent): void {
    // console.log('workers starting')
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
          thread: thread || 0, // thread number
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
    // console.log('workers stopped')
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
    // console.log('Engine: movementWorkerMessage: ',msg)
    if (msg.data.status === 'pow-target-found' && msg.data.chainHeight.current === chainHeight.current) {
      // console.log('Engine: movementWorkerMessage: pow-target-found')
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
    // save the action to the AvatarContext
    dispatchActionState({type: 'push', actions: [publishedAction], pubkey: action.pubkey})
    restartMinersRef.current = true
  }

  function setGenesisAction(genesis: Event) {
    setGenesis(genesis)
  }

  function setLatestAction(latest: Event) {
    setLatest(latest)
  }

  return {setGenesisAction, setLatestAction, drift, stopDrift, freeze, respawn }
}


// setWorkerCallback('observation', observationWorkerMessage)
// setWorkerCallback('action', actionWorkerMessage)