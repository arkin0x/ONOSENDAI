/**
 * publishFirst.test.ts: a move counts as sent once one relay has taken it,
 * and a relay that is slow, dead or held up by AUTH does not hold the next
 * move back (owner's ruling of 2026-11-22). Every relay's answer still comes
 * in afterwards, for what is noted from it (chain holders, the canonical
 * relay's copy).
 *
 * relay.ts and nostr-tools' pool over fake sockets: no socket leaves the process.
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('../relay')

const net = vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => { m.clear() },
  }
  const state = {
    CANON: 'wss://relay.onosendai.tech/',
    SLOW: 'wss://slow.example/',
    DEAD: 'wss://dead.example/',
    /** How long each relay takes to answer an EVENT; a relay not here never answers. */
    okMs: new Map<string, number>(),
    /** Each relay refuses every EVENT. */
    refuseAll: false,
    /** The read-only old relay (useRelays READ_FALLBACK_RELAY): a move is copied there on the side. */
    OLD: 'wss://cyberspace.nostr1.com/',
    /** These relays refuse every EVENT. */
    refuse: new Set<string>(),
    /** Every relay an EVENT was sent to. */
    sentTo: [] as string[],
  }
  class FakeSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readyState = 0
    url: string
    onopen?: (() => void) | null
    onclose?: ((e: { code: number; reason: string }) => void) | null
    onmessage?: ((e: { data: string }) => void) | null
    onerror?: ((e: unknown) => void) | null
    constructor(url: string | URL) {
      this.url = String(url)
      setTimeout(() => { this.readyState = 1; this.onopen?.() }, 2)
    }
    send(raw: string): void {
      const msg = JSON.parse(raw) as unknown[]
      if (msg[0] === 'REQ') { setTimeout(() => this.onmessage?.({ data: JSON.stringify(['EOSE', msg[1]]) }), 1); return }
      if (msg[0] !== 'EVENT') return
      state.sentTo.push(this.url)
      const ms = state.okMs.get(this.url)
      if (ms === undefined) return
      const id = (msg[1] as { id: string }).id
      setTimeout(() => { if (this.readyState === 1) { const no = state.refuseAll || state.refuse.has(this.url); this.onmessage?.({ data: JSON.stringify(['OK', id, !no, no ? 'blocked: no' : '']) }) } }, ms)
    }
    close(): void {
      if (this.readyState === 3) return
      this.readyState = 3
      setTimeout(() => this.onclose?.({ code: 1000, reason: '' }), 0)
    }
  }
  ;(globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket
  return state
})

vi.mock('../../store/useRelays', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/useRelays')>()),
  currentRelays: () => [net.CANON, net.SLOW, net.DEAD],
}))

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../events'
import { publishFirst } from '../relay'

const sk = generateSecretKey()
let n = 0
const anEvent = (): NostrEvent => finalizeEvent({ kind: 3333, created_at: 1_790_000_000 + n++, tags: [['A', 'hop']], content: '' }, sk) as unknown as NostrEvent

describe('publishFirst', () => {
  it('answers once one relay took it, while a slow relay and a dead one are still out; every answer comes in after', async () => {
    net.okMs.set(net.CANON, 5)
    net.okMs.set(net.SLOW, 1_500)
    net.okMs.delete(net.DEAD)
    const t0 = Date.now()
    const r = await publishFirst(anEvent())
    expect(r.ok).toBe(true)
    expect(Date.now() - t0).toBeLessThan(1_200)
    expect(r.ok && r.accepted).toEqual([net.CANON])
    const slowIn = Promise.race([r.all.then(() => 'all'), new Promise((res) => setTimeout(() => res('later'), 1_000))])
    expect(await slowIn).toBe('later')
  }, 30_000)

  it('the late answers are kept: `all` names every relay that took it', async () => {
    net.okMs.set(net.CANON, 5)
    net.okMs.set(net.SLOW, 50)
    net.okMs.set(net.DEAD, 80)
    const r = await publishFirst(anEvent())
    const all = await r.all
    expect(all.ok && [...(all.accepted ?? [])].sort()).toEqual([net.CANON, net.DEAD, net.SLOW].sort())
  }, 30_000)

  it('a move only the old relay took is a failure: its copy on the side is never part of the answer (review of stage 1)', async () => {
    net.sentTo.length = 0
    for (const u of [net.CANON, net.SLOW, net.DEAD]) { net.okMs.set(u, 20); net.refuse.add(u) }
    net.okMs.set(net.OLD, 1)
    const r = await publishFirst(anEvent())
    for (const u of [net.CANON, net.SLOW, net.DEAD]) net.refuse.delete(u)
    net.okMs.delete(net.OLD)
    expect(r.ok).toBe(false)
    expect((await r.all).ok).toBe(false)
    expect(net.sentTo).toContain(net.OLD)
  }, 30_000)

  it('only a move is copied to the old relay; nothing else goes there', async () => {
    net.sentTo.length = 0
    for (const u of [net.CANON, net.SLOW, net.DEAD]) net.okMs.set(u, 5)
    const bag = finalizeEvent({ kind: 33330, created_at: 1_790_000_000 + n++, tags: [['d', 'x']], content: '' }, sk) as unknown as NostrEvent
    await (await publishFirst(bag)).all
    expect(net.sentTo).not.toContain(net.OLD)
  }, 30_000)

  it('with every relay refusing it, the answer is a failure, as publish gives', async () => {
    net.refuseAll = true
    for (const u of [net.CANON, net.SLOW, net.DEAD]) net.okMs.set(u, 5)
    const r = await publishFirst(anEvent())
    net.refuseAll = false
    expect(r.ok).toBe(false)
  }, 30_000)
})
