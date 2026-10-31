/**
 * sigCheck.ts - check a saved chain's signatures without holding the page.
 *
 * Every event a reader holds must be authentic before it decides anything
 * (spec §8.2, §8.7.3, Q4), its own storage included. The saved chain is
 * drawn at once, unchecked, and its signatures are checked here: in a Web
 * Worker (workers/sig.worker.ts) where there is one, and otherwise on the
 * main thread in small chunks that yield between them, so the page keeps
 * drawing either way. The store holds every chain action until the check
 * is done, and cuts the chain at the first event that fails.
 */

import { getEventHash, verifyEvent, type VerifiedEvent } from 'nostr-tools/pure'
import type { NostrEvent } from './events'
import { alreadyChecked, checkedElsewhere, verifyOnce } from './verifiedSigs'
import type { SigCheckRequest, SigCheckResponse } from '../workers/sig.worker'

/** How many events the main-thread fallback checks before it yields. */
const CHUNK = 25

/** One turn of the event loop, so the page can draw. */
const yieldToPage = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * The fallback: the same check on the main thread, CHUNK events at a time,
 * yielding before each chunk, the first included, so nothing is checked
 * while the page is still starting.
 */
async function inChunks(events: NostrEvent[], known: ReadonlySet<string> = NOTHING_KNOWN): Promise<Set<string>> {
  const bad = new Set<string>()
  for (let i = 0; i < events.length; i += CHUNK) {
    await yieldToPage()
    for (const e of events.slice(i, i + CHUNK)) if (!sigHolds(e, known)) bad.add(e.id)
  }
  return bad
}

const NOTHING_KNOWN: ReadonlySet<string> = new Set()

/**
 * An event's id and signature, skipping the Schnorr check for a signature `known`
 * says this page already checked against that id. Its id is still recomputed,
 * which commits to the pubkey and every other field. The worker's check too.
 */
export function sigHolds(e: NostrEvent, known: ReadonlySet<string>): boolean {
  if (known.has(`${e.id}:${e.sig}`)) {
    try { return getEventHash(e) === e.id } catch { return false }
  }
  return verifyEvent(e as unknown as VerifiedEvent)
}

/** Below this many events a worker costs more to start than the checks. */
export const WORKER_FROM = 32

/**
 * Those of `events` that are authentic, checked off the main thread when there
 * are enough to matter, and remembered (lib/verifiedSigs) so a repeat view skips
 * the Schnorr checks. Whatever fails is dropped, as the pool drops one as it lands.
 */
export async function keepAuthentic(events: NostrEvent[]): Promise<NostrEvent[]> {
  if (events.length < WORKER_FROM) return events.filter((e) => verifyOnce(e))
  const bad = await checkSignatures(events, undefined, alreadyChecked(events))
  const good = events.filter((e) => !bad.has(e.id))
  for (const e of good) checkedElsewhere(e)
  return good
}

/**
 * Each relay's answer, keeping what is authentic, one relay after another. Before
 * the answers merge, or a forged copy from one relay would stand in for the real
 * event from another, merged by id, and hide it. In turn, so a later relay's copies
 * of what an earlier one proved skip their Schnorr checks.
 */
export async function keepAuthenticAnswers<A extends { events: NostrEvent[] }>(answers: A[]): Promise<A[]> {
  const out: A[] = []
  for (const a of answers) out.push({ ...a, events: await keepAuthentic(a.events) })
  return out
}

/**
 * How long the worker is given before the main thread takes the check over:
 * a base, and a little per event, far beyond what a slow phone takes (about
 * 1 ms per event in the worker), so it only ever ends a worker that is not
 * answering at all.
 */
export function sigCheckDeadlineMs(count: number): number {
  return 10_000 + 5 * count
}

/**
 * The ids of the events in `events` whose NIP-01 id or signature does not
 * verify. Never rejects, and never waits forever: a worker that cannot
 * start, fails, or has not answered by `deadlineMs` falls back to the main
 * thread (review of #242: a worker that never answered held every chain
 * action for the rest of the page).
 */
export function checkSignatures(events: NostrEvent[], deadlineMs = sigCheckDeadlineMs(events.length), known: readonly string[] = []): Promise<Set<string>> {
  if (events.length === 0) return Promise.resolve(new Set())
  const knownSet = new Set(known)
  if (typeof Worker === 'undefined') return inChunks(events, knownSet)
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('../workers/sig.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      resolve(inChunks(events, knownSet))
      return
    }
    let settled = false
    const settle = (answer: Set<string> | Promise<Set<string>>): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate()
      resolve(answer)
    }
    const timer = setTimeout(() => settle(inChunks(events, knownSet)), deadlineMs)
    worker.onmessage = (message: MessageEvent<SigCheckResponse>) => settle(new Set(message.data.bad))
    worker.onerror = () => settle(inChunks(events, knownSet))
    const request: SigCheckRequest = { events, known }
    worker.postMessage(request)
  })
}
