/**
 * useProofListener.ts - pipes proof worker messages into the store.
 *
 * Registers a handler rather than listening on the worker instance, because
 * cancellation terminates and respawns the worker; the registry survives that.
 */

import { useEffect } from 'react'
import { preloadProofWorker, setProofHandler } from '../lib/workers'
import { useCyberspace } from '../store/useCyberspace'

const PRELOAD_DELAY_MS = 3000

export function useProofListener(): void {
  useEffect(() => {
    setProofHandler((msg) => useCyberspace.getState().applyProofMessage(msg))
    // After the start-up burst: nothing can hop in the first seconds anyway.
    const preload = setTimeout(preloadProofWorker, PRELOAD_DELAY_MS)
    return () => {
      clearTimeout(preload)
      setProofHandler(null)
    }
  }, [])
}
