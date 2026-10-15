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
import { bytesToHex, sha256 } from 'cyberspace-core'
import { checkCashuState, decodeCashuToken, mintHost, readCashuToken, type CashuState, type CashuToken } from '../lib/cashu'

const RECHECK_MS = 60_000
const cache = new Map<string, { state: CashuState; at: number; pending: Promise<CashuState> | null }>()

/**
 * Redeemed is forever. A proof the mint has called SPENT never comes back, so
 * the answer is kept on this device, by a hash of the token rather than the
 * token itself, and a coin known to be spent is never asked about again: not
 * after a reload, and not when the scene remounts it. Since 2026-10-09 every
 * coin drawn in the world asks its mint once, so a field of old coins would
 * otherwise be a field of requests at every load.
 */
const SPENT_KEY = 'onosendai:cashu-redeemed'
/** How many spent tokens are remembered; the oldest go first. */
const SPENT_MAX = 2000

function tokenHash(raw: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(raw))).slice(0, 32)
}

function spentList(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SPENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Whether this device has heard the mint call this token redeemed. */
export function knownSpent(raw: string): boolean {
  return spentList().includes(tokenHash(raw))
}

function rememberSpent(raw: string): void {
  try {
    const hash = tokenHash(raw)
    const list = spentList().filter((h) => h !== hash)
    list.push(hash)
    localStorage.setItem(SPENT_KEY, JSON.stringify(list.slice(-SPENT_MAX)))
  } catch {
    // Storage is a convenience; the mint is still asked next time.
  }
}

export interface CashuView {
  /** A token is in the text: this message is a coin, readable or not. */
  found: boolean
  /** What the coin holds; null when found but this reader cannot decode it. */
  token: CashuToken | null
  /** `unreadable`: a token is there but cannot be decoded, so the mint cannot be asked. */
  state: CashuState | 'checking' | 'unreadable'
}

/**
 * Ask the mint, no more than once a minute per token, and never again once
 * it has said redeemed. A mint that cannot be reached answers `unknown`,
 * which never overwrites a definite answer already in hand: a coin the mint
 * once called redeemed does not turn back into a coin because the mint is
 * down this minute.
 */
function stateOf(raw: string, token: CashuToken): Promise<CashuState> {
  const now = Date.now()
  const c = cache.get(raw)
  if (c?.pending) return c.pending
  if (c && (c.state === 'redeemed' || now - c.at < RECHECK_MS)) return Promise.resolve(c.state)
  if (!c && knownSpent(raw)) {
    cache.set(raw, { state: 'redeemed', at: now, pending: null })
    return Promise.resolve('redeemed')
  }
  const pending = checkCashuState(token).then((fresh) => {
    const prior = cache.get(raw)?.state
    const state = fresh === 'unknown' && prior !== undefined && prior !== 'unknown' ? prior : fresh
    if (state === 'redeemed') rememberSpent(raw)
    cache.set(raw, { state, at: Date.now(), pending: null })
    return state
  })
  cache.set(raw, { state: c?.state ?? 'unknown', at: c?.at ?? 0, pending })
  return pending
}

/** What this device already knows about a token before the mint is asked. */
function priorState(raw: string | null): CashuState | 'checking' {
  if (!raw) return 'checking'
  const cached = cache.get(raw)
  if (cached && cached.at > 0) return cached.state
  return knownSpent(raw) ? 'redeemed' : 'checking'
}

export function useCashu(text: string | null | undefined): CashuView {
  const { raw, token } = readCashuToken(text)
  // A coin this device already knows is spent is spent from the first frame,
  // not orange until the mint is asked.
  const [state, setState] = useState<CashuState | 'checking'>(() => priorState(raw))
  useEffect(() => {
    if (!raw) return
    const token = decodeCashuToken(raw)
    if (!token) return
    let live = true
    // A new token starts from what is known of it, not from the last token's answer.
    setState(priorState(raw))
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
  const host = mintHost(view.token.mint)
  switch (view.state) {
    case 'checking': return { ready: false, tone: 'dim', note: `Asking ${host} about this ${sats} token…` }
    case 'unclaimed': return { ready: true, tone: 'ok', note: `${sats}, unclaimed at ${host}.` }
    case 'redeemed': return { ready: false, tone: 'warn', note: `This ${sats} token was already redeemed at ${host}. Nobody could claim it.` }
    case 'pending': return { ready: false, tone: 'warn', note: `${host} says this ${sats} token is being spent right now. Wait, or use another.` }
    default: return { ready: true, tone: 'warn', note: `A ${sats} token that reads, but ${host} could not be reached to verify it. Placing it anyway is your call.` }
  }
}
