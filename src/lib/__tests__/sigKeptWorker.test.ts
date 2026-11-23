/**
 * sigKeptWorker.test.ts - a whole chain's signatures are checked on one worker
 * kept for a while (lib/sigCheck.ts keepAuthentic, answerChecks), each relay's
 * answer as it comes in. A new worker per relay per page, after every relay had
 * answered, made a long chain from three relays take about 35% longer to come
 * in than checking as events landed (review of #573). Real keys and
 * signatures; the worker here is workers/sig.worker.ts itself, run in this thread.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const spy = vi.hoisted(() => ({ verifies: 0 }))
vi.mock('nostr-tools/pure', async (orig) => {
  const real = await orig<typeof import('nostr-tools/pure')>()
  return { ...real, verifyEvent: (e: Parameters<typeof real.verifyEvent>[0]) => { spy.verifies++; return real.verifyEvent(e) } }
})

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../events'
import { KEPT_WORKER_IDLE_MS, WORKER_FROM, answerChecks, endKeptWorker, keepAuthentic, keepAuthenticAnswers } from '../sigCheck'
import type { SigCheckRequest, SigCheckResponse } from '../../workers/sig.worker'

const key = generateSecretKey()
let n = 0
// Through JSON, as a relay hands it over: no mark that it has been verified.
const fresh = (count = WORKER_FROM + 8): NostrEvent[] => Array.from({ length: count }, () => JSON.parse(JSON.stringify(finalizeEvent({ kind: 3333, created_at: 1000 + n++, tags: [], content: '' }, key))) as NostrEvent)
const copies = (events: NostrEvent[]): NostrEvent[] => events.map((e) => JSON.parse(JSON.stringify(e)) as NostrEvent)

/** The real worker's onmessage, loaded once with a stand-in `self`. */
let workerOnMessage: (m: { data: SigCheckRequest }) => void
let reply: (answer: SigCheckResponse) => void = () => {}
beforeAll(async () => {
  const self: { onmessage?: (m: { data: SigCheckRequest }) => void; postMessage: (a: SigCheckResponse) => void } = { postMessage: (a) => reply(a) }
  vi.stubGlobal('self', self)
  await import('../../workers/sig.worker')
  workerOnMessage = self.onmessage!
})

const realWorker = (globalThis as { Worker?: unknown }).Worker
afterEach(() => {
  endKeptWorker()
  ;(globalThis as { Worker?: unknown }).Worker = realWorker
  vi.useRealTimers()
})

/** A Worker that runs workers/sig.worker.ts in this thread, a turn later, and says what it was asked. */
function runsTheWorker(log: string[], answers = true): void {
  ;(globalThis as { Worker?: unknown }).Worker = class {
    onmessage: ((m: { data: SigCheckResponse }) => void) | null = null
    onerror: (() => void) | null = null
    constructor() { log.push('made') }
    postMessage(request: SigCheckRequest): void {
      log.push(`asked ${request.events.length}`)
      if (!answers) return
      setTimeout(() => {
        reply = (a) => this.onmessage?.({ data: a })
        workerOnMessage({ data: request })
      }, 0)
    }
    terminate(): void { log.push('ended') }
  }
}

describe('the kept worker', () => {
  it('checks every relay\'s answer of a page on one worker, and the same event from three relays costs one Schnorr check', async () => {
    const log: string[] = []
    runsTheWorker(log)
    const page = fresh()
    spy.verifies = 0
    const answers = await keepAuthenticAnswers([{ url: 'a', events: page }, { url: 'b', events: copies(page) }, { url: 'c', events: copies(page) }])
    expect(answers.map((a) => a.events.length)).toEqual([page.length, page.length, page.length])
    expect(log.filter((l) => l === 'made')).toHaveLength(1)
    expect(spy.verifies).toBe(page.length)
  })

  it('still drops a forged or changed copy one relay sends of an event another proved', async () => {
    runsTheWorker([])
    const page = fresh()
    await keepAuthentic(page)
    const changed = copies(page)
    changed[3] = { ...changed[3], content: 'something else' }
    changed[5] = { ...changed[5], sig: 'f'.repeat(128) }
    const kept = await keepAuthentic(changed)
    expect(kept.map((e) => e.id)).toEqual(page.filter((_, i) => i !== 3 && i !== 5).map((e) => e.id))
  })

  it('is kept for the next page, and ended once it has been idle', async () => {
    vi.useFakeTimers()
    const log: string[] = []
    runsTheWorker(log)
    const page = async (): Promise<void> => {
      const p = keepAuthentic(fresh())
      await vi.advanceTimersByTimeAsync(1)
      await p
    }
    await page()
    await vi.advanceTimersByTimeAsync(KEPT_WORKER_IDLE_MS - 100)
    await page()
    expect(log.filter((l) => l === 'made')).toHaveLength(1)
    // The first page's idle wait was called off by the second page.
    await vi.advanceTimersByTimeAsync(KEPT_WORKER_IDLE_MS - 100)
    expect(log).not.toContain('ended')
    await vi.advanceTimersByTimeAsync(200)
    expect(log).toContain('ended')
  })

  it('a worker that never answers is ended at its deadline: what it owed is checked here, and the next check gets a new one', async () => {
    const log: string[] = []
    runsTheWorker(log, false)
    vi.useFakeTimers()
    const a = fresh(), b = fresh()
    const bad = copies(b)
    bad[0] = { ...bad[0], sig: 'f'.repeat(128) }
    const both = Promise.all([keepAuthentic(a), keepAuthentic(bad)])
    await vi.advanceTimersByTimeAsync(60_000)
    const [ka, kb] = await both
    expect(ka).toHaveLength(a.length)
    expect(kb.map((e) => e.id)).toEqual(b.slice(1).map((e) => e.id))
    expect(log.filter((l) => l === 'ended')).toHaveLength(1)
    vi.useRealTimers()
    runsTheWorker(log)
    await keepAuthentic(fresh())
    expect(log.filter((l) => l === 'made')).toHaveLength(2)
  })

  it('a relay\'s check starts the moment its answer is in, before the other relays have answered', () => {
    const log: string[] = []
    runsTheWorker(log)
    const checks = answerChecks<{ url: string; events: NostrEvent[] }>()
    checks.onAnswer({ url: 'fast', events: fresh() })
    expect(log).toEqual(['made', `asked ${WORKER_FROM + 8}`])
  })
})
