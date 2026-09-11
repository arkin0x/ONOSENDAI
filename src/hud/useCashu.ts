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
    // A new token starts from CHECKING, not from the last token's answer.
    if (cached && cached.at > 0) setState(cached.state)
    else setState('checking')
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

/** How long the compose box waits for the text to hold still before reading a token. */
export const SETTLE_MS = 500

export interface ComposeVerdict {
  /** The message may be placed. */
  ready: boolean
  /** What to say under the box, or nothing. */
  note: string | null
  tone: 'ok' | 'warn' | 'dim'
}

function hostOf(mint: string): string {
  try { return new URL(mint).host } catch { return mint }
}

/**
 * Whether a composed message may be placed, and what to say under the box.
 *
 * Nothing is decided while the text is still moving (`settled` false): the
 * button waits for the timer. Once still, a message without a token is
 * ready at once. One with a token is ready only if the token decodes and
 * its mint does not call it spent: a token that will not decode, or one
 * already redeemed or being spent, would publish a coin nobody can claim,
 * so the button stays off and the note says why. A mint that cannot be
 * reached is a warning, not a stop: the token reads, and placing it is the
 * writer's call.
 */
export function composeVerdict(settled: boolean, view: CashuView): ComposeVerdict {
  if (!settled) return { ready: false, note: null, tone: 'dim' }
  if (!view.found) return { ready: true, note: null, tone: 'dim' }
  if (!view.token) return { ready: false, tone: 'warn', note: 'This cashu token will not decode: it is cut short or malformed. Fix it or take it out before placing.' }
  const sats = `${view.token.amount.toLocaleString()} ${view.token.unit}`
  const host = hostOf(view.token.mint)
  switch (view.state) {
    case 'checking': return { ready: false, tone: 'dim', note: `Asking ${host} about this ${sats} token…` }
    case 'unclaimed': return { ready: true, tone: 'ok', note: `${sats}, unclaimed at ${host}.` }
    case 'redeemed': return { ready: false, tone: 'warn', note: `This ${sats} token was already redeemed at ${host}. Nobody could claim it.` }
    case 'pending': return { ready: false, tone: 'warn', note: `${host} says this ${sats} token is being spent right now. Wait, or use another.` }
    default: return { ready: true, tone: 'warn', note: `A ${sats} token that reads, but ${host} could not be reached to verify it. Placing it anyway is your call.` }
  }
}
