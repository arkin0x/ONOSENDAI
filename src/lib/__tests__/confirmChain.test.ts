/**
 * confirmChain.test.ts - confirming a head before a signature asks the
 * canonical relay and every configured relay together (arkinox's ruling of
 * 2026-10-08, option B), only for what is new, over fresh sockets the second
 * time (review of #236, items 2 and 3).
 *
 * What would go wrong silently: a canonical outage stopping every move for
 * everyone; a newer move one of the player's own relays holds passed over;
 * a long chain downloaded again for every move; and a socket gone silent
 * asked again on the second try.
 */

import { describe, expect, it, vi } from 'vitest'

/** What each relay answers this time: an outcome and its events, by URL. */
const net = vi.hoisted(() => ({
  user: 'wss://mine.example',
  answers: new Map<string, { outcome: 'answered' | 'unreachable'; events: unknown[] }>(),
  log: [] as string[],
  filters: [] as Array<Record<string, unknown>>,
  /** Relays whose AUTH is waiting on the signer. */
  authing: new Set<string>(),
  /** How long before each REQ is written (a busy main thread); 0 is at once. */
  reqDelayMs: 0,
  /** The relays each question was told to wait for. */
  waitFor: [] as string[][],
}))
vi.mock('../relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../relay')>()
  return {
    ...actual,
    relaySet: () => [actual.CYBERSPACE_RELAY, net.user],
    dropRelays: (relays: string[]) => { net.log.push(`drop ${relays.join(',')}`) },
    authPending: (url: string) => net.authing.has(url),
    // The startup self-check's question (askChainEvents), answered the same way.
    queryEach: async (filter: Record<string, unknown>) => {
      const { normalizeURL } = await import('nostr-tools/utils')
      net.filters.push(filter)
      return [actual.CYBERSPACE_RELAY, net.user].map((r) => {
        const url = normalizeURL(r)
        const a = net.answers.get(url) ?? { outcome: 'answered' as const, events: [] }
        return a.outcome === 'answered' ? { url, outcome: 'answered', events: a.events } : { url, outcome: 'unreachable', reason: 'no answer in time', events: a.events }
      })
    },
    queryEachSettled: async (relays: string[], filter: Record<string, unknown>, _maxWait: number, _primary: string, waitFor: string[], opts: { onSent?: () => void } = {}) => {
      net.log.push(`ask ${relays.join(',')}`)
      net.filters.push(filter)
      net.waitFor.push(waitFor)
      if (net.reqDelayMs > 0) await new Promise((r) => setTimeout(r, net.reqDelayMs))
      opts.onSent?.()
      return relays.map((url) => {
        const a = net.answers.get(url) ?? { outcome: 'answered' as const, events: [] }
        return a.outcome === 'answered' ? { url, outcome: 'answered', events: a.events } : { url, outcome: 'unreachable', reason: 'no answer in time', events: a.events }
      })
    },
  }
})

import { normalizeURL } from 'nostr-tools/utils'
import { askChainEvents, confirmChainEvents } from '../chains'
import { chainHolders } from '../chainHolders'
import { CYBERSPACE_RELAY } from '../relay'
import { hopTemplate, spawnTemplate, type NostrEvent } from '../events'

const PK = 'ab'.repeat(32)
const spawn: NostrEvent = { ...spawnTemplate(PK, 1_000), id: 'cd'.repeat(32), pubkey: PK, sig: '0'.repeat(128) }
const child: NostrEvent = { ...hopTemplate({ createdAt: 1_010, genesisId: spawn.id, previousId: spawn.id, prevCoordHex: PK, to: { x: 1n, y: 1n, z: 1n }, plane: 0, proofHash: '0'.repeat(64) }), id: 'ee'.repeat(32), pubkey: PK, sig: '0'.repeat(128) }
const canonical = normalizeURL(CYBERSPACE_RELAY)
/** The player's own relay, as confirmation names it (normalized). */
const user = normalizeURL(net.user)
const reset = (): void => { net.answers.clear(); net.log = []; net.filters = []; net.authing.clear(); net.reqDelayMs = 0; net.waitFor = [] }

describe('confirming a head against the canonical relay and the configured relays (option B)', () => {
  it('asks them all together', async () => {
    reset()
    await confirmChainEvents(PK, spawn.id, [spawn])
    expect(net.log.length).toBeGreaterThan(0)
    expect(net.log.every((l) => l === `ask ${canonical},${user}`)).toBe(true)
  })

  it('canonical relay down, a configured relay up and answering nothing newer: passes, degraded', async () => {
    reset()
    net.answers.set(canonical, { outcome: 'unreachable', events: [] })
    expect(await confirmChainEvents(PK, spawn.id, [spawn])).toEqual([])
    expect(net.log).toContain(`ask ${canonical},${user}`)
  })

  it('canonical relay up, a configured relay holding a newer move: the move comes back, for the caller to adopt and refuse on', async () => {
    reset()
    net.answers.set(user, { outcome: 'answered', events: [child] })
    const got = await confirmChainEvents(PK, spawn.id, [spawn])
    expect(got?.map((e) => e.id)).toContain(child.id)
  })

  it('a newer move from a relay that did not finish in time is still handed back', async () => {
    reset()
    net.answers.set(user, { outcome: 'unreachable', events: [child] })
    expect((await confirmChainEvents(PK, spawn.id, [spawn]))?.map((e) => e.id)).toContain(child.id)
  })

  it('no relay answered at all: refused (null)', async () => {
    reset()
    net.answers.set(canonical, { outcome: 'unreachable', events: [] })
    net.answers.set(user, { outcome: 'unreachable', events: [] })
    expect(await confirmChainEvents(PK, spawn.id, [spawn])).toBeNull()
  })

  it('asks the chain only from `since` on, inclusive, and the spawns whole', async () => {
    reset()
    await confirmChainEvents(PK, spawn.id, [spawn], { since: 1_234 })
    expect(net.filters.find((f) => Array.isArray(f['#e']))).toMatchObject({ '#e': [spawn.id], since: 1_234 })
    expect(net.filters.find((f) => Array.isArray(f['#A']))).not.toHaveProperty('since')
  })

  it('with `reconnect`, drops the sockets first; without, does not', async () => {
    reset()
    await confirmChainEvents(PK, spawn.id, [spawn], { reconnect: true })
    expect(net.log[0]).toBe(`drop ${canonical},${user}`)
    reset()
    await confirmChainEvents(PK, spawn.id, [spawn])
    expect(net.log.some((l) => l.startsWith('drop'))).toBe(false)
  })

  it('a redial keeps a socket whose AUTH is still waiting on the signer: the second try rides on it (verification of #236, finding 4)', async () => {
    reset()
    net.authing.add(canonical)
    await confirmChainEvents(PK, spawn.id, [spawn], { reconnect: true })
    expect(net.log[0]).toBe(`drop ${user}`)
  })
})

describe('a degraded pass needs a relay that holds the chain (verification of #236, finding 1)', () => {
  // The newest event already on the relays: `since` is its created_at, and a
  // relay that really holds this chain returns it.
  const anchor = child

  it('canonical relay silent, a configured relay answers with nothing: no pass, refused', async () => {
    reset()
    net.answers.set(canonical, { outcome: 'unreachable', events: [] })
    net.answers.set(user, { outcome: 'answered', events: [] })
    expect(await confirmChainEvents(PK, spawn.id, [spawn, anchor], { since: anchor.created_at, anchorId: anchor.id })).toBeNull()
  })

  it('canonical relay silent, a configured relay answers holding the anchor: a degraded pass', async () => {
    reset()
    net.answers.set(canonical, { outcome: 'unreachable', events: [] })
    net.answers.set(user, { outcome: 'answered', events: [anchor] })
    expect(await confirmChainEvents(PK, spawn.id, [spawn, anchor], { since: anchor.created_at, anchorId: anchor.id })).toEqual([anchor])
  })

  it('canonical relay silent, a configured relay without the anchor but with a newer move: handed back, to adopt and refuse on', async () => {
    reset()
    const newer: NostrEvent = { ...hopTemplate({ createdAt: 1_020, genesisId: spawn.id, previousId: anchor.id, prevCoordHex: PK, to: { x: 2n, y: 1n, z: 1n }, plane: 0, proofHash: '0'.repeat(64) }), id: 'ff'.repeat(32), pubkey: PK, sig: '0'.repeat(128) }
    net.answers.set(canonical, { outcome: 'unreachable', events: [] })
    net.answers.set(user, { outcome: 'answered', events: [newer] })
    expect((await confirmChainEvents(PK, spawn.id, [spawn, anchor], { since: anchor.created_at, anchorId: anchor.id }))?.map((e) => e.id)).toEqual([newer.id])
  })

  it('the canonical relay answering with nothing still counts, as before', async () => {
    reset()
    net.answers.set(canonical, { outcome: 'answered', events: [] })
    net.answers.set(user, { outcome: 'unreachable', events: [] })
    expect(await confirmChainEvents(PK, spawn.id, [spawn, anchor], { since: anchor.created_at, anchorId: anchor.id })).toEqual([])
  })

  it('with nothing of the chain on the relays yet (no anchor), any answer counts, as before', async () => {
    reset()
    net.answers.set(canonical, { outcome: 'unreachable', events: [] })
    net.answers.set(user, { outcome: 'answered', events: [] })
    expect(await confirmChainEvents(PK, spawn.id, [spawn])).toEqual([])
  })
})

describe('the confirmation\'s overall deadline (verification of #236, finding 6)', () => {
  it('runs from the first REQ written, not from the call: a REQ held back by a busy main thread still gets its answer counted', async () => {
    reset()
    // Held back for longer than the whole old budget (2 x 200 + 100 ms).
    net.reqDelayMs = 700
    expect(await confirmChainEvents(PK, spawn.id, [spawn], { maxWait: 200 })).toEqual([])
  })
})

describe('the relays a confirmation waits for (ruling of 2026-10-08 on the slow-relay grace)', () => {
  /** An identity of its own, so what earlier tests taught about PK does not leak in. */
  const PK2 = 'a2'.repeat(32)
  const spawn2: NostrEvent = { ...spawnTemplate(PK2, 2_000), id: 'a3'.repeat(32), pubkey: PK2, sig: '0'.repeat(128) }

  it('the canonical relay alone, until a relay sends back one of the chain\'s events; that relay is waited for from the next confirmation on', async () => {
    reset()
    net.answers.set(user, { outcome: 'answered', events: [] })
    await confirmChainEvents(PK2, spawn2.id, [spawn2])
    expect(net.waitFor.length).toBeGreaterThan(0)
    expect(net.waitFor.every((w) => w.join(',') === canonical)).toBe(true)
    reset()
    net.answers.set(user, { outcome: 'answered', events: [spawn2] })
    await confirmChainEvents(PK2, spawn2.id, [spawn2])
    reset()
    await confirmChainEvents(PK2, spawn2.id, [spawn2])
    expect(net.waitFor.every((w) => w.join(',') === `${canonical},${user}`)).toBe(true)
  })

  it('the startup self-check notes the relays whose answers held the chain', async () => {
    reset()
    const PK3 = 'a4'.repeat(32)
    const spawn3: NostrEvent = { ...spawnTemplate(PK3, 3_000), id: 'a5'.repeat(32), pubkey: PK3, sig: '0'.repeat(128) }
    net.answers.set(user, { outcome: 'answered', events: [spawn3] })
    expect(chainHolders(PK3).has(user)).toBe(false)
    await askChainEvents(PK3)
    expect(chainHolders(PK3).has(user)).toBe(true)
  })
})
