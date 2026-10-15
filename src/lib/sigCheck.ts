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

import { verifyEvent, type VerifiedEvent } from 'nostr-tools/pure'
import type { NostrEvent } from './events'
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
async function inChunks(events: NostrEvent[]): Promise<Set<string>> {
  const bad = new Set<string>()
  for (let i = 0; i < events.length; i += CHUNK) {
    await yieldToPage()
    for (const e of events.slice(i, i + CHUNK)) if (!verifyEvent(e as unknown as VerifiedEvent)) bad.add(e.id)
  }
  return bad
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
export function checkSignatures(events: NostrEvent[], deadlineMs = sigCheckDeadlineMs(events.length)): Promise<Set<string>> {
  if (events.length === 0) return Promise.resolve(new Set())
  if (typeof Worker === 'undefined') return inChunks(events)
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('../workers/sig.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      resolve(inChunks(events))
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
    const timer = setTimeout(() => settle(inChunks(events)), deadlineMs)
    worker.onmessage = (message: MessageEvent<SigCheckResponse>) => settle(new Set(message.data.bad))
    worker.onerror = () => settle(inChunks(events))
    const request: SigCheckRequest = { events }
    worker.postMessage(request)
  })
}
