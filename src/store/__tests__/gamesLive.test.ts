/**
 * gamesLive.test.ts - the tutorial dungeon once its key is the owner's (a
 * live game, lib/games/flag.ts): entered with no games switch, the entry
 * names the game with the canonical relay as its hint, and the world comes
 * from the relays (the owner's world as the generator writes it and nak
 * signs it, lib/games/worldDeploy.ts), entered at TUTORIAL_ENTRY. Every
 * other store test plays the DEV game (src/test/noNetwork.ts).
 *
 * The relays are an in-memory store and nothing publishes anywhere; the key
 * is a fixed throwaway, never anyone's.
 */

import { describe, expect, it, vi } from 'vitest'
import { provedHop } from '../fixtures/provedHop'

const OWNER_SK_HEX = vi.hoisted(() => '11'.repeat(32))
const published = vi.hoisted(() => [] as import('../../lib/events').NostrEvent[])

vi.mock('../../lib/games/tutorialGame', async (orig) => {
  const real = await orig<typeof import('../../lib/games/tutorialGame')>()
  const { getPublicKey } = await import('nostr-tools/pure')
  const { hexToBytes } = await import('../../lib/events')
  const owner = getPublicKey(hexToBytes(OWNER_SK_HEX))
  return { ...real, TUTORIAL_PUBKEY: owner, TUTORIAL_GAME: real.tutorialGameFor(owner) }
})
vi.mock('../../lib/relay', async (orig) => {
  type F = import('nostr-tools/filter').Filter
  type E = import('../../lib/events').NostrEvent
  const matches = (f: F, e: E): boolean =>
    (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f.ids || f.ids.includes(e.id))
    && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? ''))
  return {
    ...(await orig<typeof import('../../lib/relay')>()),
    ...(await import('../../test/offlineRelay')).offlineRelay,
    relaySet: () => ['wss://relay.onosendai.tech'],
    query: async (f: F) => published.filter((e) => matches(f, e)),
    queryAny: async (_r: string[], f: F) => published.filter((e) => matches(f, e)),
  }
})
vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: async () => [],
  confirmChainEvents: async () => [],
}))

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { finalizeEvent } from 'nostr-tools/pure'
import { hexToBytes, type NostrEvent } from '../../lib/events'
import { useCyberspace } from '../useCyberspace'
import { placeSpawn } from '../fixtures/placeSpawn'
import { enterTutorialDungeon, useGame } from '../useGame'
import { TUTORIAL_DEV_PUBKEY, TUTORIAL_ENTRY, TUTORIAL_GAME, TUTORIAL_RELAY } from '../../lib/games/tutorialGame'
import { gameLive } from '../../lib/games/flag'
import { unsignedWorld } from '../../lib/games/worldDeploy'
import fixture from '../../lib/games/tutorialDungeon.fixture.json'

const S = () => useCyberspace.getState()

describe('the tutorial dungeon, live on the owner\'s key', () => {
  it('enters with no switch set, names the canonical relay, and reads the world from the relays', async () => {
    expect(gameLive(TUTORIAL_GAME)).toBe(true)
    const sk = hexToBytes(OWNER_SK_HEX)
    for (const f of await unsignedWorld(TUTORIAL_GAME, fixture.events[0] as NostrEvent, TUTORIAL_DEV_PUBKEY, 1_800_000_000)) {
      published.push(JSON.parse(JSON.stringify(finalizeEvent({ kind: f.event.kind, created_at: f.event.created_at, tags: f.event.tags, content: f.event.content }, sk))) as NostrEvent)
    }
    localStorage.removeItem('onosendai:games')
    await placeSpawn()
    useCyberspace.setState({ pendingTarget: { ...S().position, x: S().position.x + 1n } })
    await S().applyProofMessage({ type: 'done', id: 0, mode: 'hop', elapsedMs: 1, ...provedHop(S()), terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1 })

    expect(await enterTutorialDungeon()).toBeNull()
    const entry = S().events[S().events.length - 1]
    expect(entry.tags.find((t) => t[0] === 'p' && t[3] === 'game')).toEqual(['p', TUTORIAL_GAME.pubkey, TUTORIAL_RELAY, 'game'])
    await vi.waitFor(() => { expect(useGame.getState().session?.world).not.toBeNull() })
    const session = useGame.getState().session!
    expect(session.worldError).toBeNull()
    expect(session.world).toHaveLength(15)
    expect(session.at).toEqual(TUTORIAL_ENTRY)
  })
})
