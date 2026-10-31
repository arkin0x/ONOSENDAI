/**
 * events.worker.ts - owns the IndexedDB connection to `onosendai:events`
 * (lib/eventDb). Rows are written and read here, so a long chain's reads and a
 * batch of arrivals never hold the page. Requests are answered in the order
 * they came, one at a time, so a tab's writes land in the order it made them.
 */

import { answer, type EventDbRequest, type EventDbResponse } from '../lib/eventDb/ops'

let queue: Promise<unknown> = Promise.resolve()

self.onmessage = (message: MessageEvent<EventDbRequest>): void => {
  queue = queue.then(() => answer(message.data)).then((response: EventDbResponse) => { self.postMessage(response) })
}
