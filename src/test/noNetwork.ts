/**
 * noNetwork.ts - every test file's setup (vite.config.ts test.setupFiles):
 * tests never touch a live relay or the network (the owner's rule). An HTTP
 * fetch to anywhere but localhost is refused the same way. A WebSocket opened while
 * a test runs is refused, and the test that opened it FAILS, even when the
 * code under test swallowed the refusal (nostr-tools reads a refused
 * connection as an unreachable relay). A test that fakes WebSocket itself
 * (signerAccount.test.ts) installs its own over this one. lib/relay is the
 * offline relay (src/test/offlineRelay.ts) unless a test file says otherwise.
 */
import { afterEach, vi } from 'vitest'

// lib/relay offline in every test file (src/test/offlineRelay.ts), under any
// test file's own mock of it, which spreads the same.
vi.mock('../lib/relay', async (orig) => ({ ...(await orig<typeof import('../lib/relay')>()), ...(await import('./offlineRelay')).offlineRelay }))

const opened: string[] = []

class NoWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  constructor(url: string | URL) {
    opened.push(String(url))
    throw new Error(`a test opened a WebSocket to ${String(url)}: tests never touch a live relay`)
  }
}

;(globalThis as { WebSocket?: unknown }).WebSocket = NoWebSocket

// HTTP too (hosaka.ts, useMutes, useCoastline, useTvExplainer call fetch): a
// request to anywhere but this machine is refused, and the test that made it
// fails. A test that fakes fetch itself (vi.stubGlobal) installs its own.
const realFetch = globalThis.fetch
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  // The tests' HOSAKA (vite.config.ts test.env): unreachable, and no socket is opened to say so.
  if (url.startsWith('http://127.0.0.1:9/')) return Promise.reject(new TypeError('fetch failed: HOSAKA is unreachable in tests'))
  if (/^https?:/i.test(url) && !LOCAL.test(url)) {
    opened.push(url)
    return Promise.reject(new TypeError(`a test fetched ${url}: tests never touch the network`))
  }
  return realFetch(input, init)
}) as typeof fetch

afterEach(() => {
  if (!opened.length) return
  const urls = [...new Set(opened.splice(0))]
  throw new Error(`a test reached the network (${urls.join(', ')}): mock lib/relay, or fake fetch, for it`)
})
