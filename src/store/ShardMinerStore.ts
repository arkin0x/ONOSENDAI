import { create } from 'zustand'
import { CyberspaceShard } from './BuilderStore'
import { createUnsignedShardEvent } from '../libraries/ShardUtils'
import { serializeEvent, deserializeEvent, getNonceBounds } from '../libraries/Miner'
import { cyberspaceCoordinateFromHexString } from '../libraries/Cyberspace'
import useNDKStore from './NDKStore'
import { workzone, setWorkerCallback, updateHashpowerAllocation } from '../libraries/WorkerManager'
import { UnsignedEvent } from 'nostr-tools'


type ShardMinerState = {
  isMining: boolean
  progress: number
  startMining: (shard: CyberspaceShard, coordinateHex: string) => void
  stopMining: () => void
  calculateShardSize: (shard: CyberspaceShard) => number
}

export const useShardMinerStore = create<ShardMinerState>((set, get) => ({
  isMining: false,
  progress: 0,

  startMining: (shard, coordinateHex) => {
    updateHashpowerAllocation()
    const identity = useNDKStore.getState().getUser()
    const pubkey = identity?.pubkey
    if (!pubkey) {
      console.error('No pubkey found')
      return
    }
    // console.log('pubkey', pubkey)
    const coordinate = cyberspaceCoordinateFromHexString(coordinateHex)
    const unsignedEvent = createUnsignedShardEvent(shard, pubkey, coordinate)
    const serializedEvent = serializeEvent(unsignedEvent)
    console.log('serialized Event', serializedEvent)
    const nonceBounds = getNonceBounds(serializedEvent)
    const shardBinary = new TextEncoder().encode(serializedEvent)
    const targetPOW = get().calculateShardSize(shard)

    const workers = workzone['shardMining']
    if (workers.length === 0) {
      console.error('No shard mining workers available')
      return
    }

    workers.forEach((worker, index) => {
      worker.postMessage({
        command: 'start',
        data: {
          shardEvent: shardBinary,
          nonceBounds,
          nonceStartValue: index * (2 ** 32 / workers.length),
          nonceEndValue: (index + 1) * (2 ** 32 / workers.length) - 1,
          targetPOW,
        }
      })
    })

    set({ isMining: true, progress: 0 })
  },

  stopMining: () => {
    const workers = workzone['shardMining']
    workers.forEach(worker => {
      worker.postMessage({ command: 'stop' })
    })
    set({ isMining: false, progress: 0 })
  },

  calculateShardSize: (shard) => {
    const sum = shard.vertices.reduce((sum, vertex) => {
      return sum + Math.abs(vertex.position[0]) + Math.abs(vertex.position[1]) + Math.abs(vertex.position[2])
    }, 0)
    const pow = Math.ceil( Math.sqrt(sum) )
    return pow
  },

}))

function handleShardMinerMessage(event: MessageEvent) {
  const { status, data } = event.data
  console.log('shard miner message:', status, data)
  if (status === 'pow-target-found') {
    console.log()
    const shardEventDecoded = new TextDecoder().decode(data.shardEvent)
    const minedEvent = deserializeEvent(shardEventDecoded)
    const minedEventWithId = {
      ...minedEvent,
      id: data.id,
    }
    useNDKStore.getState().publishRaw(minedEventWithId as UnsignedEvent)
    useShardMinerStore.getState().stopMining()
  } else if (status === 'batch-complete') {
    const progress = (data.currentNonce / (2 ** 32)) * 100
    useShardMinerStore.setState({ progress })
  } else if (status === 'stopped') {
    console.log('shard miner stopped')
  }
}

setWorkerCallback('shardMining', handleShardMinerMessage)