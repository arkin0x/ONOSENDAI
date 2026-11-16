/**
 * fixture.test.ts - DRONE RUN's bundled world (fixture/droneRun.fixture.json)
 * is the world a real publish of the built-in field (level/placeholderField.ts)
 * would put on a relay, and
 * the app reads it exactly as it would read one there (lib/games/world.ts
 * loadWorld, through lib/games/source.ts, never a relay):
 *
 * - the events: signed by the DEV key, every one verifying; one kind 33331
 *   object per piece placed by reference, saying nothing of where it is; the
 *   world bag LAST, sealed to the region key under its lookup id, under
 *   BAG_SAFE_BYTES;
 * - the bag's list: the entry marker inline and first, carrying ["entry"] at
 *   the level's entry point, then each placement at its coordinate;
 * - read through loadWorld: every piece drawn (one shard per placement, plus
 *   the marker), the entry point inside the start zone;
 * - the fixture and the built-in field are one pair: the level kept beside the
 *   events is the field's level, and every piece reads back as its payload.
 *
 * The builder itself (level/build.ts) is checked with a throwaway key, never
 * the DEV key, whose secret only the generator reads.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { HIDDEN_KIND, OBJECT_KIND, SHARD_KIND, type Rumor } from '../../../hidden'
import { BAG_SAFE_BYTES } from '../../../bagSize'
import { positionHex, type EventTemplate, type NostrEvent } from '../../../events'
import { bagList, loadWorld, worldKey } from '../../world'
import { inRegion } from '../../play'
import { DRONE_RUN_DEV_PUBKEY, DRONE_RUN_GAME, droneRunAt } from '../game'
import { buildDroneRunWorld, objectD } from '../level/build'
import { fromPayload, toPayload } from 'sno-core/shards'
import { insideBox, pieceNames, readLevel, type Level, type Local } from '../level/level'
import { placeholderField } from '../level/placeholderField'
import { builtInLevel } from '../levelSource'
import fixture from '../fixture/droneRun.fixture.json'

const field = placeholderField()
const level = field.level
const levelJson = JSON.parse(JSON.stringify(level)) as Record<string, unknown>
const ground = field.payloads['field-ground-flat']
const events = fixture.events as NostrEvent[]
const local = (p: { x: bigint; y: bigint; z: bigint }): Local => {
  const b = DRONE_RUN_GAME.region.base
  return [Number(p.x - b.x), Number(p.y - b.y), Number(p.z - b.z)]
}

describe('the level', () => {
  it('reads, its entry point inside the start zone and every piece inside the region', () => {
    expect(insideBox(level.zones.start, level.entry)).toBe(true)
    for (const p of level.pieces) expect(inRegion(DRONE_RUN_GAME, droneRunAt(...p.at))).toBe(true)
  })

  it('is the level the fixture was built from, kept beside its events, and what the app reads as the built-in level', async () => {
    expect(readLevel(fixture.level)).toEqual(level)
    expect(await builtInLevel()).toEqual(level)
  })

  it('refuses what a world cannot be built from', () => {
    expect(() => readLevel({ ...levelJson, format: 'drone-run-level/0' })).toThrow(/reads drone-run-level\/1/)
    expect(() => readLevel({ ...levelJson, entry: [0, 0, 0] })).toThrow(/not inside the start zone/)
    expect(() => readLevel({ ...levelJson, pieces: [{ piece: 'Bad Name', at: [1, 1, 1] }] })).toThrow(/piece name/)
    expect(() => readLevel({ ...levelJson, pieces: [{ piece: 'field-crate', at: [1, 1, 256] }] })).toThrow(/region-local/)
    expect(() => readLevel({ ...levelJson, zones: { start: { lo: [0, 0, 0], hi: [300, 1, 1] }, finish: (levelJson.zones as Level['zones']).finish } })).toThrow(/region-local/)
    expect(() => readLevel({ ...levelJson, zones: { start: (levelJson.zones as Level['zones']).start, finish: (levelJson.zones as Level['zones']).start } })).toThrow(/overlap/)
  })
})

describe('the fixture, as a real publish would put it', () => {
  const bag = events[events.length - 1]
  const objects = events.slice(0, -1)

  it('is signed by the DEV key, every event verifying: the objects, then the world bag last', () => {
    for (const e of events) {
      expect(e.pubkey).toBe(DRONE_RUN_DEV_PUBKEY)
      expect(verifyEvent(e)).toBe(true)
    }
    expect(bag.kind).toBe(HIDDEN_KIND)
    expect(objects.every((e) => e.kind === OBJECT_KIND)).toBe(true)
  })

  it('one object per piece placed by reference, each sealed and saying nothing of where it is', () => {
    const ds = objects.map((e) => e.tags.find((t) => t[0] === 'd')?.[1])
    expect(new Set(ds).size).toBe(objects.length)
    for (const e of objects) {
      expect(e.tags.find((t) => t[0] === 'encrypted')?.[3]).toBe('cyberspace:region')
      expect(e.tags.some((t) => ['C', 'H', 'h', 'hint', 'sector', '-'].includes(t[0]))).toBe(false)
    }
  })

  it('the world bag: the region\'s lookup id, height 8, under BAG_SAFE_BYTES', () => {
    expect(bag.tags.find((t) => t[0] === 'd')?.[1]).toBe(worldKey(DRONE_RUN_GAME).lookupId)
    expect(new TextEncoder().encode(JSON.stringify(bag)).length).toBeLessThanOrEqual(BAG_SAFE_BYTES)
  })

  it('opens to the entry marker inline and first, signed, with ["entry"] at the entry point, then every placement', async () => {
    const list = (await bagList(bag, worldKey(DRONE_RUN_GAME).key))!
    expect(list.length).toBe(level.pieces.length + 1)
    const marker = list[0] as Rumor
    expect(Array.isArray(marker)).toBe(false)
    expect(marker.kind).toBe(SHARD_KIND)
    expect(verifyEvent(marker as NostrEvent)).toBe(true)
    expect(marker.tags).toContainEqual(['entry'])
    expect(marker.tags.find((t) => t[0] === 'C')?.[1]).toBe(positionHex(droneRunAt(...level.entry), 1))
    // Each placement in the level's order, a reference to its piece's object at its coordinate (or the piece inline).
    level.pieces.forEach((p, i) => {
      const e = list[i + 1]
      const coord = positionHex(droneRunAt(...p.at), 1)
      if (Array.isArray(e)) expect(e).toEqual(['a', `${OBJECT_KIND}:${DRONE_RUN_DEV_PUBKEY}:${objectD(DRONE_RUN_DEV_PUBKEY, p.piece)}`, '', coord])
      else expect((e as Rumor).tags.find((t) => t[0] === 'C')?.[1]).toBe(coord)
    })
  })

  it('read through loadWorld: one shard per placement and the marker, the entry point inside the start zone', async () => {
    const world = await loadWorld(DRONE_RUN_GAME)
    expect(world.shards.length).toBe(level.pieces.length + 1)
    expect(world.door).toBeNull()
    expect(local(world.entry)).toEqual(level.entry)
    expect(insideBox(level.zones.start, local(world.entry))).toBe(true)
    for (const s of world.shards) expect(inRegion(DRONE_RUN_GAME, s.at)).toBe(true)
  })

  it('every piece reads back exactly as the built-in field\'s payload: the fixture is the field regenerated', async () => {
    const world = await loadWorld(DRONE_RUN_GAME)
    level.pieces.forEach((p, i) => {
      const drawn = world.shards[i + 1]
      expect(local(drawn.at)).toEqual(p.at)
      const want = fromPayload(JSON.parse(JSON.stringify(field.payloads[p.piece])), p.piece)!
      expect(toPayload({ ...drawn.shard, id: want.id, updatedAt: 0 })).toEqual(toPayload({ ...want, updatedAt: 0 }))
    })
  })
})

describe('the builder (a throwaway key, never the DEV key)', () => {
  const sk = generateSecretKey()
  const game = { ...DRONE_RUN_GAME, pubkey: getPublicKey(sk) }
  const sign = (t: EventTemplate): NostrEvent => finalizeEvent(t, sk) as unknown as NostrEvent
  const tiny: Level = {
    ...level,
    pieces: [
      { piece: 'field-ground-flat', at: [128, 64, 192] },
      { piece: 'field-ground-flat', at: [128, 64, 128] },
      { piece: 'marker-small', at: [128, 64, 200] },
    ],
  }
  const small = { v: 2, name: 'small', unit: 0, mode: 'solid', vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]], colors: [0, 0, 0] }

  it('shares one object among a piece\'s placements, and carries a small piece placed once inline', async () => {
    const built = await buildDroneRunWorld(game, sign, tiny, { 'field-ground-flat': ground, 'marker-small': small }, 1_800_000_000)
    expect(built.referenced).toEqual(['field-ground-flat'])
    expect(built.inline).toEqual(['marker-small'])
    expect(built.events.map((e) => e.kind)).toEqual([OBJECT_KIND, HIDDEN_KIND])
    const world = await loadWorld({ ...game, world: { kind: 'fixture', load: async () => built.events } })
    expect(world.shards.length).toBe(4)
    expect(local(world.entry)).toEqual(level.entry)
  })

  it('refuses a missing payload, and a signer that is not the game key', async () => {
    await expect(buildDroneRunWorld(game, sign, tiny, { 'field-ground-flat': ground }, 1)).rejects.toThrow(/no payload for piece marker-small/)
    const other = generateSecretKey()
    await expect(buildDroneRunWorld(game, (t) => finalizeEvent(t, other) as unknown as NostrEvent, tiny, { 'field-ground-flat': ground, 'marker-small': small }, 1)).rejects.toThrow(/not the game key/)
  })

  it('names each piece once', () => {
    expect(pieceNames(tiny)).toEqual(['field-ground-flat', 'marker-small'])
  })
})
