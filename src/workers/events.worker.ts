/**
 * events.worker.ts - owns the IndexedDB connection to `onosendai:events`
 * (lib/eventDb). Rows are written and read here, so a long chain's reads and a
 * batch of arrivals never hold the page. Requests are answered in the order
 * they came, one at a time, so a tab's writes land in the order it made them.
 */

import { answer, type EventDbRequest, type EventDbResponse } from '../lib/eventDb/ops'

let queue: Promise<unknown> = Promise.resolve()

self.onmessage = (message: MessageEvent<EventDbRequest>): void => {
  const { call } = message.data
  queue = queue.then(() => answer(message.data)).then((response: EventDbResponse) => { self.postMessage(response) }).catch((err: unknown) => {
    // An answer that cannot be sent (one that cannot be cloned) must not silence
    // every request after it, and its caller is told now rather than left to
    // run out of patience and give the whole worker up.
    const failure: EventDbResponse = { call, ok: false, name: 'DataCloneError', message: String((err as { message?: unknown } | null)?.message ?? err) }
    try { self.postMessage(failure) } catch { /* nothing more can be said */ }
  })
}
