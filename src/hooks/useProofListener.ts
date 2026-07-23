/**
 * useProofListener.ts - pipes proof worker messages into the store.
 *
 * Registers a handler rather than listening on the worker instance, because
 * cancellation terminates and respawns the worker; the registry survives that.
 */

import { useEffect } from 'react'
import { setProofHandler } from '../lib/workers'
import { useCyberspace } from '../store/useCyberspace'

export function useProofListener(): void {
  useEffect(() => {
    setProofHandler((msg) => useCyberspace.getState().applyProofMessage(msg))
    return () => setProofHandler(null)
  }, [])
}
