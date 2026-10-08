/**
 * relayTiming.test.ts - a relay's answer is timed from its REQ, and an AUTH
 * waiting on the signer is known and not asked for twice (verification of
 * #236, findings 4 and 6).
 *
 * What would go wrong silently: a main thread busy for seconds after a long
 * chain loads spending a question's whole budget before the REQ went out,
 * so a relay that answered at once read as "no answer"; and a redial that
 * threw away an AUTH still waiting on a remote signer, so the signer was
 * asked a second time and both tries were refused.
 */

import { describe, expect, it, vi } from 'vitest'

/** A stand-in for nostr-tools' pool: relays that answer after `eoseMs`, and challenge when `challenge` is set. */
const fake = vi.hoisted(() => ({
  eoseMs: 20,
  challenge: undefined as string | undefined,
  signerMs: 0,
  signed: 0,
  closed: [] as string[],
  relays: new Map<string, unknown>(),
}))
vi.mock('nostr-tools/abstract-pool', () => {
  class FakeRelay {
    url: string
    challenge: string | undefined
    authPromise: Promise<string> | undefined
    constructor(url: string) { this.url = url; this.challenge = fake.challenge }
    auth(signer: (t: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<unknown>): Promise<string> {
      // As nostr-tools does: one AUTH per socket, the same promise to every caller.
      if (this.authPromise) return this.authPromise
      this.authPromise = (async () => { await signer({ kind: 22242, created_at: 0, tags: [['relay', this.url], ['challenge', this.challenge ?? '']], content: '' }); return 'ok' })()
      return this.authPromise
    }
    subscribe(_filters: unknown, h: { oneose: () => void }): { close: () => void } {
      const t = setTimeout(() => h.oneose(), fake.eoseMs)
      return { close: () => clearTimeout(t) }
    }
  }
  class AbstractSimplePool {
    async ensureRelay(url: string): Promise<FakeRelay> {
      if (!fake.relays.has(url)) fake.relays.set(url, new FakeRelay(url))
      return fake.relays.get(url) as FakeRelay
    }
    close(urls: string[]): void { for (const u of urls) { fake.closed.push(u); fake.relays.delete(u) } }
    publish(): Promise<string>[] { return [] }
  }
  return { AbstractSimplePool }
})
vi.mock('../../store/useCyberspace', () => ({
  useCyberspace: { getState: () => ({ signEvent: async (t: unknown) => { fake.signed++; await new Promise((r) => setTimeout(r, fake.signerMs)); return t } }) },
}))

import { authPending, queryEachSettled } from '../relay'

/** Hold the main thread, as drawing and checking a long chain does. */
const busy = (ms: number): void => { const end = Date.now() + ms; while (Date.now() < end) { /* busy */ } }

describe('the confirmation\'s timing (verification of #236, finding 6)', () => {
  it('a relay that answers soon after its REQ counts, however long the main thread was busy before the REQ went out', async () => {
    fake.relays.clear(); fake.challenge = undefined; fake.eoseMs = 50
    const url = 'ws://relay.one/'
    const asking = queryEachSettled([url], { kinds: [3333] }, 600, url, 400)
    // Before the REQ is written (it waits for a challenge first), the main
    // thread is held for longer than the whole budget.
    setTimeout(() => busy(1_300), 0)
    const [answer] = await asking
    expect(answer.outcome).toBe('answered')
  })
})

describe('an AUTH waiting on the signer (verification of #236, finding 4)', () => {
  it('is known while the signer works, and a second ask rides on it: one AUTH, one prompt', async () => {
    fake.relays.clear(); fake.challenge = 'c1'; fake.eoseMs = 10; fake.signerMs = 300; fake.signed = 0
    const url = 'ws://relay.two/'
    const first = queryEachSettled([url], { kinds: [3333] }, 2_000, url, 400)
    await new Promise((r) => setTimeout(r, 100))
    expect(authPending(url)).toBe(true)
    const second = queryEachSettled([url], { kinds: [3333] }, 2_000, url, 400)
    const [a, b] = await Promise.all([first, second])
    expect(a[0].outcome).toBe('answered')
    expect(b[0].outcome).toBe('answered')
    expect(fake.signed).toBe(1)
    expect(authPending(url)).toBe(false)
  })
})
