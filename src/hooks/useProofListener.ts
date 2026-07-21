/**
 * useProofListener.ts — pipes proof worker messages into the store.
 */

import { useEffect } from 'react'
import { getProofWorker, type ProofResponse } from '../lib/workers'
import { useCyberspace } from '../store/useCyberspace'

export function useProofListener(): void {
  useEffect(() => {
    const worker = getProofWorker()
    const onMessage = (event: MessageEvent<ProofResponse>) => {
      useCyberspace.getState().applyProofMessage(event.data)
    }
    worker.addEventListener('message', onMessage)
    return () => worker.removeEventListener('message', onMessage)
  }, [])
}
