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
}))
vi.mock('../relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../relay')>()
  return {
    ...actual,
    relaySet: () => [actual.CYBERSPACE_RELAY, net.user],
    dropRelays: (relays: string[]) => { net.log.push(`drop ${relays.join(',')}`) },
    queryEachSettled: async (relays: string[], filter: Record<string, unknown>) => {
      net.log.push(`ask ${relays.join(',')}`)
      net.filters.push(filter)
      return relays.map((url) => {
        const a = net.answers.get(url) ?? { outcome: 'answered' as const, events: [] }
        return a.outcome === 'answered' ? { url, outcome: 'answered', events: a.events } : { url, outcome: 'unreachable', reason: 'no answer in time', events: a.events }
      })
    },
  }
})

import { normalizeURL } from 'nostr-tools/utils'
import { confirmChainEvents } from '../chains'
import { CYBERSPACE_RELAY } from '../relay'
import { hopTemplate, spawnTemplate, type NostrEvent } from '../events'

const PK = 'ab'.repeat(32)
const spawn: NostrEvent = { ...spawnTemplate(PK, 1_000), id: 'cd'.repeat(32), pubkey: PK, sig: '0'.repeat(128) }
const child: NostrEvent = { ...hopTemplate({ createdAt: 1_010, genesisId: spawn.id, previousId: spawn.id, prevCoordHex: PK, to: { x: 1n, y: 1n, z: 1n }, plane: 0, proofHash: '0'.repeat(64) }), id: 'ee'.repeat(32), pubkey: PK, sig: '0'.repeat(128) }
const canonical = normalizeURL(CYBERSPACE_RELAY)
/** The player's own relay, as confirmation names it (normalized). */
const user = normalizeURL(net.user)
const reset = (): void => { net.answers.clear(); net.log = []; net.filters = [] }

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
})
