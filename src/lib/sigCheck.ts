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
 * On the kept worker (checkOnKept): a chain comes a page at a time from each
 * relay, and a new worker for each was about 120 ms apiece before any check.
 */
export async function keepAuthentic(events: NostrEvent[]): Promise<NostrEvent[]> {
  if (events.length < WORKER_FROM) return events.filter((e) => verifyOnce(e))
  const bad = await checkOnKept(events, alreadyChecked(events))
  const good = events.filter((e) => !bad.has(e.id))
  for (const e of good) checkedElsewhere(e)
  return good
}

/**
 * Each relay's answer checked apart, before the answers merge, or a forged copy
 * from one relay would stand in for the real event from another, merged by id,
 * and hide it. `onAnswer` starts a relay's check the moment its answer is in
 * (relay.ts query), not after the slowest relay has answered; `kept` waits for
 * every check. The kept worker takes them in turn and checks a later relay's
 * copy of what it already proved by its id alone.
 */
export function answerChecks<A extends { events: NostrEvent[] }>(): { onAnswer: (a: A) => void; kept: (answers: A[]) => Promise<A[]> } {
  const checking = new Map<A, Promise<NostrEvent[]>>()
  return {
    onAnswer: (a) => { checking.set(a, keepAuthentic(a.events)) },
    kept: (answers) => Promise.all(answers.map(async (a) => ({ ...a, events: await (checking.get(a) ?? keepAuthentic(a.events)) }))),
  }
}

/** Every answer kept to what is authentic, checked apart (answerChecks), all started at once. */
export function keepAuthenticAnswers<A extends { events: NostrEvent[] }>(answers: A[]): Promise<A[]> {
  return answerChecks<A>().kept(answers)
}

/** How long the kept worker stays after its last answer: a chain is read a few pages in a row. */
export const KEPT_WORKER_IDLE_MS = 10_000

/** The kept worker, the answers it owes by request, and how many events are queued on it. */
interface Kept { worker: Worker; waiting: Map<number, (bad: Set<string> | null) => void>; queued: number; idle?: ReturnType<typeof setTimeout> }
let kept: Kept | null = null
let lastSeq = 0

/** Ends a kept worker; whatever it still owes is checked on the main thread instead. */
function dropKept(k: Kept): void {
  if (kept === k) kept = null
  clearTimeout(k.idle)
  k.worker.terminate()
  const owed = [...k.waiting.values()]
  k.waiting.clear()
  for (const answer of owed) answer(null)
}

/** Ends the kept worker now, if there is one: for tests. */
export function endKeptWorker(): void {
  if (kept) dropKept(kept)
}

function keptWorker(): Kept {
  if (kept) {
    clearTimeout(kept.idle)
    return kept
  }
  const k: Kept = { worker: new Worker(new URL('../workers/sig.worker.ts', import.meta.url), { type: 'module' }), waiting: new Map(), queued: 0 }
  k.worker.onmessage = (message: MessageEvent<SigCheckResponse>) => {
    const { seq } = message.data
    const answer = seq === undefined ? undefined : k.waiting.get(seq)
    if (!answer || seq === undefined) return
    k.waiting.delete(seq)
    answer(new Set(message.data.bad))
    if (k.waiting.size === 0 && kept === k) k.idle = setTimeout(() => dropKept(k), KEPT_WORKER_IDLE_MS)
  }
  k.worker.onerror = () => dropKept(k)
  kept = k
  return k
}

/**
 * checkSignatures on one worker kept for a while, its requests answered in turn.
 * The same guarantees: never rejects, never waits forever. Its deadline counts
 * everything queued ahead of it; a worker past one is ended, and everything it
 * owed is checked on the main thread.
 */
function checkOnKept(events: NostrEvent[], known: readonly string[]): Promise<Set<string>> {
  const knownSet = new Set(known)
  if (typeof Worker === 'undefined') return inChunks(events, knownSet)
  let k: Kept
  try { k = keptWorker() } catch { return inChunks(events, knownSet) }
  const seq = ++lastSeq
  k.queued += events.length
  return new Promise<Set<string> | null>((resolve) => {
    const timer = setTimeout(() => dropKept(k), sigCheckDeadlineMs(k.queued))
    k.waiting.set(seq, (bad) => {
      clearTimeout(timer)
      k.queued -= events.length
      resolve(bad)
    })
    const request: SigCheckRequest = { events, known, seq }
    k.worker.postMessage(request)
  }).then((bad) => bad ?? inChunks(events, knownSet))
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
