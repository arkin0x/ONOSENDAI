import { useState, useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import { useAvatarStore } from '../store/AvatarStore'
import { useSectorStore } from '../store/SectorStore'

export function useAsyncTrailPoints(pubkey: string) {
  const [trailPoints, setTrailPoints] = useState<Vector3[]>([])
  const workerRef = useRef<Worker | null>(null)
  const { actionState } = useAvatarStore()
  const { userCurrentSectorId } = useSectorStore()

  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/TrailPointsWorker.ts', import.meta.url), { type: 'module' })

    workerRef.current.onmessage = (event: MessageEvent<number[][]>) => {
      const newPoints = event.data.map(point => new Vector3(point[0], point[1], point[2]))
      setTrailPoints(newPoints)
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