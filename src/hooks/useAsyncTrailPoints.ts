import { useState, useEffect, useRef } from 'react'
import { useAvatarStore } from '../store/AvatarStore'
import { useSectorStore } from '../store/SectorStore'

export function useAsyncTrailPoints(pubkey: string) {
  const [trailPoints, setTrailPoints] = useState<number[]>([])
  const [isReady, setIsReady] = useState(false)
  const workerRef = useRef<Worker | null>(null)
  const { actionState } = useAvatarStore()
  const { userCurrentSectorId } = useSectorStore()

  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/TrailPointsWorker.ts', import.meta.url), { type: 'module' })

    workerRef.current.onmessage = (event: MessageEvent<{ type: string, data?: number[] }>) => {
      if (event.data.type === 'points' && event.data.data) {
        setTrailPoints(event.data.data)
      } else if (event.data.type === 'calculationComplete') {
        setIsReady(true)
      }
    }

    return () => {
      workerRef.current?.terminate()
    }
  }, [])

  useEffect(() => {
    // console.log('action state changed?')
    const actions = actionState[pubkey] || []
    if (actions.length >= 2 && workerRef.current) {
      setIsReady(false)
      workerRef.current.postMessage({ actions, pubkey, userCurrentSectorId })
    } else {
      setTrailPoints([])
      setIsReady(true)
    }
  }, [actionState, pubkey, userCurrentSectorId])

  return { trailPoints, isReady }
}