/**
 * relaySigner.test.ts - a signer that has not answered bounds the wait, and is
 * never mistaken for an answer. This is relay.ts and chains.ts over the real
 * nostr-tools pool, on a fake clock, with fake sockets and a fake signer.
 *
 * What would go wrong silently: nostr-tools never settles an AUTH whose signer
 * rejected, so a publish or a read waited forever (v2 bounds that wait since
 * #581 and #600: the store's signWithin, and relay.ts signFailed). A bound
 * alone is not enough. A relay read before its AUTH can answer with nothing, the self-check
 * reads that as "no chain", and the first move signs a rival spawn over a real
 * chain. And dropping the socket throws the AUTH away and prompts a person again.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  type Ev = { kind: number; pubkey: string; id: string; created_at: number; tags: string[][] }
  const sockets: string[] = []
  let challenges = 0
  const events: { url: string; id: string }[] = []
  const rules = {
    /** Challenges on connect, and without an AUTH answers a REQ with an empty EOSE and refuses an EVENT. The fork case. */
    emptyUntilAuthed: new Set<string>(['wss://cyberspace.nostr1.com/']),
    /** Challenges only when an EVENT arrives, and refuses it until an AUTH. */
    challengesLate: new Set<string>(),
    /** Challenges this long after connecting, and until an AUTH answers a REQ with an empty EOSE. */
    challengeAfterMs: new Map<string, number>(),
    /** How long it takes over each EOSE. */
    eoseMs: new Map<string, number>(),
    /** Refuses the connection. */
    refuse: new Set<string>(),
    /** Open: serves reads and takes events unauthenticated, but challenges on connect. */
    openChallenger: new Set<string>(),
    /** The relay itself turns down the first socket's AUTH (not the signer). */
    refuseFirstAuth: new Set<string>(),
    /** Takes the first socket's EVENTs and never says OK. */
    swallowFirstEvent: new Set<string>(),
    hold: new Map<string, Ev[]>(),
  }
  const signer = { rejectFor: new Set<string>(), prompts: 0, mode: 'ok' as 'ok' | 'stall' | 'reject', ms: 0, waiting: [] as (() => void)[] }
  const match = (f: Record<string, unknown>, e: Ev): boolean => {
    if (Array.isArray(f.kinds) && !f.kinds.includes(e.kind)) return false
    if (Array.isArray(f.authors) && !f.authors.includes(e.pubkey)) return false
    if (Array.isArray(f.ids) && !f.ids.includes(e.id)) return false
    if (typeof f.since === 'number' && e.created_at < f.since) return false
    for (const [k, v] of Object.entries(f)) if (k.startsWith('#') && !e.tags.some((t) => t[0] === k.slice(1) && (v as string[]).includes(t[1]))) return false
    return true
  }
  class FakeSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readyState = 0
    url: string
    authed = false
    onopen?: (() => void) | null
    onclose?: ((e: { code: number; reason: string }) => void) | null
    onmessage?: ((e: { data: string }) => void) | null
    onerror?: (() => void) | null
    constructor(url: string | URL) {
      this.url = String(url)
      sockets.push(this.url)
      if (rules.refuse.has(this.url)) { setTimeout(() => this.onerror?.(), 0); return }
      const after = rules.challengeAfterMs.get(this.url)
      if (after !== undefined) setTimeout(() => { if (this.readyState === 1) this.say(['AUTH', `challenge-${++challenges}`]) }, after)
      setTimeout(() => {
        this.readyState = 1
        this.onopen?.()
        // A new challenge per connection, as a real relay gives: the client keys what it has answered on it.
        if (rules.emptyUntilAuthed.has(this.url)) this.say(['AUTH', `challenge-${++challenges}`])
        if (rules.openChallenger.has(this.url)) this.say(['AUTH', `open-${++challenges}`])
      }, 0)
    }
    say(msg: unknown[]): void { this.onmessage?.({ data: JSON.stringify(msg) }) }
    send(raw: string): void {
      const msg = JSON.parse(raw) as unknown[]
      setTimeout(() => {
        const gated = rules.emptyUntilAuthed.has(this.url) || rules.challengesLate.has(this.url) || rules.challengeAfterMs.has(this.url)
        const firstSocket = sockets.filter((u) => u === this.url).length === 1
        if (msg[0] === 'AUTH' && rules.refuseFirstAuth.has(this.url) && firstSocket) { this.say(['OK', (msg[1] as { id: string }).id, false, 'restricted: try again later']); return }
        if (msg[0] === 'EVENT' && rules.swallowFirstEvent.has(this.url) && firstSocket) return
        if (msg[0] === 'AUTH') { this.authed = true; this.say(['OK', (msg[1] as { id: string }).id, true, '']); return }
        if (msg[0] === 'REQ') {
          if (!gated || this.authed) {
            for (const f of msg.slice(2) as Record<string, unknown>[]) for (const e of rules.hold.get(this.url) ?? []) if (match(f, e)) this.say(['EVENT', msg[1], e])
          }
          setTimeout(() => this.say(['EOSE', msg[1]]), rules.eoseMs.get(this.url) ?? 0)
        }
        if (msg[0] === 'EVENT') {
          const id = (msg[1] as { id: string }).id
          if (gated && !this.authed) {
            if (rules.challengesLate.has(this.url)) this.say(['AUTH', `late-${++challenges}`])
            this.say(['OK', id, false, 'auth-required: this relay wants to know you'])
            return
          }
          events.push({ url: this.url, id })
          this.say(['OK', id, true, ''])
        }
      }, 0)
    }
    close(): void { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }) }
  }
  ;(globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket
  return { sockets, events, rules, signer }
})
// The store's signEvent, as far as an AUTH sees it: the signer, bounded by signWithin (15 s), and a late answer handed on.
vi.mock('../../store/useCyberspace', async () => {
  const { signWithin } = await import('../signWithin')
  const signer = {
    signEvent: async (t: Record<string, unknown>) => {
      net.signer.prompts++
      const forRelay = ((t.tags as string[][] | undefined) ?? []).find((x) => x[0] === 'relay')?.[1]?.replace(/\/$/, '')
      if (forRelay && net.signer.rejectFor.has(forRelay)) throw new Error('the signer said no to ' + forRelay)
      if (net.signer.mode === 'reject') throw new Error('the signer said no')
      if (net.signer.mode === 'stall') await new Promise<void>((resolve) => { net.signer.waiting.push(resolve) })
      else if (net.signer.ms) await new Promise((resolve) => setTimeout(resolve, net.signer.ms))
      return { ...t, id: Math.random().toString(16).slice(2).padEnd(64, '0'), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128) }
    },
  }
  return {
    useCyberspace: {
      getState: () => ({
        signEvent: (t: never, patienceMs?: number, late?: (ev: never) => void) => signWithin(signer as never, t, patienceMs, late as never),
      }),
    },
  }
})

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { useRelays } from '../../store/useRelays'
import { decideSelfCheck } from '../chainHold'
import { chainHolders, noteChainHolders } from '../chainHolders'
import { askChainEvents, confirmChainEvents, fetchChainEvents } from '../chains'
import { hopTemplate, spawnTemplate, type NostrEvent } from '../events'
import { CYBERSPACE_RELAY, dropRelays, publishMany, queryEachAt, queryEachSettled, retryFailedAuth } from '../relay'
import { AUTH_STALLED } from '../relayOutcome'
import { SIGN_PATIENCE_MS } from '../signWithin'
import { signerHeld } from '../authOpen'
import { normalizeURL } from 'nostr-tools/utils'

const CANON = `${CYBERSPACE_RELAY}/`
const anEvent = (): NostrEvent => finalizeEvent({ kind: 3333, created_at: 1_000, tags: [], content: '' }, generateSecretKey()) as unknown as NostrEvent
const dials = (url: string): number => net.sockets.filter((u) => u === url).length
const sent = (url: string): number => net.events.filter((e) => e.url === url).length
const FILTER = { kinds: [0], limit: 1 }
/** The bound on waiting for the signer: the store's signWithin. */
const AUTH_WAIT = SIGN_PATIENCE_MS

async function within<T>(ms: number, p: Promise<T>): Promise<{ settled: boolean; value?: T; error?: unknown }> {
  const seen: { settled: boolean; value?: T; error?: unknown } = { settled: false }
  void p.then((value) => { seen.settled = true; seen.value = value }, (error: unknown) => { seen.settled = true; seen.error = error })
  await vi.advanceTimersByTimeAsync(ms)
  return seen
}

function aChain(): { pubkey: string; spawn: NostrEvent; hop1: NostrEvent; hop2: NostrEvent } {
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  const sign = (t: Parameters<typeof finalizeEvent>[0]): NostrEvent => finalizeEvent(t, sk) as unknown as NostrEvent
  const spawn = sign(spawnTemplate(pubkey, 1_000))
  const hop = (n: number, previous: NostrEvent): NostrEvent => sign(hopTemplate({ createdAt: 1_000 + n * 10, genesisId: spawn.id, previousId: previous.id, prevCoordHex: pubkey, to: { x: BigInt(n), y: 1n, z: 1n }, plane: 0, proofHash: '0'.repeat(64), mn: '0'.repeat(16), mp: '00' } as never))
  const hop1 = hop(1, spawn)
  return { pubkey, spawn, hop1, hop2: hop(2, hop1) }
}

const release = (): void => { for (const go of net.signer.waiting.splice(0)) go() }

beforeEach(() => {
  vi.useFakeTimers()
  dropRelays([CANON])
  useRelays.getState().reset()
  net.sockets.length = 0
  net.events.length = 0
  net.rules.hold.clear()
  net.rules.emptyUntilAuthed.clear()
  net.rules.emptyUntilAuthed.add(CANON)
  net.rules.challengesLate.clear()
  net.rules.challengeAfterMs.clear()
  net.rules.eoseMs.clear()
  net.rules.refuse.clear()
  net.rules.openChallenger.clear()
  net.rules.refuseFirstAuth.clear()
  net.rules.swallowFirstEvent.clear()
  net.signer.rejectFor.clear()
  net.signer.prompts = 0
  net.signer.mode = 'ok'
  net.signer.ms = 0
})
afterEach(async () => {
  release()
  await vi.advanceTimersByTimeAsync(0)
  vi.useRealTimers()
})

describe('publishing to a gated relay while the signer has not answered', () => {
  it('gives up at 15 s, sends nothing, keeps the socket, and prompts once', async () => {
    net.signer.mode = 'stall'
    const publishing = publishMany([CANON], anEvent())
    const early = await within(AUTH_WAIT - 100, publishing)
    expect(early.settled).toBe(false)
    const late = await within(200, publishing)
    expect(late.value).toEqual({ ok: false, reason: AUTH_STALLED })
    expect(sent(CANON)).toBe(0)
    expect(dials(CANON)).toBe(1)
    expect(net.signer.prompts).toBe(1)
    // What the store reads to say "Check your signer."
    expect(signerHeld.has(normalizeURL(CANON))).toBe(true)
  })

  it('leaves that relay out and takes the others\' word', async () => {
    const open = 'wss://open.example/'
    net.signer.mode = 'stall'
    const result = await within(AUTH_WAIT + 100, publishMany([CANON, open], anEvent()))
    expect(result.value).toEqual({ ok: true, accepted: [open] })
    expect(sent(CANON)).toBe(0)
  })

  it('a relay that challenges only on the EVENT is bounded too, at 15 s, in the same words, with no second prompt', async () => {
    const late = 'wss://late.example/'
    net.rules.challengesLate.add(late)
    net.signer.mode = 'stall'
    const publishing = publishMany([late], anEvent())
    expect((await within(14_000, publishing)).settled).toBe(false)
    const end = await within(1500, publishing)
    expect(end.value).toEqual({ ok: false, reason: AUTH_STALLED })
    expect(dials(late)).toBe(1)
    expect(net.signer.prompts).toBe(1)
    net.rules.challengesLate.delete(late)
  })
})

describe('the self-check while the signer has not answered: a wrong answer forks a chain', () => {
  it('a gated relay holding the chain answers unknown, never none, though it would have answered an empty EOSE', async () => {
    const c = aChain()
    net.rules.hold.set(CANON, [c.spawn, c.hop1])
    net.signer.mode = 'stall'
    const answers = await within(AUTH_WAIT + 100, askChainEvents(c.pubkey))
    expect(answers.settled).toBe(true)
    expect(answers.value?.[0]).toMatchObject({ outcome: 'refused', reason: AUTH_STALLED })
    const verdict = decideSelfCheck(answers.value ?? [], CANON, true)
    expect(verdict.status).toBe('unknown')
    expect(verdict).toMatchObject({ cause: { kind: 'refused', url: CANON } })
  })

  it('once the signer answers, the same check finds the chain, with no second prompt', async () => {
    const c = aChain()
    net.rules.hold.set(CANON, [c.spawn, c.hop1])
    net.signer.mode = 'stall'
    await within(AUTH_WAIT + 100, askChainEvents(c.pubkey))
    release()
    await vi.advanceTimersByTimeAsync(0)
    const answers = await within(500, askChainEvents(c.pubkey))
    expect(decideSelfCheck(answers.value ?? [], CANON, true).status).toBe('found')
    expect(net.signer.prompts).toBe(1)
    expect(dials(CANON)).toBe(1)
  })

  it('the canonical relay answering with nothing is not none while a relay known to hold this chain waits on the signer; any other relay does not hold it', () => {
    const answers = [
      { url: CANON, outcome: 'answered' as const, events: [] },
      { url: 'wss://mine.example/', outcome: 'refused' as const, reason: AUTH_STALLED, events: [] },
    ]
    expect(decideSelfCheck(answers, CANON, true, new Set(['wss://mine.example/'])).status).toBe('unknown')
    expect(decideSelfCheck(answers, CANON, true, new Set()).status).toBe('none')
    expect(decideSelfCheck(answers.slice(0, 1), CANON, true, new Set(['wss://mine.example/'])).status).toBe('none')
  })
  it('a signer that rejected is the same: unknown, never none, and bounded', async () => {
    const c = aChain()
    net.rules.hold.set(CANON, [c.spawn, c.hop1])
    net.signer.mode = 'reject'
    const answers = await within(AUTH_WAIT + 100, askChainEvents(c.pubkey))
    expect(answers.settled).toBe(true)
    expect(decideSelfCheck(answers.value ?? [], CANON, true).status).toBe('unknown')
    const publishing = await within(AUTH_WAIT + 100, publishMany([CANON], anEvent()))
    expect(publishing.value).toEqual({ ok: false, reason: AUTH_STALLED })
  })

  it('a chain fetch is as on v2: another player\'s chain on the canonical relay comes back whole, whatever your signer did elsewhere (P3, P3b)', async () => {
    const gated = 'wss://mine3.example/'
    const open = 'wss://open3.challenger.example/'
    net.rules.emptyUntilAuthed.add(gated)
    net.rules.openChallenger.add(open)
    useRelays.getState().add(gated)
    useRelays.getState().add(open)
    net.signer.rejectFor.add('wss://mine3.example')
    net.signer.rejectFor.add('wss://open3.challenger.example')
    const c = aChain()
    net.rules.hold.set(CANON, [c.spawn, c.hop1, c.hop2])
    const fetched = await within(10_000, fetchChainEvents(c.pubkey))
    expect(fetched.error).toBeUndefined()
    expect(fetched.value).toHaveLength(3)
  })
})

describe('head confirmation while the signer has not answered: a wrong answer forks a chain', () => {
  it('never passes on a gated relay\'s empty answer: it refuses, however long the signer takes', async () => {
    const c = aChain()
    net.rules.hold.set(CANON, [c.spawn, c.hop1])
    net.signer.mode = 'stall'
    const got = await within(5500, confirmChainEvents(c.pubkey, c.spawn.id, [c.spawn, c.hop1], { since: c.hop1.created_at, anchorId: c.hop1.id }))
    expect(got.settled).toBe(true)
    expect(got.value).toBeNull()
  })
})

describe('head confirmation and a chain holder behind the signer: as on v2, a silent holder never stops the pass (ruling of 2026-10-08, option B)', () => {
  /** The canonical relay signed in, and a gated holder with a new socket: another device's newer move is only there. */
  async function holderBehindSigner(url: string): Promise<{ confirming: () => Promise<NostrEvent[] | null>; c: ReturnType<typeof aChain> }> {
    await within(1000, publishMany([CANON], anEvent()))
    const c = aChain()
    net.rules.emptyUntilAuthed.add(url)
    useRelays.getState().add(url)
    noteChainHolders(c.pubkey, [url])
    net.rules.hold.set(CANON, [c.spawn, c.hop1])
    net.rules.hold.set(url, [c.spawn, c.hop1, c.hop2])
    net.signer.prompts = 0
    return { c, confirming: () => confirmChainEvents(c.pubkey, c.spawn.id, [c.spawn, c.hop1], { since: c.hop1.created_at, anchorId: c.hop1.id }) }
  }

  it('a signer that rejected: the move passes on the canonical relay\'s answer (P4)', async () => {
    const { confirming, c } = await holderBehindSigner('wss://holder.rejected.example/')
    net.signer.mode = 'reject'
    const got = await within(5300, confirming())
    expect(got.settled).toBe(true)
    expect(got.value?.map((e) => e.id)).toContain(c.hop1.id)
  })
  it('a signer that never answers: the move passes once HEAD_CONFIRM_MS is up', async () => {
    const { confirming } = await holderBehindSigner('wss://holder.stalled.example/')
    net.signer.mode = 'stall'
    const got = await within(3000, confirming())
    expect(got.settled).toBe(true)
    expect(got.value).not.toBeNull()
  })
  it('a signer that takes 3 s: the move passes at 2.5 s, without waiting for it, as on v2', async () => {
    const { confirming, c } = await holderBehindSigner('wss://holder.slow.example/')
    net.signer.ms = 3000
    const got = await within(2700, confirming())
    expect(got.settled).toBe(true)
    expect(got.value?.map((e) => e.id)).not.toContain(c.hop2.id)
  })
  it('the canonical relay stalled, with an open relay holding the anchor, refuses the move at 5 s', async () => {
    const open = 'wss://open.anchor.example/'
    const c = aChain()
    useRelays.getState().add(open)
    net.rules.hold.set(CANON, [c.spawn, c.hop1, c.hop2])
    net.rules.hold.set(open, [c.spawn, c.hop1])
    net.signer.mode = 'stall'
    const asking = confirmChainEvents(c.pubkey, c.spawn.id, [c.spawn, c.hop1], { since: c.hop1.created_at, anchorId: c.hop1.id })
    expect((await within(4800, asking)).settled).toBe(false)
    const got = await within(500, asking)
    expect(got.settled).toBe(true)
    expect(got.value).toBeNull()
  })
})

describe('a publish to a dead relay and a gated one', () => {
  it('keeps the gated relay\'s socket when the retry drops the dead one: one socket, one prompt', async () => {
    const dead = 'wss://dead.example/'
    const gated = 'wss://gated.example/'
    net.rules.refuse.add(dead)
    net.rules.emptyUntilAuthed.add(gated)
    net.signer.mode = 'stall'
    const publishing = publishMany([dead, gated], anEvent())
    const result = await within(2 * AUTH_WAIT + 200, publishing)
    expect(result.value?.ok).toBe(false)
    expect(dials(gated)).toBe(1)
    expect(net.signer.prompts).toBe(1)
  })
})

describe('a relay that challenges late', () => {
  /** Past the 0.4 s a first look waits, and before the second look at 1.4 s. */
  const LATE = 800

  it('the self-check looks twice, and a good signer finds the chain at 1.4 s, not none', async () => {
    const c = aChain()
    net.rules.emptyUntilAuthed.delete(CANON)
    net.rules.challengeAfterMs.set(CANON, LATE)
    net.rules.hold.set(CANON, [c.spawn, c.hop1])
    const answers = await within(1600, askChainEvents(c.pubkey))
    expect(answers.settled).toBe(true)
    expect(decideSelfCheck(answers.value ?? [], CANON, true).status).toBe('found')
    expect(net.signer.prompts).toBe(1)
  })

  it('with a signer that rejected, the self-check says unknown, never none', async () => {
    const c = aChain()
    net.rules.emptyUntilAuthed.delete(CANON)
    net.rules.challengeAfterMs.set(CANON, LATE)
    net.rules.hold.set(CANON, [c.spawn, c.hop1])
    net.signer.mode = 'reject'
    const answers = await within(1500 + AUTH_WAIT, askChainEvents(c.pubkey))
    expect(answers.settled).toBe(true)
    expect(decideSelfCheck(answers.value ?? [], CANON, true).status).toBe('unknown')
  })

  it('an open canonical relay with no chain still says none, at 1.4 s: a new identity must not hold forever', async () => {
    const c = aChain()
    net.rules.emptyUntilAuthed.delete(CANON)
    const asking = askChainEvents(c.pubkey)
    expect((await within(1300, asking)).settled).toBe(false)
    const answers = await within(300, asking)
    expect(answers.settled).toBe(true)
    expect(decideSelfCheck(answers.value ?? [], CANON, true).status).toBe('none')
    expect(net.signer.prompts).toBe(0)
  })

  it('a challenge that lands while a read is out is answered, and the read asked again, instead of believing its empty EOSE', async () => {
    const late = 'wss://late.eose.example/'
    const event = anEvent()
    net.rules.challengeAfterMs.set(late, 420)
    net.rules.eoseMs.set(late, 200)
    net.rules.hold.set(late, [event as never])
    const answers = await within(1500, queryEachAt([late], { kinds: [3333] }))
    expect(answers.value?.[0].outcome).toBe('answered')
    expect(answers.value?.[0].events.map((e) => e.id)).toEqual([event.id])
    expect(net.signer.prompts).toBe(1)
  })

  it('remembers no challenge per socket: a new socket to the same relay is looked at again', async () => {
    const late = 'wss://late.socket.example/'
    await within(1000, publishMany([late], anEvent()))
    dropRelays([late])
    net.rules.emptyUntilAuthed.add(late)
    await within(1000, queryEachAt([late], FILTER))
    expect(net.signer.prompts).toBe(1)
  })
})

describe('the relay is not to blame for the signer', () => {
  it('two reads with a stalled signer do not mark it hung: it is still asked, and takes the event when the signer lands', async () => {
    const mine = 'wss://mine.blameless.example/'
    net.rules.emptyUntilAuthed.add(mine)
    net.signer.mode = 'stall'
    for (let i = 0; i < 2; i++) {
      const read = await within(AUTH_WAIT + 100, queryEachAt([mine], FILTER))
      expect(read.value?.[0]).toMatchObject({ outcome: 'refused', reason: AUTH_STALLED })
    }
    release()
    await vi.advanceTimersByTimeAsync(0)
    const published = await within(500, publishMany([mine], anEvent()))
    expect(published.value).toEqual({ ok: true, accepted: [mine] })
    expect(sent(mine)).toBe(1)
    expect(dials(mine)).toBe(1)
    expect(net.signer.prompts).toBe(1)
    net.rules.emptyUntilAuthed.delete(mine)
  })
})

describe('a slow signer', () => {
  it('that takes 3 s lands a publish with one prompt', async () => {
    net.signer.ms = 3000
    const result = await within(3500, publishMany([CANON], anEvent()))
    expect(result.value).toEqual({ ok: true, accepted: [CANON] })
    expect(net.signer.prompts).toBe(1)
    expect(dials(CANON)).toBe(1)
  })

  it('that takes 3 s lands a read with one prompt, and the read sees what the relay holds behind its AUTH', async () => {
    const c = aChain()
    net.rules.hold.set(CANON, [c.spawn, c.hop1])
    net.signer.ms = 3000
    const answers = await within(3500, askChainEvents(c.pubkey))
    expect(decideSelfCheck(answers.value ?? [], CANON, true).status).toBe('found')
    expect(net.signer.prompts).toBe(1)
  })

  it('that takes 3 s lands a head confirmation past its 2.5 s, with one prompt, and it sees what the relay holds', async () => {
    const c = aChain()
    net.rules.hold.set(CANON, [c.spawn, c.hop1])
    net.signer.ms = 3000
    const got = await within(3500, confirmChainEvents(c.pubkey, c.spawn.id, [c.spawn], { anchorId: c.spawn.id }))
    expect(got.settled).toBe(true)
    expect(got.value?.map((e) => e.id)).toContain(c.hop1.id)
    expect(net.signer.prompts).toBe(1)
  })

  it('a signer that answers just past the bound lands on the next try: same socket, same prompt', async () => {
    net.signer.mode = 'stall'
    const first = await within(AUTH_WAIT + 100, publishMany([CANON], anEvent()))
    expect(first.value).toEqual({ ok: false, reason: AUTH_STALLED })
    release()
    await vi.advanceTimersByTimeAsync(0)
    const next = await within(500, publishMany([CANON], anEvent()))
    expect(next.value).toEqual({ ok: true, accepted: [CANON] })
    expect(dials(CANON)).toBe(1)
    expect(net.signer.prompts).toBe(1)
    expect(signerHeld.has(normalizeURL(CANON))).toBe(false)
  })
})

describe('dropping the sockets', () => {
  it('forgets the waiting AUTH, so a fresh socket asks again and is read', async () => {
    const c = aChain()
    net.rules.hold.set(CANON, [c.spawn, c.hop1])
    net.signer.mode = 'reject'
    await within(AUTH_WAIT + 100, askChainEvents(c.pubkey))
    dropRelays([CANON])
    net.signer.mode = 'ok'
    const answers = await within(500, askChainEvents(c.pubkey))
    expect(decideSelfCheck(answers.value ?? [], CANON, true).status).toBe('found')
  })
})

describe('a canonical relay that does not gate, and another relay that does', () => {
  it('answers unknown over the real pool while a relay known to hold this chain waits on the signer, and none for one that never held it', async () => {
    const mine = 'wss://mine.mixed.example/'
    const c = aChain()
    net.rules.emptyUntilAuthed.add(mine)
    net.rules.emptyUntilAuthed.delete(CANON)
    useRelays.getState().add(mine)
    net.rules.hold.set(mine, [c.spawn, c.hop1])
    net.signer.mode = 'stall'
    const answers = await within(AUTH_WAIT + 2000, askChainEvents(c.pubkey))
    expect(answers.value?.find((a) => a.url === CANON)?.outcome).toBe('answered')
    expect(decideSelfCheck(answers.value ?? [], CANON, true, new Set([mine])).status).toBe('unknown')
    expect(decideSelfCheck(answers.value ?? [], CANON, true, new Set()).status).toBe('none')
  })
})

describe('review of #570 (2026-11-04): each as on v2, or safer for the canonical relay', () => {
  it('P1: a new identity, with a gated relay of its own that never held its chain and whose AUTH the signer turned down, says none', async () => {
    const mine = 'wss://mine.example/'
    net.rules.emptyUntilAuthed.add(mine)
    useRelays.getState().add(mine)
    net.signer.rejectFor.add('wss://mine.example')
    const c = aChain()
    const answers = await within(8000, askChainEvents(c.pubkey))
    expect(decideSelfCheck(answers.value ?? [], CANON, true, chainHolders(c.pubkey)).status).toBe('none')
  })

  it('P1, a holder: unknown, and CHECK AGAIN asks the signer again for that relay, and then reads it', async () => {
    const mine = 'wss://mine.holder.example/'
    const c = aChain()
    net.rules.emptyUntilAuthed.add(mine)
    useRelays.getState().add(mine)
    noteChainHolders(c.pubkey, [mine])
    net.rules.hold.set(mine, [c.spawn, c.hop1])
    net.signer.rejectFor.add('wss://mine.holder.example')
    const first = await within(8000, askChainEvents(c.pubkey))
    expect(decideSelfCheck(first.value ?? [], CANON, true, chainHolders(c.pubkey)).status).toBe('unknown')
    expect(signerHeld.has(mine)).toBe(true)
    const before = net.signer.prompts
    net.signer.rejectFor.clear()
    // What CHECK AGAIN does (selfSync recheckNow), then its check.
    for (const url of [...signerHeld]) retryFailedAuth(url)
    const again = await within(8000, askChainEvents(c.pubkey))
    expect(net.signer.prompts).toBeGreaterThan(before)
    expect(decideSelfCheck(again.value ?? [], CANON, true, chainHolders(c.pubkey)).status).toBe('found')
  })

  it('P1b: an open relay that challenges on connect, its AUTH turned down by the signer, does not hold a new identity', async () => {
    const open = 'wss://open.challenger.example/'
    net.rules.openChallenger.add(open)
    useRelays.getState().add(open)
    net.signer.rejectFor.add('wss://open.challenger.example')
    const c = aChain()
    const answers = await within(8000, askChainEvents(c.pubkey))
    expect(decideSelfCheck(answers.value ?? [], CANON, true, chainHolders(c.pubkey)).status).toBe('none')
  })

  it('a relay that turned its AUTH down itself (not the signer) answers as on v2: its empty EOSE is its answer', async () => {
    const own = 'wss://relay.refuses.example/'
    net.rules.emptyUntilAuthed.add(own)
    net.rules.refuseFirstAuth.add(own)
    const [answer] = (await within(3000, queryEachAt([own], FILTER))).value ?? []
    expect(answer).toMatchObject({ outcome: 'answered' })
    expect(signerHeld.has(own)).toBe(false)
  })
  it('P2: a relay that turned the first socket\'s AUTH down itself is asked again over a fresh socket, as on v2', async () => {
    net.rules.refuseFirstAuth.add(CANON)
    const first = await within(20_000, publishMany([CANON], anEvent()))
    expect(first.value).toEqual({ ok: true, accepted: [CANON] })
    expect(dials(CANON)).toBe(2)
    const second = await within(20_000, publishMany([CANON], anEvent()))
    expect(second.value).toEqual({ ok: true, accepted: [CANON] })
  })

  it('P4: a move with a holder whose AUTH the signer turned down passes on both tries, as on v2', async () => {
    await within(1000, publishMany([CANON], anEvent()))
    const holder = 'wss://holder.p4.example/'
    const c = aChain()
    net.rules.emptyUntilAuthed.add(holder)
    useRelays.getState().add(holder)
    noteChainHolders(c.pubkey, [holder])
    net.rules.hold.set(CANON, [c.spawn, c.hop1])
    net.rules.hold.set(holder, [c.spawn, c.hop1])
    net.signer.rejectFor.add('wss://holder.p4.example')
    const opts = { since: c.hop1.created_at, anchorId: c.hop1.id }
    const t1 = await within(6000, confirmChainEvents(c.pubkey, c.spawn.id, [c.spawn, c.hop1], opts))
    const t2 = await within(6000, confirmChainEvents(c.pubkey, c.spawn.id, [c.spawn, c.hop1], { ...opts, reconnect: true }))
    expect(t1.value).toHaveLength(2)
    expect(t2.value).toHaveLength(2)
  })

  for (const ms of [6000, 9000, 12_000]) {
    // The second try (reconnect) drops the canonical socket, as on v2, and its new AUTH may still be signing: then it
    // refuses rather than pass on an empty answer read before the AUTH, which v2 took (safer for the canonical relay).
    it(`P6: a working bunker taking ${ms} ms per AUTH, holder on a new socket: the move passes, as on v2`, async () => {
      net.signer.ms = 3000
      await within(4000, publishMany([CANON], anEvent()))
      const holder = `wss://bunker${ms}.holder.example/`
      const c = aChain()
      net.rules.emptyUntilAuthed.add(holder)
      useRelays.getState().add(holder)
      noteChainHolders(c.pubkey, [holder])
      net.rules.hold.set(CANON, [c.spawn, c.hop1])
      net.rules.hold.set(holder, [c.spawn, c.hop1])
      net.signer.ms = ms
      const opts = { since: c.hop1.created_at, anchorId: c.hop1.id }
      const t1 = await within(5300, confirmChainEvents(c.pubkey, c.spawn.id, [c.spawn, c.hop1], opts))
      expect(t1.settled).toBe(true)
      expect(t1.value).not.toBeNull()
    })
  }

  it('the canonical relay kept from being read by the signer refuses the move, though another relay answered holding the anchor (v2 would pass)', async () => {
    const open = 'wss://open.anchor2.example/'
    const c = aChain()
    useRelays.getState().add(open)
    net.rules.hold.set(CANON, [c.spawn, c.hop1, c.hop2])
    net.rules.hold.set(open, [c.spawn, c.hop1])
    net.signer.rejectFor.add(CYBERSPACE_RELAY)
    const got = await within(5300, confirmChainEvents(c.pubkey, c.spawn.id, [c.spawn, c.hop1], { since: c.hop1.created_at, anchorId: c.hop1.id }))
    expect(got.settled).toBe(true)
    expect(got.value).toBeNull()
  })

  it('a question ended before the canonical relay answered, its AUTH still signing, says the signer, not silence', async () => {
    net.signer.mode = 'stall'
    const stop = new AbortController()
    const asking = queryEachSettled([CANON], FILTER, 2500, CANON, [], { stop: stop.signal })
    await vi.advanceTimersByTimeAsync(600)
    stop.abort()
    const [answer] = (await within(10, asking)).value ?? []
    expect(answer).toMatchObject({ outcome: 'refused', reason: AUTH_STALLED })
  })

  it('a publish that timed out on its socket says so, even on a relay the signer turned down before', async () => {
    const x = 'wss://open.swallow.example/'
    net.rules.openChallenger.add(x)
    net.rules.swallowFirstEvent.add(x)
    net.signer.rejectFor.add('wss://open.swallow.example')
    await within(1000, queryEachAt([x], FILTER))
    expect(signerHeld.has(x)).toBe(true)
    const result = await within(20_000, publishMany([x], anEvent()))
    expect(result.value).toMatchObject({ ok: false, reason: expect.stringMatching(/publish timed out/) })
  })

  it('a relay the signer holds up does not keep the others from being asked again over fresh sockets, as on v2', async () => {
    const held = 'wss://held.first.example/'
    const other = 'wss://other.swallow.example/'
    net.rules.emptyUntilAuthed.add(held)
    net.rules.swallowFirstEvent.add(other)
    net.signer.rejectFor.add('wss://held.first.example')
    const result = await within(40_000, publishMany([held, other], anEvent()))
    expect(result.value).toEqual({ ok: true, accepted: [other] })
    expect(dials(held)).toBe(1)
    expect(dials(other)).toBe(2)
  })
})
