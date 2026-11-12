/**
 * relayGrace.test.ts: a read with `graceMs` (TV's tape, store/useTv askTape)
 * settles that long after a pinned relay answers, not when the slowest does;
 * what the slow relay sent by then still counts; a relay a viewer added
 * answering first starts nothing; and a relay ended that way is never taken
 * for hung (2026-11-11: TUNING waited on the slower of two relays, two to
 * three seconds a question).
 */

import { describe, expect, it, vi } from 'vitest'
import { normalizeURL } from 'nostr-tools/utils'

// relay.ts itself, over a fake pool, not the tests' offline relay (src/test/noNetwork.ts).
vi.unmock('../relay')

/** How long each relay takes to send EOSE, and which send no event at all first. */
const fake = vi.hoisted(() => ({ eoseMs: new Map<string, number>(), silent: new Set<string>() }))
vi.mock('nostr-tools/abstract-pool', () => {
  class FakeRelay {
    challenge: string | undefined
    constructor(public url: string) {}
    subscribe(_f: unknown, h: { onevent: (e: unknown) => void; oneose: () => void }): { close: () => void } {
      const sent = fake.silent.has(this.url) ? undefined : setTimeout(() => h.onevent({ id: `e-${this.url}` }), 1)
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
import { DEFAULT_RELAY, SECOND_RELAY, useRelays } from '../../store/useRelays'

const CANON = normalizeURL(DEFAULT_RELAY)
const SECOND = normalizeURL(SECOND_RELAY)
const ADDED = normalizeURL('wss://added.example')

function relays(timing: Array<[string, number]>, silent: string[] = []): void {
  useRelays.setState({ relays: timing.map(([u]) => u) })
  fake.eoseMs.clear()
  for (const [u, ms] of timing) fake.eoseMs.set(u, ms)
  fake.silent = new Set(silent)
}

describe('a read with graceMs', () => {
  it('settles graceMs after a pinned relay answers, keeping what the slow relay sent, as no answer in time', async () => {
    relays([[CANON, 5], [SECOND, 3_000]])
    const began = Date.now()
    const answers = await queryEach({ kinds: [3333] }, 8_000, { graceMs: 100 })
    expect(Date.now() - began).toBeLessThan(1_000)
    const slow = answers.find((a) => a.url === SECOND)!
    expect(answers.find((a) => a.url === CANON)!.outcome).toBe('answered')
    expect(slow.outcome).toBe('unreachable')
    expect(slow.events.map((e) => e.id)).toEqual([`e-${SECOND}`])
  })

  it('a relay the viewer added answering first starts nothing: the pinned relays are waited for', async () => {
    relays([[ADDED, 5], [CANON, 400]])
    const answers = await queryEach({ kinds: [3333] }, 8_000, { graceMs: 50 })
    expect(answers.find((a) => a.url === CANON)!.outcome).toBe('answered')
  })

  it('without it, waits for every relay, as before', async () => {
    relays([[CANON, 5], [SECOND, 300]])
    const answers = await queryEach({ kinds: [3333] }, 8_000)
    expect(answers.every((a) => a.outcome === 'answered')).toBe(true)
  })

  it('a relay it cut short with nothing sent, again and again, is not left alone as hung', async () => {
    relays([[CANON, 5], [SECOND, 3_000]], [SECOND])
    await queryEach({ kinds: [3333] }, 8_000, { graceMs: 50 })
    // Two full timeouts with nothing sent, a second apart, make a relay hung (relay.ts HUNG_AFTER).
    await new Promise((r) => setTimeout(r, 1_100))
    await queryEach({ kinds: [3333] }, 8_000, { graceMs: 50 })
    relays([[CANON, 5], [SECOND, 5]])
    const answers = await queryEach({ kinds: [3333] }, 8_000)
    expect(answers.find((a) => a.url === SECOND)!.outcome).toBe('answered')
  })
})
