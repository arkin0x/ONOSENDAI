/**
 * noNetwork.ts - every test file's setup (vite.config.ts test.setupFiles):
 * tests never touch a live relay (the owner's rule). A WebSocket opened while
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

afterEach(() => {
  if (!opened.length) return
  const urls = [...new Set(opened.splice(0))]
  throw new Error(`a test opened a WebSocket (${urls.join(', ')}): mock lib/relay or give it a fetch`)
})
