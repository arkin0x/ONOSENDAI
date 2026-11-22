/**
 * signerActivity.ts: whether a remote signer (NIP-46) is answering, read from
 * what it really did: each request this device sent it, and each answer that
 * came back. Nothing here sends anything.
 *
 * Kept per session, by the client key of the session (Signer.session): a
 * phone that paired a signer twice has two client keys, and an answer to the
 * old one says nothing about the new one (arkinox, 2026-11-21: his phone kept
 * asking a signer that had moved to a tablet, and nothing on screen said so).
 *
 * A request counts as asked once nostr-tools has it; one the size guard
 * (signerRequestSize.ts) holds back, or asks about first, is not counted
 * until it goes. An answer is anything the signer sent back for a request, a
 * refusal included: a signer that says no is still there. A request that
 * failed on the way (no relay took it) is no answer.
 */

import { create } from 'zustand'
import { SIGN_PATIENCE_MS } from './signWithin'

export interface SignerActivity {
  /** When the last request was sent (ms), or null before any. */
  askedAt: number | null
  /** When the signer last answered (ms), or null before any answer. */
  answeredAt: number | null
  /** When the oldest request still without an answer was sent (ms), or null when none waits. */
  waitingSince: number | null
  /**
   * When a signature this device needed ran out of time with this signer
   * (ms): a move, an upload, a message. What the "not answering" chip keys
   * on, until the signer answers again.
   */
  stuckAt: number | null
  /**
   * This signer answered a request bigger than some signer apps can read
   * (signerRequestSize.ts): it handles big messages, so it is not warned
   * about them again in this session.
   */
  readsBig: boolean
  /**
   * When a signature waiting on such a big request, sent anyway, ran out of
   * time (ms): what the "may not handle messages this big" chip keys on,
   * until a big request is answered or the chip is put away.
   */
  bigSilentAt: number | null
}

const EMPTY: SignerActivity = { askedAt: null, answeredAt: null, waitingSince: null, stuckAt: null, readsBig: false, bigSilentAt: null }

interface ActivityState {
  bySession: Record<string, SignerActivity>
}

export const useSignerActivity = create<ActivityState>(() => ({ bySession: {} }))

/** One session's activity; the empty record when it has none. */
export function activityOf(session: string | null | undefined): SignerActivity {
  if (!session) return EMPTY
  return useSignerActivity.getState().bySession[session] ?? EMPTY
}

function update(session: string, change: (a: SignerActivity) => SignerActivity): void {
  const now = useSignerActivity.getState().bySession
  useSignerActivity.setState({ bySession: { ...now, [session]: change(now[session] ?? EMPTY) } })
}

/** Requests still waiting for an answer, by session: when each was sent. */
const waiting = new Map<string, Set<number>>()

function oldest(set: Set<number> | undefined): number | null {
  if (!set || set.size === 0) return null
  let min = Infinity
  for (const t of set) if (t < min) min = t
  return min
}

/** A request went out. Returns its token, handed back when it settles. */
function asked(session: string): number {
  const at = Date.now()
  let set = waiting.get(session)
  if (!set) { set = new Set(); waiting.set(session, set) }
  // Two requests in one millisecond still count as two.
  let token = at
  while (set.has(token)) token += 0.001
  set.add(token)
  update(session, (a) => ({ ...a, askedAt: at, waitingSince: oldest(set) }))
  return token
}

/**
 * The signer answered the request sent at `token`. Every request sent before
 * it and still waiting is given up as lost: the signer is plainly there, and
 * a request it never answered went astray on the way (a socket that died).
 */
function answered(session: string, token: number): void {
  const set = waiting.get(session)
  if (set) for (const t of [...set]) if (t <= token) set.delete(t)
  update(session, (a) => ({ ...a, answeredAt: Date.now(), waitingSince: oldest(set), stuckAt: null }))
}

/** The request sent at `token` failed on the way: no answer, and nothing waits on it any more. */
function lost(session: string, token: number): void {
  const set = waiting.get(session)
  set?.delete(token)
  update(session, (a) => ({ ...a, waitingSince: oldest(set) }))
}

interface Requester {
  sendRequest: (method: string, params: string[]) => Promise<string>
}
const tracked = new WeakSet<object>()

/**
 * Watch every request `bunker` sends, as `session`'s. Every NIP-46 call in
 * nostr-tools (connect, get_public_key, sign_event, nip44_*) goes through
 * sendRequest, so this sees them all. Call it before guardRequestSize, so a
 * request the guard holds back is never counted. Idempotent.
 */
export function trackActivity<T extends Requester>(bunker: T, session: string): T {
  if (tracked.has(bunker)) return bunker
  tracked.add(bunker)
  const send = bunker.sendRequest.bind(bunker)
  bunker.sendRequest = (method: string, params: string[]): Promise<string> => {
    const token = asked(session)
    return send(method, params).then(
      (result) => { answered(session, token); return result },
      (err: unknown) => {
        // nostr-tools rejects with the signer's own words (a string) when it
        // answered with an error: an answer. Anything else failed on the way.
        if (typeof err === 'string') answered(session, token)
        else lost(session, token)
        throw err
      },
    )
  }
  return bunker
}

/** A signature this device needed ran out of time with `session`'s signer. */
export function noteSignerStuck(session: string | null | undefined): void {
  if (!session) return
  update(session, (a) => ({ ...a, stuckAt: Date.now() }))
}

/** `session`'s signer answered a big request: it reads big messages, and is not warned about them again. */
export function noteReadsBig(session: string): void {
  update(session, (a) => ({ ...a, readsBig: true, bigSilentAt: null }))
}

/** A signature waiting on a big request, sent anyway, ran out of time with `session`'s signer. */
export function noteBigSilent(session: string | null | undefined): void {
  if (!session) return
  update(session, (a) => ({ ...a, bigSilentAt: Date.now() }))
}

/** Forget a session: LOG OUT, or a test starting afresh. */
export function forgetActivity(session: string | null | undefined): void {
  if (!session) return
  waiting.delete(session)
  const { [session]: _gone, ...rest } = useSignerActivity.getState().bySession
  useSignerActivity.setState({ bySession: rest })
}

/** How a signer is doing, in one word: nothing asked yet, an answer due, silent past its time, or answering. */
export type SignerHealth = 'quiet' | 'waiting' | 'silent' | 'answering'

/**
 * `silent` once a request has waited longer than a signature's own patience
 * (SIGN_PATIENCE_MS) with no answer since it went out. A signer that
 * answered something sent after it is answering: the older request was lost.
 */
export function signerHealth(a: SignerActivity, now: number = Date.now()): SignerHealth {
  if (a.waitingSince !== null && now - a.waitingSince >= SIGN_PATIENCE_MS && (a.answeredAt === null || a.answeredAt < a.waitingSince)) return 'silent'
  if (a.answeredAt !== null) return 'answering'
  if (a.waitingSince !== null) return 'waiting'
  return 'quiet'
}

/** "12 s ago", "4 min ago", "2 h ago": how long since `at`, for the status line. */
export function agoWords(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s} s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}
