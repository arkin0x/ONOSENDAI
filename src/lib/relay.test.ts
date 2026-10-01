import { beforeEach, describe, expect, it, vi } from 'vitest'

// A pool whose first publish fails the way a half-open socket does, and whose
// second, over fresh sockets, is accepted.
const calls: { publish: string[][]; closed: string[][] } = { publish: [], closed: [] }
let answers: Array<'ok' | Error | 'unreachable'> = []

/**
 * How the one fake relay answers a REQ in the queryEach tests. Its EOSE timer
 * behaves like nostr-tools' own: when `eoseTimeout` runs out it calls the
 * same oneose a real EOSE calls, which is exactly the masquerade queryEach
 * must not fall for.
 */
let behavior: 'eose' | 'events' | 'refuse' | 'silent' | 'down' = 'eose'
const seen: { eoseTimeout: number[] } = { eoseTimeout: [] }
interface FakeParams { onevent: (e: unknown) => void; oneose: () => void; onclose: (r: string) => void; eoseTimeout: number }
const fakeRelay = {
  subscribe(_filters: unknown, p: FakeParams) {
    seen.eoseTimeout.push(p.eoseTimeout)
    const handle = setTimeout(() => p.oneose(), p.eoseTimeout)
    if (behavior === 'eose') setTimeout(() => p.oneose(), 1)
    if (behavior === 'events') setTimeout(() => { p.onevent({ id: 'e1' }); p.oneose() }, 1)
    if (behavior === 'refuse') setTimeout(() => p.onclose('restricted: members only'), 1)
    return { eoseTimeoutHandle: handle, close: () => { clearTimeout(handle); p.onclose('closed by caller') } }
  },
}

vi.mock('nostr-tools/abstract-pool', () => ({
  AbstractSimplePool: class {
    ensureRelay(): Promise<object> {
      if (behavior === 'down') return Promise.reject(new Error('connection failed'))
      return Promise.resolve(fakeRelay)
    }
    publish(relays: string[]): Promise<string>[] {
      calls.publish.push(relays)
      const a = answers.shift() ?? 'ok'
      // nostr-tools resolves, not rejects, when it cannot connect.
      if (a === 'unreachable') return relays.map(() => Promise.resolve('connection failure: connection failed'))
      return relays.map(() => (a === 'ok' ? Promise.resolve('ok') : Promise.reject(a)))
    }
    close(relays: string[]): void { calls.closed.push(relays) }
    subscribe(): { close: () => void } { return { close: () => {} } }
  },
}))

import { publishMany, queryEach } from './relay'

const event = { id: 'a', pubkey: 'b', created_at: 1, kind: 1, tags: [], content: '', sig: 'c' } as never

describe('publishMany', () => {
  beforeEach(() => { calls.publish = []; calls.closed = []; answers = [] })

  it('drops the sockets and sends once more after a timeout', async () => {
    answers = [new Error('publish timed out'), 'ok']
    expect(await publishMany(['wss://one'], event)).toEqual({ ok: true })
    expect(calls.publish).toHaveLength(2)
    expect(calls.closed).toEqual([['wss://one']])
  })

  it('takes a relay refusal as final', async () => {
    answers = [new Error('blocked: not welcome')]
    expect(await publishMany(['wss://one'], event)).toEqual({ ok: false, reason: 'blocked: not welcome' })
    expect(calls.publish).toHaveLength(1)
    expect(calls.closed).toEqual([])
  })

  it('does not count a relay it could not connect to as accepting the event', async () => {
    answers = ['unreachable', 'unreachable']
    expect(await publishMany(['wss://one'], event)).toEqual({ ok: false, reason: 'connection failure: connection failed' })
    // Not a refusal, so the sockets were dropped and it was tried once more.
    expect(calls.publish).toHaveLength(2)
  })

  it('reports the second failure when fresh sockets do not help either', async () => {
    answers = [new Error('publish timed out'), new Error('relay connection closed')]
    expect(await publishMany(['wss://one'], event)).toEqual({ ok: false, reason: 'relay connection closed' })
    expect(calls.publish).toHaveLength(2)
  })
})

describe('queryEach', () => {
  beforeEach(() => { seen.eoseTimeout = [] })

  it('reports a real EOSE as answered, with what came before it', async () => {
    behavior = 'events'
    const [a] = await queryEach({ kinds: [3333] }, 1000)
    expect(a).toMatchObject({ outcome: 'answered' })
    expect(a.events.map((e) => e.id)).toEqual(['e1'])
    behavior = 'eose'
    expect((await queryEach({ kinds: [3333] }, 1000))[0]).toMatchObject({ outcome: 'answered', events: [] })
  })

  it('never lets nostr-tools\' EOSE timer stand in for an answer', async () => {
    behavior = 'silent'
    const [a] = await queryEach({ kinds: [3333] }, 60)
    expect(a).toMatchObject({ outcome: 'unreachable', reason: 'no answer in time' })
    // The library was told to wait far past our own deadline.
    expect(Math.min(...seen.eoseTimeout)).toBeGreaterThanOrEqual(60_000)
  })

  it('reports a relay refusal with its reason', async () => {
    behavior = 'refuse'
    expect((await queryEach({ kinds: [3333] }, 1000))[0]).toMatchObject({ outcome: 'refused', reason: 'restricted: members only' })
  })

  it('reports a relay it could not connect to as unreachable', async () => {
    behavior = 'down'
    expect((await queryEach({ kinds: [3333] }, 1000))[0]).toMatchObject({ outcome: 'unreachable', reason: 'connection failed' })
  })
})
