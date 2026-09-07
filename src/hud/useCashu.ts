/**
 * useCashu.ts - what a message's Cashu token holds, and whether it is still there.
 *
 * The STASH and the loot list ask this per message. The token is read once
 * per text; the mint is asked once a minute at most, shared across every
 * place the same token shows.
 */

import { useEffect, useState } from 'react'
import { checkCashuState, decodeCashuToken, findCashuToken, type CashuState, type CashuToken } from '../lib/cashu'

const RECHECK_MS = 60_000
const cache = new Map<string, { state: CashuState; at: number; pending: Promise<CashuState> | null }>()

export interface CashuView {
  token: CashuToken | null
  state: CashuState | 'checking'
}

/** Ask the mint, no more than once a minute per token. */
function stateOf(raw: string, token: CashuToken): Promise<CashuState> {
  const now = Date.now()
  const c = cache.get(raw)
  if (c?.pending) return c.pending
  if (c && now - c.at < RECHECK_MS) return Promise.resolve(c.state)
  const pending = checkCashuState(token).then((state) => { cache.set(raw, { state, at: Date.now(), pending: null }); return state })
  cache.set(raw, { state: c?.state ?? 'unknown', at: c?.at ?? 0, pending })
  return pending
}

export function useCashu(text: string | null | undefined): CashuView {
  const raw = findCashuToken(text)
  const [state, setState] = useState<CashuState | 'checking'>('checking')
  useEffect(() => {
    if (!raw) return
    const token = decodeCashuToken(raw)
    if (!token) { setState('unknown'); return }
    let live = true
    const cached = cache.get(raw)
    if (cached && cached.at > 0) setState(cached.state)
    void stateOf(raw, token).then((s) => { if (live) setState(s) })
    return () => { live = false }
  }, [raw])
  if (!raw) return { token: null, state: 'unknown' }
  return { token: decodeCashuToken(raw), state }
}

/** UNCLAIMED, REDEEMED, PENDING, CHECKING, or nothing to say. */
export function cashuStateLabel(state: CashuView['state']): string {
  return state === 'unclaimed' ? 'UNCLAIMED' : state === 'redeemed' ? 'REDEEMED' : state === 'pending' ? 'PENDING' : state === 'checking' ? 'CHECKING' : 'MINT?'
}
