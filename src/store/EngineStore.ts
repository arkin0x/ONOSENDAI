// engineStore.ts
import create from 'zustand'
import { Quaternion } from 'three'
import { CyberspaceAction, createUnsignedDriftAction, createUnsignedGenesisAction, nowIsAfterLatestAction, validateCyberspaceAction } from './Cyberspace'
import { setWorkerCallback, workzone } from './WorkerManager'
import { deserializeEvent, getNonceBounds, serializeEvent } from './Miner'
import { Event, UnsignedEvent } from 'nostr-tools'
import { useThrottleStore } from './ThrottleStore'
import { useRotationStore } from './RotationStore'
import { useAvatarStore } from './AvatarStore'
import { NDKEvent } from '@nostr-dev-kit/ndk'

const NONCE_OFFSET = 1_000_000

type PublishEventFunction = (event: UnsignedEvent) => Promise<NDKEvent|false>

type EngineState = {
  pubkey: string | null
  chainHeight: number
  restartMiners: boolean
  publishEvent: PublishEventFunction | null
  setPublishEvent: (publishEvent: PublishEventFunction) => void
  setPubkey: (pubkey: string) => void
  drift: () => Promise<void>
  stopDrift: () => void
  freeze: () => void
  respawn: () => Promise<void>
}

export const useEngineStore = create<EngineState>((set, get) => ({
  pubkey: null,
  chainHeight: 0,
  restartMiners: false,
  publishEvent: null,

  setPubkey: (pubkey) => set({ pubkey }),
  setPublishEvent: (publishEvent) => set({ publishEvent }),

  drift: async () => {
    const { pubkey, restartMiners } = get()
    const throttle = useThrottleStore.getState().throttle
    const quaternion = useRotationStore.getState().rotation
    const avatarStore = useAvatarStore.getState()

    if (!pubkey) return

    if (restartMiners === false && throttle === useThrottleStore.getState().throttle && quaternion.equals(useRotationStore.getState().rotation)) {
      return
    }

    set({ restartMiners: false })

    if (throttle < 1) {
      get().stopDrift()
      return
    }

    const latest = avatarStore.getLatest(pubkey)
    const genesis = avatarStore.getGenesis(pubkey)

    if (!latest) {
      await get().respawn()
    } else if (genesis && latest) {
      if (nowIsAfterLatestAction(latest)) {
        const action = await createUnsignedDriftAction(pubkey, throttle, quaternion, genesis, latest)
        triggerMovementWorkers(action)
      } else {
        console.warn('Engine:drift: latestAction is not old enough to drift from')
      }
    }
  },

  stopDrift: () => {
    stopMovementWorkers()
    set({ restartMiners: true })
  },

  freeze: () => {
    // Implement freeze logic
  },

  respawn: async () => {
    const { pubkey, publishEvent } = get()
    if (!pubkey || !publishEvent) return

    get().stopDrift()
    set({ restartMiners: false })

    const genesisAction = createUnsignedGenesisAction(pubkey)
    const rawGenesis = await publishEvent(genesisAction)
    if (!rawGenesis) {
      throw new Error('Engine.drift: failed to publish genesis action')
    } else {
      useAvatarStore.getState().dispatchActionState({ type: 'reset', pubkey })
      useAvatarStore.getState().dispatchActionState({ type: 'push', actions: [rawGenesis], pubkey })
    }
    console.log('new genesis:', rawGenesis)
  }
}))

// Helper functions

function triggerMovementWorkers(action: UnsignedEvent) {
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
  const workers = workzone['movement']
  workers.forEach((worker) => {
    worker.postMessage({
      command: 'stop',
      data: {}
    })
  })
}

// Initialize engine
setWorkerCallback('movement', movementWorkerMessage)

function movementWorkerMessage(msg: MessageEvent) {
  if (msg.data.status === 'pow-target-found' && msg.data.chainHeight === useEngineStore.getState().chainHeight) {
    useEngineStore.setState({ chainHeight: useEngineStore.getState().chainHeight + 1 })
    stopMovementWorkers()
    const actionBinary = msg.data.action
    const actionSerialized = new TextDecoder().decode(actionBinary)
    const action = deserializeEvent(actionSerialized)
    const validated = validateCyberspaceAction(action)
    if (validated) {
      publishMovementAction(action)
    } else {
      console.error('Engine: movementWorkerMessage: action validation failed')
    }
  }
}

async function publishMovementAction(action: UnsignedEvent): Promise<void> {
  const publishEvent = useEngineStore.getState().publishEvent
  if (!publishEvent) {
    console.error('Engine: publishMovementAction: publishEvent function is not set')
    return
  }
  const publishedAction = await publishEvent(action)
  if (!publishedAction) {
    console.error('Engine: publishMovementAction: failed to publish action')
    return
  }
  const convertedAction = publishedAction as CyberspaceAction
  useAvatarStore.getState().dispatchActionState({ type: 'push', actions: [convertedAction], pubkey: action.pubkey })
  useEngineStore.setState({ restartMiners: true })
}

// You might need to implement or inject these functions:
// publishEvent