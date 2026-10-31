/**
 * retiredRelay.test.ts - no path opens a socket to a retired relay (the owner,
 * 2026-10-31: wss://onosendai.feeds.relay.tools is down indefinitely). This is
 * relay.ts over the real nostr-tools pool, with a fake socket that records
 * every URL it is asked for.
 *
 * What would go wrong silently: a publish, a read or a live subscription that
 * reaches the retired relay through a list nobody migrated, such as a kind
 * 10002 or an object's relay hint, waits on it on every move.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// relay.ts itself, not the tests' offline relay (src/test/noNetwork.ts).
vi.unmock('../relay')

const net = vi.hoisted(() => {
  const opened: string[] = []
  class FakeSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readyState = 0
    onopen?: () => void
    onclose?: (e: { code: number; reason: string }) => void
    onmessage?: (e: { data: string }) => void
    constructor(url: string | URL) {
      opened.push(String(url))
      setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0)
    }
    send(raw: string): void {
      const msg = JSON.parse(raw) as [string, { id?: string } | string]
      setTimeout(() => {
        if (msg[0] === 'REQ') this.onmessage?.({ data: JSON.stringify(['EOSE', msg[1]]) })
        if (msg[0] === 'EVENT') this.onmessage?.({ data: JSON.stringify(['OK', (msg[1] as { id: string }).id, true, '']) })
      }, 0)
    }
    close(): void { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }) }
  }
  ;(globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket
  return { opened }
})

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { askRelay, connectRelay, publishMany, queryAny, queryEachAt, subscribeOne } from '../relay'
import type { NostrEvent } from '../events'

const RETIRED = 'wss://onosendai.feeds.relay.tools'
const MINE = 'wss://mine.example'
const dialedRetired = (): string[] => net.opened.filter((u) => u.includes('feeds.relay.tools'))
const event = (): NostrEvent => finalizeEvent({ kind: 3333, created_at: 1_000, tags: [], content: '' }, generateSecretKey()) as unknown as NostrEvent

describe('a retired relay', () => {
  beforeEach(() => { net.opened.length = 0 })

  it('a publish names only the others as having taken it, and a publish to it alone fails', async () => {
    const result = await publishMany([MINE, RETIRED], event())
    expect(result).toEqual({ ok: true, accepted: [`${MINE}/`] })
    expect((await publishMany([RETIRED], event())).ok).toBe(false)
    expect(dialedRetired()).toEqual([])
    expect(net.opened).toContain(`${MINE}/`)
  })

  it('every read, whether asked of a list or of it alone, answers unreachable or nothing without a socket', async () => {
    const filter = { kinds: [0], limit: 1 }
    const answers = await queryEachAt([MINE, RETIRED], filter, 500)
    expect(answers.find((a) => a.url.includes('mine.example'))?.outcome).toBe('answered')
    expect(answers.find((a) => a.url.includes('feeds.relay.tools'))?.outcome).toBe('unreachable')
    expect(await queryAny([RETIRED], filter, 500)).toEqual([])
    expect((await askRelay(RETIRED, filter, () => {}, { maxWait: 500 })).outcome).toBe('unreachable')
    expect(await connectRelay(RETIRED)).toBe(false)
    expect(dialedRetired()).toEqual([])
  })

  it('a live subscription to it closes at once', async () => {
    const closed = await new Promise<string>((resolve) => {
      subscribeOne(RETIRED, { kinds: [0] }, { onevent: () => {}, oneose: () => {}, onclose: (reason) => resolve(reason ?? '') })
    })
    expect(closed).toBe('unreachable')
    expect(dialedRetired()).toEqual([])
  })
})
