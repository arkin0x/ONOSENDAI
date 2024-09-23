import { create } from 'zustand'
import { Quaternion } from 'three'
import { createUnsignedDriftAction, createUnsignedGenesisAction, nowIsAfterLatestAction } from '../libraries/Cyberspace'
import { setWorkerCallback, workzone } from '../libraries/WorkerManager'
import { deserializeEvent, getNonceBounds, serializeEvent } from '../libraries/Miner'
import { Event, UnsignedEvent } from 'nostr-tools'
import { useThrottleStore } from './ThrottleStore'
import { useAvatarStore } from './AvatarStore'
import useNDKStore from './NDKStore'

type EngineState = {
  pubkey: string | null
  chainHeight: number
  lastActionTime: number
  workersActive: boolean
  lastLatestActionId: string | null
  lastQuaternion: Quaternion | null
  lastThrottle: number | null
  setPubkey: (pubkey: string) => void
  drift: (quaternion: Quaternion) => Promise<void>
  stop: () => void
  freeze: () => Promise<void>
  hop: () => Promise<void>
  respawn: () => Promise<void>
}

const DEBOUNCE_INTERVAL = 100 // ms

export const useEngineStore = create<EngineState>((set, get) => ({
  pubkey: null,
  chainHeight: 0,
  publishEvent: null,
  lastActionTime: 0,
  workersActive: false,
  lastLatestActionId: null,
  lastQuaternion: null,
  lastThrottle: null,

  setPubkey: (pubkey) => set({ pubkey }),

  drift: async (quaternion: Quaternion) => {
    const { pubkey, lastActionTime, workersActive, lastLatestActionId, lastQuaternion, lastThrottle } = get()
    const currentTime = Date.now()

    if (!pubkey) return

    const throttle = useThrottleStore.getState().throttle
    const avatarStore = useAvatarStore.getState()
    const latest = avatarStore.getLatest(pubkey)

    const shouldTriggerWorkers = 
      !workersActive ||
      (latest && latest.id !== lastLatestActionId) ||
      !quaternion.equals(lastQuaternion || new Quaternion()) ||
      throttle !== lastThrottle

    if (shouldTriggerWorkers && currentTime - lastActionTime >= DEBOUNCE_INTERVAL) {
      set({ 
        lastActionTime: currentTime, 
        workersActive: true,
        lastLatestActionId: latest?.id || null,
        lastQuaternion: quaternion.clone(),
        lastThrottle: throttle
      })

      if (throttle < 1) {
        get().stop()
        return
      }

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
    }
  },

  freeze: async () => {
    // Implement freeze logic here
    // This could involve creating a freeze action and triggering workers
    console.log('Freeze action not implemented yet')
  },

  hop: async () => {
    // Implement hop logic here
    // This could involve creating a hop action and triggering workers
    console.log('Hop action not implemented yet')
  },

  stop: () => {
    stopMovementWorkers()
    set({ workersActive: false })
  },

  respawn: async () => {
    const { pubkey } = get()
    const { publishRaw } = useNDKStore.getState()

    if (!pubkey) return

    get().stop()

    const genesisAction = createUnsignedGenesisAction(pubkey)
    useAvatarStore.getState().dispatchActionState({ type: 'reset', pubkey })
    useAvatarStore.getState().dispatchActionState({ type: 'push', actions: [genesisAction], pubkey })
    const rawGenesis = await publishRaw(genesisAction)
    if (!rawGenesis) {
      throw new Error('Engine.respawn: failed to publish genesis action')
    }
    console.log('new genesis:', rawGenesis)
  }
}))

// Helper functions

function triggerMovementWorkers(action: UnsignedEvent) {
  const workers = workzone['movement']
  const actionCopySerialized = serializeEvent(action)
  const nonceBounds = getNonceBounds(actionCopySerialized)
  const actionBinary = new TextEncoder().encode(actionCopySerialized)
  const targetPOW = parseInt(action.tags.find(tag => tag[0] === 'nonce')![2])
  
  let nonce = 0
  const NONCE_OFFSET = 1_000_000

  workers.forEach((worker, thread) => {
    worker.postMessage({
      command: 'start',
      data: {
        thread: thread || 0,
        threadCount: workers.length,
        nonceOffset: NONCE_OFFSET,
        action: actionBinary,
        nonceBounds,
        nonceStartValue: nonce,
        nonceEndValue: nonce + NONCE_OFFSET,
        targetPOW,
        chainHeight: useEngineStore.getState().chainHeight
      }
    })
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

function movementWorkerMessage(msg: MessageEvent) {
  if (msg.data.status === 'pow-target-found' && msg.data.chainHeight === useEngineStore.getState().chainHeight) {
    useEngineStore.setState({ chainHeight: useEngineStore.getState().chainHeight + 1 })
    useEngineStore.getState().stop()
    const actionBinary = msg.data.action
    const actionSerialized = new TextDecoder().decode(actionBinary)
    const action = deserializeEvent(actionSerialized) as Event // it's actually an UnsignedEvent but UnsignedEvent type doesn't support the id property
    // add ID 
    action.id = msg.data.id
    // Dispatch the action to AvatarStore first
    useAvatarStore.getState().dispatchActionState({ type: 'push', actions: [action], pubkey: action.pubkey })
    // Then attempt to publish
    useNDKStore.getState().publishRaw(action)
  }
}

setWorkerCallback('movement', movementWorkerMessage)
