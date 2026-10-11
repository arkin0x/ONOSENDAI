/**
 * resumeListeners.test.ts: one resume runs each listener once (arkinox,
 * 2026-10-11). Backgrounding the installed PWA on Android with an agent's TALK
 * open came back to a black screen and, about 30 seconds later, Aw, Snap.
 * The DM store's resume listener closes its reading and starts it again,
 * which drops that listener and adds a new one to the set resumeLive was
 * walking. A Set's iteration visits what is added during it, so the new
 * listener ran in the same pass, added another, and so on without end: the
 * main thread never yielded and every turn opened fresh relay reads until
 * the renderer ran out of memory.
 *
 * Only fake relays: the pool is mocked and the DM transport's reads are
 * counted, never sent.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('nostr-tools/abstract-pool', () => ({
  AbstractSimplePool: class {
    ensureRelay(): Promise<object> { return Promise.reject(new Error('no relays in tests')) }
    publish(relays: string[]): Promise<string>[] { return relays.map(() => Promise.resolve('ok')) }
    close(): void {}
    subscribe(): { close: () => void } { return { close: () => {} } }
  },
}))

import { generateSecretKey } from 'nostr-tools/pure'
import '../../store/useCyberspace'
import { onResume, resumeLive } from '../relay'
import { localSigner } from '../signers'
import { dmDeps, openConversation, resetAgentDms, type DmTransport } from '../../store/useAgentDms'

/** Far more than any honest resume needs; past it the loop is broken by a throw so the test fails instead of hanging. */
const RUNAWAY = 1000

const stops: (() => void)[] = []
afterEach(() => { for (const s of stops.splice(0)) s() })

describe('resumeLive', () => {
  it('runs a listener that re-registers itself once per resume, not again in the same pass', () => {
    let calls = 0
    let stop: () => void = () => undefined
    const listen = (): void => {
      stop = onResume(() => {
        calls += 1
        if (calls > RUNAWAY) throw new Error('runaway')
        stop()
        listen()
      })
    }
    listen()
    stops.push(() => stop())
    resumeLive()
    expect(calls).toBe(1)
    resumeLive()
    expect(calls).toBe(2)
  })

  it('does not run a listener removed by an earlier one in the same pass', () => {
    const ran: string[] = []
    let stopB: () => void = () => undefined
    const stopA = onResume(() => { ran.push('a'); stopB() })
    stopB = onResume(() => { ran.push('b') })
    stops.push(stopA, stopB)
    resumeLive()
    expect(ran).toEqual(['a'])
  })
})

describe('agent DMs on resume', () => {
  const saved = { ...dmDeps }
  afterEach(() => {
    resetAgentDms()
    dmDeps.transport = saved.transport
    dmDeps.keys = saved.keys
  })

  it('a resume with TALK open reopens the inbox reading once, through the real resumeLive', async () => {
    const me = localSigner(generateSecretKey())
    const agent = localSigner(generateSecretKey())
    let reads = 0
    const transport: DmTransport = {
      inboxOf: async (pk) => (pk === me.pubkey ? { relays: ['wss://inbox.example'], answered: true } : { relays: ['wss://agent.example'], answered: true }),
      subscribe: () => {
        reads += 1
        // The crash's shape: without this the test would spin forever.
        if (reads > RUNAWAY) throw new Error('runaway resume loop')
        return () => undefined
      },
      publish: async (relays) => ({ ok: true, accepted: relays }),
      // The real registry, the one resumeLive walks.
      onResume,
    }
    dmDeps.transport = transport
    dmDeps.keys = {
      pubkey: () => me.pubkey,
      sender: () => ({ pubkey: me.pubkey, signEvent: me.signEvent, nip44Encrypt: me.nip44Encrypt! }),
      reader: () => ({ pubkey: me.pubkey, nip44Decrypt: me.nip44Decrypt! }),
      fresh: () => { const s = localSigner(generateSecretKey()); return { pubkey: s.pubkey, signEvent: s.signEvent, nip44Encrypt: s.nip44Encrypt! } },
      agents: () => [agent.pubkey],
    }
    resetAgentDms()
    const close = openConversation(agent.pubkey)
    stops.push(close)
    await new Promise((r) => setTimeout(r, 20))
    expect(reads).toBe(1)
    resumeLive()
    expect(reads).toBe(2)
    resumeLive()
    expect(reads).toBe(3)
  })
})
