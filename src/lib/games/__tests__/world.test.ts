/**
 * world.test.ts - a game's world is the game key's newest bag sealed to the
 * region (DECK-0002 §5.1): nobody else's bag, no forged one, no bag of
 * another place. Real keys, bags and signatures; the bags come from a fixture
 * source, so no relay is asked.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { newShard } from 'sno-core/shards'
import { bagTemplate, shardInnerTemplate } from '../../hidden'
import type { NostrEvent } from '../../events'
import { loadWorld, worldKey } from '../world'
import { TUTORIAL_GAME } from '../tutorialGame'
import type { GameDef } from '../types'

const gameSk = generateSecretKey()
const stranger = generateSecretKey()
const at = { ...TUTORIAL_GAME.region.base, x: TUTORIAL_GAME.region.base.x + 3n }
const shard = (name: string) => ({ ...newShard(name), mode: 'points' as const, unit: 0, vertices: [{ p: [0, 0, 0] as [number, number, number], c: [1, 0, 0] as [number, number, number] }], faces: [] })

async function bag(sk: Uint8Array, name: string, createdAt: number, lookupId?: string): Promise<NostrEvent> {
  const { key, lookupId: d } = worldKey(TUTORIAL_GAME)
  const inner = finalizeEvent(shardInnerTemplate(shard(name), at, 1, createdAt), sk)
  return finalizeEvent(await bagTemplate([inner], key, lookupId ?? d, 6, createdAt), sk)
}

const gameOf = (events: NostrEvent[]): GameDef => ({ ...TUTORIAL_GAME, pubkey: getPublicKey(gameSk), world: { kind: 'fixture', load: async () => events } })

describe('loading a game world', () => {
  it('reads the game key\'s newest bag for the region, and nothing of anyone else\'s', async () => {
    const old = await bag(gameSk, 'old', 100)
    const newest = await bag(gameSk, 'newest', 200)
    const theirs = await bag(stranger, 'theirs', 300)
    const world = await loadWorld(gameOf([old, theirs, newest]))
    expect(world.map((w) => w.shard.name)).toEqual(['newest'])
    expect(world[0].at).toEqual(at)
  })

  it('drops a forged bag and a bag of another place', async () => {
    const good = await bag(gameSk, 'good', 100)
    // From JSON, as a relay delivers it: a spread would carry nostr-tools' cached verdict along.
    const forged = { ...JSON.parse(JSON.stringify(await bag(gameSk, 'forged', 400))), sig: 'ab'.repeat(64) }
    const elsewhere = await bag(gameSk, 'elsewhere', 500, 'cd'.repeat(32))
    const world = await loadWorld(gameOf([forged, elsewhere, good]))
    expect(world.map((w) => w.shard.name)).toEqual(['good'])
  })

  it('an empty source is an empty world', async () => {
    expect(await loadWorld(gameOf([]))).toEqual([])
  })
})
