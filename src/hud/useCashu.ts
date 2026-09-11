/**
 * useCashu.ts - what a message's Cashu token holds, and whether it is still there.
 *
 * The STASH and the loot list ask this per message. The token is read once
 * per text; the mint is asked once a minute at most, shared across every
 * place the same token shows.
 *
 * Found and read are two different questions. A message is a coin when a
 * token is in it (`found`), whether or not this reader can decode it; what
 * it holds (`token`) and the mint's answer (`state`) come only from a token
 * that reads. One that does not is UNREADABLE, never a plain message.
 */

import { useEffect, useState } from 'react'
import { checkCashuState, decodeCashuToken, readCashuToken, type CashuState, type CashuToken } from '../lib/cashu'

const RECHECK_MS = 60_000
const cache = new Map<string, { state: CashuState; at: number; pending: Promise<CashuState> | null }>()

export interface CashuView {
  /** A token is in the text: this message is a coin, readable or not. */
  found: boolean
  /** What the coin holds; null when found but this reader cannot decode it. */
  token: CashuToken | null
  /** `unreadable`: a token is there but cannot be decoded, so the mint cannot be asked. */
  state: CashuState | 'checking' | 'unreadable'
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
  const { raw, token } = readCashuToken(text)
  const [state, setState] = useState<CashuState | 'checking'>('checking')
  useEffect(() => {
    if (!raw) return
    const token = decodeCashuToken(raw)
    if (!token) return
    let live = true
    const cached = cache.get(raw)
    if (cached && cached.at > 0) setState(cached.state)
    void stateOf(raw, token).then((s) => { if (live) setState(s) })
    return () => { live = false }
  }, [raw])
  if (!raw) return { found: false, token: null, state: 'unknown' }
  return { found: true, token, state: token ? state : 'unreadable' }
}

/** UNCLAIMED, REDEEMED, PENDING, CHECKING, UNREADABLE, or nothing to say. */
export function cashuStateLabel(state: CashuView['state']): string {
  return state === 'unclaimed' ? 'UNCLAIMED' : state === 'redeemed' ? 'REDEEMED' : state === 'pending' ? 'PENDING' : state === 'checking' ? 'CHECKING' : state === 'unreadable' ? 'UNREADABLE' : 'MINT?'
}
