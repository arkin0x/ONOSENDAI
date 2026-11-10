/**
 * stage.test.ts - the tutorial's layout and the guide's staged bags
 * (first-arrival tutorial design, 2026-11-10, D1, T4, T11):
 *
 * - the blue box is the next height-3 cube ahead of the spawn, never the
 *   spawn's own, and the covering region holds the spawn and the whole
 *   footprint for any spawn, flipping or lifting near a boundary;
 * - the guide's bags open with the region keys, as a stranger's: the cover
 *   holds the blue box, the box region holds the chest, locked to the box
 *   region's lock, and its contents read as the guide's, verified;
 * - every item lies inside its bag's region (spec §7.6), and every bag is
 *   under the size cap;
 * - signed by the guide, never the player.
 */
import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import type { NostrEvent } from 'nostr-tools'
import { regionKeyAt } from '../../lib/shardCrypto'
import { unbag, type Hidden } from '../../lib/hidden'
import { lockOf } from '../../lib/locks'
import { openWithSecret, readContents } from '../../lib/chests'
import { BAG_SAFE_BYTES } from '../../lib/bagSize'
import { BOX_HEIGHT, COVER_MAX, FOOTPRINT, inRegion, regionBase, toWorld, tutorialLayout } from '../layout'
import { STAGE_TEXT, buildStage, readStage, spawnTag, writeStage, type KeyAt } from '../stage'
import { guideBagsFor, isGuideBag, onGuideBags, setGuideBags } from '../guideBags'
import type { Position } from '../../lib/space'

const MAX_COMPUTE = 20
const keyAt: KeyAt = async (at, h) => { const rk = regionKeyAt(at, h, MAX_COMPUTE); return { key: rk.key, lookupId: rk.lookupId } }

/** A spawn somewhere ordinary: offsets inside every cube up to 2^12 in the middle. */
const MID: Position = { x: (1n << 40n) + 1000n, y: (1n << 40n) + 2050n, z: (1n << 40n) + 1500n }

describe('the layout', () => {
  it('puts the blue box in the next height-3 cube ahead (+Z) at the spawn\'s own X and Y cube', () => {
    const l = tutorialLayout(MID, 0)
    const own = regionBase(MID, BOX_HEIGHT)
    expect(l.frame.fwd).toBe(1)
    expect(l.frame.boxBase).toEqual({ x: own.x, y: own.y, z: own.z + 8n })
    expect(inRegion(MID, l.frame.boxBase, BOX_HEIGHT)).toBe(false)
    expect(l.cover.height).toBeLessThanOrEqual(COVER_MAX)
    expect(inRegion(MID, l.cover.base, l.cover.height)).toBe(true)
  })

  it('holds the spawn and the whole footprint in the cover, for spawns at every kind of boundary', () => {
    const edges = [0n, 1n, 7n, 8n, 63n, 64n, 4095n, 4096n - 100n, 4096n - 1n]
    const base = 1n << 50n
    let flipped = 0
    for (const ex of edges) for (const ey of edges) for (const ez of edges) {
      const spawn = { x: base + ex, y: base + ey, z: base + ez }
      const l = tutorialLayout(spawn, 1)
      expect(inRegion(spawn, l.cover.base, l.cover.height)).toBe(true)
      expect(inRegion(spawn, l.frame.boxBase, BOX_HEIGHT)).toBe(false)
      for (const f of [FOOTPRINT.f[0], FOOTPRINT.f[1] - 1]) for (const r of [FOOTPRINT.r[0], FOOTPRINT.r[1] - 1]) for (const u of [FOOTPRINT.u[0], FOOTPRINT.u[1] - 1]) {
        expect(inRegion(toWorld(l.frame, f, r, u), l.cover.base, l.cover.height)).toBe(true)
      }
      if (l.frame.fwd === -1) flipped++
    }
    // Near the far face of a big cube the footprint turns round.
    expect(flipped).toBeGreaterThan(0)
  })

  it('is the same for the same spawn', () => {
    expect(tutorialLayout(MID, 0)).toEqual(tutorialLayout(MID, 0))
  })
})

/** Open a guide bag as discovery does: with the region key computed where it is. */
async function open(bag: NostrEvent, at: Position, height: number): Promise<Hidden[]> {
  const rk = regionKeyAt(at, height, MAX_COMPUTE)
  expect(bag.tags.find((t) => t[0] === 'd')?.[1]).toBe(rk.lookupId)
  return unbag(bag, rk.key, undefined, { at: regionBase(at, height), plane: 0 }, height)
}

describe('the stage', () => {
  it('seals the blue box in the cover and a region-locked chest in the box, as the guide, never the player', async () => {
    const guide = generateSecretKey()
    const player = getPublicKey(generateSecretKey())
    const l = tutorialLayout(MID, 0)
    const stage = await buildStage(guide, player, l, keyAt)
    expect(stage.guide).toBe(getPublicKey(guide))
    expect(stage.bags).toHaveLength(2)
    for (const b of stage.bags) {
      expect(verifyEvent(b)).toBe(true)
      expect(b.pubkey).toBe(stage.guide)
      expect(b.pubkey).not.toBe(player)
      expect(JSON.stringify(b).length).toBeLessThan(BAG_SAFE_BYTES)
    }

    const [coverBag, boxBag] = stage.bags
    const coverItems = await open(coverBag, MID, l.cover.height)
    expect(coverItems.map((h) => h.eventId)).toEqual([stage.ids.blueBox])
    const box = coverItems[0]
    expect(box.type).toBe('shard')
    expect(box.author).toBe(stage.guide)
    expect(box.shard?.opacity).toBeLessThan(100)
    // Spec §7.6: inside its bag's region, and the middle of the blue box.
    expect(inRegion(box.at, l.cover.base, l.cover.height)).toBe(true)
    expect(box.at).toEqual({ x: l.frame.boxBase.x + 4n, y: l.frame.boxBase.y + 4n, z: l.frame.boxBase.z + 4n })

    // The box bag is not opened from the spawn: its key is the box's own.
    const spawnKey = regionKeyAt(MID, BOX_HEIGHT, MAX_COMPUTE)
    expect(boxBag.tags.find((t) => t[0] === 'd')?.[1]).not.toBe(spawnKey.lookupId)
    const inBox = await open(boxBag, l.frame.boxBase, BOX_HEIGHT)
    expect(inBox).toHaveLength(1)
    const chest = inBox[0]
    expect(chest.type).toBe('chest')
    expect(chest.eventId).toBe(stage.ids.chest)
    expect(stage.ids.boxLookup).toBe(chest.lookupId)
    expect(inRegion(chest.at, l.frame.boxBase, BOX_HEIGHT)).toBe(true)
    expect(chest.chest?.name).toBe(STAGE_TEXT.chestName)

    // Locked to the box region's lock: whoever stands there carries its key.
    const lock = lockOf(regionKeyAt(l.frame.boxBase, BOX_HEIGHT, MAX_COMPUTE).key)!
    expect(chest.chest?.lockPubkey).toBe(lock.pubkey)
    const contents = readContents(openWithSecret(chest.chest!, lock.secretHex), stage.guide)
    expect(contents.map((c) => c.body.type)).toEqual(['shard', 'message', 'key'])
    expect(contents.map((c) => c.id)).toEqual(stage.ids.chestContents)
    for (const c of contents) {
      expect(c.verified).toBe(true)
      expect(c.event.pubkey).toBe(stage.guide)
    }
    expect(contents[1].body.text).toBe(STAGE_TEXT.message)
    expect(contents[2].body.key?.name).toBe(STAGE_TEXT.welcomeName)
  })

  it('is kept per player, for its guide and spawn only', async () => {
    const guide = generateSecretKey()
    const player = 'a'.repeat(64)
    const l = tutorialLayout(MID, 0)
    const stage = await buildStage(guide, player, l, keyAt)
    const m = new Map<string, string>()
    ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } }
    expect(writeStage(stage, player)).toBe(true)
    expect(readStage(player, stage.guide, spawnTag(l))?.ids).toEqual(stage.ids)
    expect(readStage(player, 'b'.repeat(64), spawnTag(l))).toBe(null)
    expect(readStage(player, stage.guide, spawnTag({ spawn: { ...MID, z: MID.z + 1n }, plane: 0 }))).toBe(null)
    expect(readStage('c'.repeat(64), stage.guide, spawnTag(l))).toBe(null)
  })
})

describe('the guide\'s bags on this device', () => {
  it('answer only for their own lookup ids, say when they change, and go when taken away', async () => {
    const stage = await buildStage(generateSecretKey(), 'a'.repeat(64), tutorialLayout(MID, 0), keyAt)
    let heard = 0
    const off = onGuideBags(() => { heard++ })
    setGuideBags(stage.bags)
    expect(heard).toBe(1)
    const lookups = stage.bags.map((b) => b.tags.find((t) => t[0] === 'd')![1])
    expect(guideBagsFor(['f'.repeat(64)])).toEqual([])
    expect(guideBagsFor([lookups[1], 'f'.repeat(64)])).toEqual([stage.bags[1]])
    expect(isGuideBag(stage.bags[0].id)).toBe(true)
    setGuideBags(null)
    expect(heard).toBe(2)
    expect(guideBagsFor(lookups)).toEqual([])
    off()
  })
})
