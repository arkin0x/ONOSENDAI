/**
 * tutorialDungeon.gen.test.ts - the GENERATOR of the tutorial dungeon's bag,
 * not a test. Skipped unless asked for. Two uses, one builder:
 *
 * The DEV fixture (lib/games/tutorialDungeon.fixture.json), for LOCAL play:
 *
 *   GEN_TUTORIAL_DUNGEON=1 \
 *   TUTORIAL_PIECES=/data/Sync/agents/claude/onosendai/games-dungeon/v1/pieces \
 *   TUTORIAL_KEY=/data/claude/secrets/onosendai-tutorial-game-DEV.hex \
 *   npx vitest run src/lib/games/__tests__/tutorialDungeon.gen.test.ts
 *
 * The owner's bag, signed by the game key he holds (DEPLOY.md): the same,
 * with TUTORIAL_KEY his key's file (64 hex or an nsec) and TUTORIAL_OUT the
 * file to write the signed bag to. It never writes the fixture for a key that
 * is not TUTORIAL_GAME's, and never sends anything anywhere: lib/relay is the
 * offline relay in every test file. He publishes the file himself.
 *
 * The pieces are Maze Kit payloads (main) and the key, built by
 * games-dungeon/v1/build-pieces.ts. Each is placed where
 * TUTORIAL_DUNGEON_LAYOUT says, as a shard item in one bag sealed to the
 * game's region with its key, every item and the bag signed by the one key.
 * First in the list is the entry marker (pieces/entry.json, an original flat
 * star), inline, carrying the `entry` tag at TUTORIAL_ENTRY (DECK-0002 §2.2).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { fromPayload } from 'sno-core/shards'
import { bagTemplate, shardInnerTemplate } from '../../hidden'
import { hexToBytes } from '../../events'
import { BAG_SAFE_BYTES, signedBytes } from '../../bagSize'
import { TUTORIAL_DEV_PUBKEY, TUTORIAL_DUNGEON_LAYOUT, TUTORIAL_ENTRY, TUTORIAL_GAME } from '../tutorialGame'
import { inRegion } from '../play'
import { ENTRY_TAG, worldKey } from '../world'

const asked = process.env.GEN_TUTORIAL_DUNGEON === '1'

/** A secret key from a file: 64 hex, or an nsec. */
function secretFrom(path: string): Uint8Array {
  const raw = readFileSync(path, 'utf8').trim()
  if (raw.startsWith('nsec1')) {
    const d = nip19.decode(raw)
    if (d.type !== 'nsec') throw new Error('not an nsec')
    return d.data
  }
  return hexToBytes(raw)
}

describe('the tutorial dungeon (generator)', () => {
  it.skipIf(!asked)('signs the dungeon bag and writes it', async () => {
    const sk = secretFrom(process.env.TUTORIAL_KEY ?? process.env.TUTORIAL_DEV_KEY ?? '')
    const pubkey = getPublicKey(sk)
    // The DEV key by its own constant, never by TUTORIAL_GAME.pubkey: once the owner's key is the game's, his bag
    // must still go to TUTORIAL_OUT, dated now, and never into the DEV fixture (review of #668).
    const dev = pubkey === TUTORIAL_DEV_PUBKEY
    const fixture = resolve(__dirname, '..', 'tutorialDungeon.fixture.json')
    const out = dev ? fixture : process.env.TUTORIAL_OUT
    if (!out) throw new Error('This key is not the DEV key: say where to write its bag with TUTORIAL_OUT.')
    if (!dev && resolve(out) === fixture) throw new Error('The DEV fixture is only ever signed by the DEV key: write this bag elsewhere.')
    const dir = process.env.TUTORIAL_PIECES ?? ''
    // The DEV fixture at one fixed moment, so a regenerated bag differs only in its signatures; the owner's bag now.
    const createdAt = dev ? 1_794_300_000 : Math.floor(Date.now() / 1000)
    const plane = TUTORIAL_GAME.region.plane
    // Every piece inside the region, and the key and door coordinates as the rules name them.
    for (const { at } of [...TUTORIAL_DUNGEON_LAYOUT, { at: TUTORIAL_ENTRY }]) expect(inRegion(TUTORIAL_GAME, at)).toBe(true)
    const key = (p: { x: bigint; y: bigint; z: bigint }) => `${p.x},${p.y},${p.z}`
    expect(TUTORIAL_DUNGEON_LAYOUT.filter((l) => key(l.at) === key(TUTORIAL_GAME.key!.at)).map((l) => l.piece)).toEqual(['key'])
    expect(TUTORIAL_DUNGEON_LAYOUT.filter((l) => key(l.at) === key(TUTORIAL_GAME.door!.at)).map((l) => l.piece).sort()).toEqual(['gate-closed', 'gate-open'])
    const entries = TUTORIAL_DUNGEON_LAYOUT.map(({ piece, at }, i) => {
      const raw = JSON.parse(readFileSync(join(dir, `${piece}.json`), 'utf8'))
      const shard = fromPayload(raw, `tutorial-${piece}-${i}`)
      if (!shard) throw new Error(`${piece} is not a shard`)
      return finalizeEvent(shardInnerTemplate(shard, at, plane, createdAt + i), sk)
    })
    // The entry point, first in the list (DECK-0002 §2.2: the first item with the tag counts).
    const marker = fromPayload(JSON.parse(readFileSync(join(dir, 'entry.json'), 'utf8')), 'tutorial-entry')
    if (!marker) throw new Error('entry is not a shard')
    const entryTemplate = shardInnerTemplate(marker, TUTORIAL_ENTRY, plane, createdAt + 50)
    entries.unshift(finalizeEvent({ ...entryTemplate, tags: [...entryTemplate.tags, [ENTRY_TAG]] }, sk))
    const { key: regionKey, lookupId } = worldKey(TUTORIAL_GAME)
    const template = await bagTemplate(entries, regionKey, lookupId, TUTORIAL_GAME.region.height, createdAt + 100)
    // Under the canonical relay's limit, with ONOSENDAI's margin (lib/bagSize.ts).
    expect(signedBytes(template)).toBeLessThanOrEqual(BAG_SAFE_BYTES)
    const bag = finalizeEvent(template, sk)
    writeFileSync(out, JSON.stringify(dev
      ? { about: 'The tutorial dungeon, signed by a DEV key, sealed to the tutorial game region. For LOCAL tests only; never on any relay. Generated by __tests__/tutorialDungeon.gen.test.ts.', events: [bag] }
      : bag, null, dev ? 1 : 0) + '\n')
    console.log(`wrote ${out}: bag ${bag.id}, ${signedBytes(template)} bytes, ${entries.length} items, signed by ${pubkey}`)
  })
})
