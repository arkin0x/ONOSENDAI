import { create } from 'zustand'
import { CyberspaceShard } from './BuilderStore'
import { createUnsignedShardEvent } from '../libraries/ShardUtils'
import { serializeEvent, deserializeEvent, getNonceBounds } from '../libraries/Miner'
import { cyberspaceCoordinateFromHexString } from '../libraries/Cyberspace'
import useNDKStore from './NDKStore'

type ShardMinerState = {
  isMining: boolean
  progress: number
  startMining: (shard: CyberspaceShard, pubkey: string, coordinateHex: string) => void
  stopMining: () => void
  calculateShardSize: (shard: CyberspaceShard) => number
}

export const useShardMinerStore = create<ShardMinerState>((set, get) => ({
  isMining: false,
  progress: 0,

  startMining: (shard, pubkey, coordinateHex) => {
    const coordinate = cyberspaceCoordinateFromHexString(coordinateHex)
    const unsignedEvent = createUnsignedShardEvent(shard, pubkey, coordinate)
    const serializedEvent = serializeEvent(unsignedEvent)
    const nonceBounds = getNonceBounds(serializedEvent)
    const targetPOW = get().calculateShardSize(shard)

    console.log('Starting mining', shard, 'target POW:', targetPOW)

    const worker = new Worker(new URL('../workers/ShardMiner.worker.js', import.meta.url))

    worker.onmessage = (event) => {
      if (event.data.status === 'pow-target-found') {
        const minedEvent = deserializeEvent(event.data.shardEvent)
        minedEvent.id = event.data.id
        useNDKStore.getState().publishRaw(minedEvent)
        set({ isMining: false, progress: 100 })
        worker.terminate()
      } else if (event.data.status === 'batch-complete') {
        set({ progress: (event.data.currentNonce / (2 ** 32)) * 100 })
      }
    }

    worker.postMessage({
      command: 'start',
      data: {
        shardEvent: serializedEvent,
        nonceBounds,
        nonceStartValue: 0,
        nonceEndValue: 2 ** 32 - 1,
        targetPOW,
      }
    })

    set({ isMining: true, progress: 0 })
  },

  stopMining: () => {
    // Logic to stop the worker
    set({ isMining: false, progress: 0 })
  },

  calculateShardSize: (shard) => {
    return shard.vertices.reduce((sum, vertex) => {
      return sum + Math.abs(vertex.position[0]) + Math.abs(vertex.position[1]) + Math.abs(vertex.position[2])
    }, 0)
  },

}))