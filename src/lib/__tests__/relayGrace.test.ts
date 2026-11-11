/**
 * relayGrace.test.ts: a read with `graceMs` (TV's tape, store/useTv askTape)
 * settles that long after the first relay answers, not when the slowest
 * does; what the slow relay sent by then still counts, and a relay ended
 * that way is never taken for hung (2026-11-11: TUNING waited on the slower
 * of two relays, two to three seconds a question).
 */

import { describe, expect, it, vi } from 'vitest'

// relay.ts itself, over a fake pool, not the tests' offline relay (src/test/noNetwork.ts).
vi.unmock('../relay')

const FAST = 'ws://fast.relay/'
const SLOW = 'ws://slow.relay/'

/** How long each relay takes to send EOSE, and the event each sends at once. */
const fake = vi.hoisted(() => ({ eoseMs: new Map<string, number>() }))
vi.mock('nostr-tools/abstract-pool', () => {
  class FakeRelay {
    challenge: string | undefined
    constructor(public url: string) {}
    subscribe(_f: unknown, h: { onevent: (e: unknown) => void; oneose: () => void }): { close: () => void } {
      const sent = setTimeout(() => h.onevent({ id: `e-${this.url}` }), 1)
      const done = setTimeout(() => h.oneose(), fake.eoseMs.get(this.url) ?? 1)
      return { close: () => { clearTimeout(sent); clearTimeout(done) } }
    }
  }
  const relays = new Map<string, FakeRelay>()
  class AbstractSimplePool {
    async ensureRelay(url: string): Promise<FakeRelay> {
      if (!relays.has(url)) relays.set(url, new FakeRelay(url))
      return relays.get(url) as FakeRelay
    }
    close(): void {}
    publish(): Promise<string>[] { return [] }
  }
  return { AbstractSimplePool }
})

import { queryEach } from '../relay'
import { useRelays } from '../../store/useRelays'

describe('a read with graceMs', () => {
  it('settles graceMs after the first answer, keeping what the slow relay sent, as no answer in time', async () => {
    useRelays.setState({ relays: [FAST, SLOW] })
    fake.eoseMs.set(FAST, 5).set(SLOW, 3_000)
    const began = Date.now()
    const answers = await queryEach({ kinds: [3333] }, 8_000, { graceMs: 100 })
    expect(Date.now() - began).toBeLessThan(1_000)
    const fast = answers.find((a) => a.url === FAST)!
    const slow = answers.find((a) => a.url === SLOW)!
    expect(fast.outcome).toBe('answered')
    expect(slow.outcome).toBe('unreachable')
    expect(slow.events.map((e) => e.id)).toEqual([`e-${SLOW}`])
  })

  it('without it, waits for every relay, as before', async () => {
    useRelays.setState({ relays: [FAST, SLOW] })
    fake.eoseMs.set(FAST, 5).set(SLOW, 300)
    const answers = await queryEach({ kinds: [3333] }, 8_000)
    expect(answers.every((a) => a.outcome === 'answered')).toBe(true)
  })

  it('a relay cut short by it, again and again, is not left alone as hung', async () => {
    useRelays.setState({ relays: [FAST, SLOW] })
    fake.eoseMs.set(FAST, 5).set(SLOW, 3_000)
    await queryEach({ kinds: [3333] }, 8_000, { graceMs: 50 })
    // Two full timeouts a second apart would make a relay hung (relay.ts HUNG_AFTER).
    await new Promise((r) => setTimeout(r, 1_100))
    await queryEach({ kinds: [3333] }, 8_000, { graceMs: 50 })
    fake.eoseMs.set(SLOW, 5)
    const answers = await queryEach({ kinds: [3333] }, 8_000)
    expect(answers.find((a) => a.url === SLOW)!.outcome).toBe('answered')
  })
})
