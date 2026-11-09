/**
 * canonicalReconcile.test.ts - the canonical relay brought up to this
 * device's chain over one socket (publisher.ts reconcileCanonical), against
 * a fake relay that behaves as relay.onosendai.tech (grain) does: reads
 * and EVENTs served without AUTH, NIP-45 COUNT, at most 500 events to a
 * filter, OK true "duplicate:" for an event it already has, and a count of
 * every socket opened to it (it allows 30 a minute from one address). With
 * `challenge`, it sends an AUTH challenge on every connect as grain does,
 * and the signer can be made to say no (relaySigner.test.ts's open
 * challenger): an empty answer on a socket not signed in then comes back
 * "refused", and the events must still be sent (review of #634, blocker 1).
 *
 * The owner's device said "1520 actions not on wss://relay.onosendai.tech
 * yet" of a chain the relay held whole (2026-11-09), and the old retry sent
 * each one on its own, redialling after every failure. What this proves: a
 * stale list the relay holds clears with a few REQs and no EVENT; only what
 * it truly lacks is sent, paced, on the same socket; and a duplicate is taken.
 *
 * relay.ts and the nostr-tools pool are real here; only the WebSocket is
 * fake. No socket leaves the process.
 */

import { describe, expect, it, vi } from 'vitest'

// relay.ts itself, not the tests' offline relay (src/test/noNetwork.ts).
vi.unmock('../relay')

const net = vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => { m.clear() },
  }
  if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
    ;(globalThis as { window?: unknown }).window = { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) }
  }
  type Ev = { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content: string; sig: string }
  type F = { ids?: string[]; kinds?: number[]; authors?: string[]; limit?: number }
  const CANON = 'wss://relay.onosendai.tech/'
  const state = {
    /** What the relay holds, by id. */
    held: new Map<string, Ev>(),
    /** Held, but a REQ or COUNT does not see them (a check by id that misses what the relay has). */
    hiddenFromReq: new Set<string>(),
    /** COUNT unsupported: answered with CLOSED. */
    noCount: false,
    /** An AUTH challenge on every connect. */
    challenge: false,
    /** AUTHs the relay was sent. */
    auths: 0,
    /** Each COUNT's filters. */
    counts: [] as F[][],
    sockets: 0,
    /** Sockets to any other relay: none may be opened. */
    elsewhere: [] as string[],
    /** Each REQ's filters. */
    reqs: [] as F[][],
    /** Each EVENT the relay was sent, by id, and when. */
    events: [] as { id: string; at: number }[],
    reset(): void {
      state.held = new Map(); state.hiddenFromReq = new Set(); state.sockets = 0; state.elsewhere = []; state.reqs = []; state.events = []
      state.noCount = false; state.challenge = false; state.auths = 0; state.counts = []
    },
  }
  const matches = (f: F, e: Ev): boolean =>
    (!f.ids || f.ids.includes(e.id)) && (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey))
  class GrainSocket {
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
      if (this.url !== CANON) { state.elsewhere.push(this.url); throw new Error(`no relay at ${this.url}`) }
      state.sockets++
      setTimeout(() => {
        this.readyState = 1
        this.onopen?.()
        if (state.challenge) this.deliver(['AUTH', `challenge-${state.sockets}`])
      }, 2)
    }
    private deliver(msg: unknown[]): void {
      if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(msg) })
    }
    send(raw: string): void {
      const msg = JSON.parse(raw) as unknown[]
      setTimeout(() => {
        if (this.readyState !== 1) return
        if (msg[0] === 'REQ') {
          const filters = msg.slice(2) as F[]
          state.reqs.push(filters)
          for (const f of filters) {
            const cap = Math.min(f.limit ?? 500, 500)
            const out = [...state.held.values()].filter((e) => matches(f, e) && !state.hiddenFromReq.has(e.id)).slice(0, cap)
            for (const e of out) this.deliver(['EVENT', msg[1], e])
          }
          this.deliver(['EOSE', msg[1]])
          return
        }
        if (msg[0] === 'AUTH') { state.auths++; this.deliver(['OK', (msg[1] as Ev).id, true, '']); return }
        if (msg[0] === 'COUNT') {
          if (state.noCount) { this.deliver(['CLOSED', msg[1], 'unsupported: COUNT']); return }
          const filters = msg.slice(2) as F[]
          state.counts.push(filters)
          const n = [...state.held.values()].filter((e) => !state.hiddenFromReq.has(e.id) && filters.some((f) => matches(f, e))).length
          this.deliver(['COUNT', msg[1], { count: n }])
          return
        }
        if (msg[0] === 'EVENT') {
          const e = msg[1] as Ev
          state.events.push({ id: e.id, at: Date.now() })
          if (state.held.has(e.id)) { this.deliver(['OK', e.id, true, 'duplicate: already have this event']); return }
          state.held.set(e.id, e)
          this.deliver(['OK', e.id, true, ''])
        }
      }, 1)
    }
    close(): void {
      if (this.readyState === 3) return
      this.readyState = 3
      setTimeout(() => this.onclose?.({ code: 1000, reason: '' }), 0)
    }
  }
  ;(globalThis as { WebSocket?: unknown }).WebSocket = GrainSocket
  return state
})

import { beforeEach } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../events'
import { CANONICAL_SEND_GAP_MS, reconcileCanonical, requeueForCanonical } from '../publisher'
import { CYBERSPACE_RELAY, dropRelays } from '../relay'
import { useCyberspace } from '../../store/useCyberspace'

const realSign = useCyberspace.getState().signEvent
beforeEach(() => {
  // Each test on a socket of its own, and the signer as the store has it.
  dropRelays([CYBERSPACE_RELAY])
  useCyberspace.setState({ signEvent: realSign })
})
/** The signer says no to everything, an AUTH included. */
const signerSaysNo = (): void => { useCyberspace.setState({ signEvent: (async () => { throw new Error('the signer said no') }) as never }) }

const sk = generateSecretKey()
const pk = getPublicKey(sk)
/** 1520 signed actions of one identity, made once: the owner's count. */
const chain: NostrEvent[] = Array.from({ length: 1520 }, (_, i) =>
  finalizeEvent({ kind: 3333, created_at: 1_790_000_000 + i, tags: [['A', 'hop']], content: '' }, sk) as unknown as NostrEvent)
const ours = new Set(chain.map((e) => e.id))
const keyOf = `onosendai:canonical-pending:${pk}`

/** This device holds the chain, every action published (on some relay). */
function holdChain(): void {
  useCyberspace.setState({
    identity: { ...useCyberspace.getState().identity, pubkey: pk },
    events: chain,
    published: Object.fromEntries(chain.map((e) => [e.id, 'ok' as const])),
  })
}
/** The REQs (or COUNTs) that asked about pending ids, not anything else the page asked: how many ids each. */
const idsOf = (asked: { ids?: string[] }[][]): number[] => asked.filter((fs) => fs.some((f) => f.ids?.some((id) => ours.has(id)))).map((fs) => fs.reduce((n, f) => n + (f.ids?.length ?? 0), 0))
const checks = (): number[] => idsOf(net.reqs)
const counts = (): number[] => idsOf(net.counts)

describe('the canonical relay brought up to the chain over one socket', () => {
  it('1520 stale pending ids it already holds: a COUNT per batch clears them, no event fetched or sent, one socket', async () => {
    net.reset(); localStorage.clear()
    for (const e of chain) net.held.set(e.id, e as never)
    holdChain()
    requeueForCanonical(chain)
    await reconcileCanonical()
    // 250 ids to a COUNT, one filter each, and no REQ for any of them.
    expect(counts()).toEqual([250, 250, 250, 250, 250, 250, 20])
    expect(checks()).toEqual([])
    expect(net.counts.every((fs) => fs.length <= 3)).toBe(true)
    expect(net.events).toEqual([])
    expect(net.sockets).toBe(1)
    expect(net.elsewhere).toEqual([])
    expect(useCyberspace.getState().canonicalLate).toBe(0)
    expect(localStorage.getItem(keyOf)).toBeNull()
  }, 60_000)

  it('a relay without COUNT: the same list is checked by REQ, 250 ids to one, and clears the same', async () => {
    net.reset(); localStorage.clear(); net.noCount = true
    for (const e of chain) net.held.set(e.id, e as never)
    holdChain()
    requeueForCanonical(chain)
    await reconcileCanonical()
    expect(checks()).toEqual([250, 250, 250, 250, 250, 250, 20])
    expect(net.reqs.every((fs) => fs.length <= 3)).toBe(true)
    expect(net.events).toEqual([])
    expect(net.sockets).toBe(1)
    expect(localStorage.getItem(keyOf)).toBeNull()
  }, 60_000)

  it('3 it truly lacks among them: only those 3 are sent, in chain order, paced, on the same socket', async () => {
    net.reset(); localStorage.clear()
    const lacking = [chain[10], chain[11], chain[900]]
    for (const e of chain) if (!lacking.includes(e)) net.held.set(e.id, e as never)
    holdChain()
    requeueForCanonical(chain)
    await reconcileCanonical()
    expect(net.events.map((e) => e.id)).toEqual(lacking.map((e) => e.id))
    // Timers may fire a millisecond early; the pace is the point, not the last millisecond.
    expect(net.events[1].at - net.events[0].at).toBeGreaterThanOrEqual(CANONICAL_SEND_GAP_MS - 5)
    expect(net.events[2].at - net.events[1].at).toBeGreaterThanOrEqual(CANONICAL_SEND_GAP_MS - 5)
    // Only the two batches that counted short were fetched.
    expect(checks()).toEqual([250, 250])
    expect(net.sockets).toBe(1)
    expect(lacking.every((e) => net.held.has(e.id))).toBe(true)
    expect(useCyberspace.getState().canonicalLate).toBe(0)
    expect(localStorage.getItem(keyOf)).toBeNull()
  }, 60_000)

  it('one the check missed and the relay answers OK true "duplicate:" is taken as held', async () => {
    net.reset(); localStorage.clear()
    for (const e of chain) net.held.set(e.id, e as never)
    net.hiddenFromReq.add(chain[5].id)
    holdChain()
    requeueForCanonical([chain[5]])
    await reconcileCanonical()
    expect(net.events.map((e) => e.id)).toEqual([chain[5].id])
    expect(useCyberspace.getState().canonicalLate).toBe(0)
    expect(localStorage.getItem(keyOf)).toBeNull()
  }, 60_000)

  it('a relay that challenges on connect, with the signer saying no: an all-missing batch comes back refused, and is sent anyway on the same socket, where it lands', async () => {
    net.reset(); localStorage.clear(); net.challenge = true
    signerSaysNo()
    const lacking = [chain[20], chain[21], chain[22]]
    for (const e of chain) if (!lacking.includes(e)) net.held.set(e.id, e as never)
    holdChain()
    // Suspects only (the self-check's): nothing known missing, and the check of them is refused.
    requeueForCanonical(lacking)
    await reconcileCanonical()
    expect(net.events.map((e) => e.id)).toEqual(lacking.map((e) => e.id))
    expect(lacking.every((e) => net.held.has(e.id))).toBe(true)
    expect(net.sockets).toBe(1)
    expect(useCyberspace.getState().canonicalLate).toBe(0)
    expect(localStorage.getItem(keyOf)).toBeNull()
  }, 60_000)

  it('the same, with a mix the relay holds and one batch it lacks whole: the held clear by COUNT and REQ, the lacking are sent, nothing is lost', async () => {
    net.reset(); localStorage.clear(); net.challenge = true; net.noCount = true
    signerSaysNo()
    // The last batch (ids 1500 to 1519) the relay lacks whole; the rest it holds.
    const lacking = chain.slice(1500)
    for (const e of chain.slice(0, 1500)) net.held.set(e.id, e as never)
    holdChain()
    requeueForCanonical(chain)
    await reconcileCanonical()
    expect(net.events.map((e) => e.id)).toEqual(lacking.map((e) => e.id))
    expect(chain.every((e) => net.held.has(e.id))).toBe(true)
    expect(net.sockets).toBe(1)
    expect(localStorage.getItem(keyOf)).toBeNull()
  }, 60_000)
})
