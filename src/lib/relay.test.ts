import { beforeEach, describe, expect, it, vi } from 'vitest'

// A pool whose first publish fails the way a half-open socket does, and whose
// second, over fresh sockets, is accepted.
const calls: { publish: string[][]; closed: string[][] } = { publish: [], closed: [] }
let answers: Array<'ok' | Error> = []
vi.mock('nostr-tools/abstract-pool', () => ({
  AbstractSimplePool: class {
    ensureRelay(): Promise<object> { return Promise.resolve({}) }
    publish(relays: string[]): Promise<string>[] {
      calls.publish.push(relays)
      const a = answers.shift() ?? 'ok'
      return relays.map(() => (a === 'ok' ? Promise.resolve('ok') : Promise.reject(a)))
    }
    close(relays: string[]): void { calls.closed.push(relays) }
    subscribe(): { close: () => void } { return { close: () => {} } }
  },
}))

import { publishMany } from './relay'

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

  it('reports the second failure when fresh sockets do not help either', async () => {
    answers = [new Error('publish timed out'), new Error('relay connection closed')]
    expect(await publishMany(['wss://one'], event)).toEqual({ ok: false, reason: 'relay connection closed' })
    expect(calls.publish).toHaveLength(2)
  })
})
