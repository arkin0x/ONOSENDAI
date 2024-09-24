import { useState, useEffect, useRef } from 'react'
import { useAvatarStore } from '../store/AvatarStore'
import { useSectorStore } from '../store/SectorStore'

export function useAsyncTrailPoints(pubkey: string) {
  const [trailPoints, setTrailPoints] = useState<number[]>([])
  const workerRef = useRef<Worker | null>(null)
  const { actionState } = useAvatarStore()
  const { userCurrentSectorId } = useSectorStore()

  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/TrailPointsWorker.ts', import.meta.url), { type: 'module' })

    workerRef.current.onmessage = (event: MessageEvent<number[]>) => {
      setTrailPoints(event.data)
    }

    return () => {
      workerRef.current?.terminate()
    }
  }, [])

  useEffect(() => {
    const actions = actionState[pubkey] || []
    if (actions.length >= 2 && workerRef.current) {
      workerRef.current.postMessage({ actions, pubkey, userCurrentSectorId })
    } else {
      setTrailPoints([])
    }
  }, [actionState, pubkey, userCurrentSectorId])

  return trailPoints
}