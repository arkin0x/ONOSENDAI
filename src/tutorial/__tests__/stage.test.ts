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
import { decryptForRegion } from '../../lib/shardCrypto'
import { DNA_KIND } from '../../lib/seeds/seedItem'
import { lockOf } from '../../lib/locks'
import { NIP44_MAX_PLAINTEXT, openWithSecret, plaintextBytes, readContents } from '../../lib/chests'
import { BAG_SAFE_BYTES } from '../../lib/bagSize'
import { BOX_HEIGHT, COVER_MAX, FOOTPRINT, inRegion, regionBase, toWorld, tutorialLayout } from '../layout'
import { STAGE_TEXT, buildStage, readStage, stageKey, writeStage, type KeyAt } from '../stage'
import { guideBagsFor, isGuideAuthor, isGuideBag, onGuideBags, passesTaps, setGuideBags } from '../guideBags'
import { COURSE, FINISH_CHEST, START_STAND, atStart, courseToWorld } from '../course'
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

describe('the course', () => {
  it('puts the finish deck, its chest and anyone standing on it in one height-3 region, whichever way the layout faces', () => {
    for (const fwd of [1, -1] as const) for (const side of [1, -1] as const) {
      const frame = { fwd, side, boxBase: { x: 1n << 40n, y: 1n << 40n, z: 1n << 40n } }
      const region = regionBase(courseToWorld(frame, FINISH_CHEST), BOX_HEIGHT)
      for (let x = -3; x <= 3; x++) for (let z = 28; z <= 34; z++) for (const y of [10, 11, 14]) {
        expect(inRegion(courseToWorld(frame, [x, y, z]), region, BOX_HEIGHT), `${fwd},${side} ${x},${y},${z}`).toBe(true)
      }
    }
  })

  it('counts a walker on the start square as at the start, and nowhere else', () => {
    const frame = tutorialLayout(MID, 0).frame
    expect(atStart(frame, courseToWorld(frame, START_STAND))).toBe(true)
    expect(atStart(frame, courseToWorld(frame, [3, 1, -3]))).toBe(true)
    expect(atStart(frame, courseToWorld(frame, [0, 1, 4]))).toBe(false)
    expect(atStart(frame, courseToWorld(frame, [0, -3, 0]))).toBe(false)
  })
})

describe('the stage', () => {
  it('seals the blue box in the cover and a region-locked chest in the box, as the guide, never the player', async () => {
    const guide = generateSecretKey()
    const player = getPublicKey(generateSecretKey())
    const l = tutorialLayout(MID, 0)
    const stage = await buildStage(guide, player, l, keyAt)
    expect(stage.guide).toBe(getPublicKey(guide))
    expect(stage.bags).toHaveLength(3)
    for (const b of stage.bags) {
      expect(verifyEvent(b)).toBe(true)
      expect(b.pubkey).toBe(stage.guide)
      expect(b.pubkey).not.toBe(player)
      expect(JSON.stringify(b).length).toBeLessThan(BAG_SAFE_BYTES)
    }

    const [coverBag, boxBag, finishBag] = stage.bags
    const coverItems = await open(coverBag, MID, l.cover.height)
    expect(coverItems[0].eventId).toBe(stage.ids.blueBox)
    // The blue box and the whole course, every piece where the course puts it, all in the cover (§7.6).
    // ... and the dirt plot (A5). No DNA: the player's composer signs the tree's own (stage.ts).
    expect(coverItems).toHaveLength(1 + COURSE.length + 1)
    expect(coverItems[coverItems.length - 1].eventId).toBe(stage.ids.plot)
    const json = await decryptForRegion(regionKeyAt(l.cover.base, l.cover.height, MAX_COMPUTE).key, coverBag.tags.find((t) => t[0] === 'encrypted')![2])
    expect((JSON.parse(json ?? '[]') as NostrEvent[]).some((e) => e.kind === DNA_KIND)).toBe(false)
    COURSE.forEach((part, i) => {
      const item = coverItems[1 + i]
      expect(item.type).toBe('shard')
      expect(item.at).toEqual(courseToWorld(l.frame, part.at))
      expect(inRegion(item.at, l.cover.base, l.cover.height)).toBe(true)
    })
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

    // The finish chest: in the deck's own height-3 region, locked to it, with pieces to build with.
    const finishAt = courseToWorld(l.frame, FINISH_CHEST)
    const finishBase = regionBase(finishAt, BOX_HEIGHT)
    const inFinish = await open(finishBag, finishBase, BOX_HEIGHT)
    expect(inFinish.map((h) => h.eventId)).toEqual([stage.ids.finishChest])
    const finishLock = lockOf(regionKeyAt(finishBase, BOX_HEIGHT, MAX_COMPUTE).key)!
    expect(inFinish[0].chest?.lockPubkey).toBe(finishLock.pubkey)
    const raw = openWithSecret(inFinish[0].chest!, finishLock.secretHex)
    expect(plaintextBytes(raw)).toBeLessThan(NIP44_MAX_PLAINTEXT)
    const kit = readContents(raw, stage.guide)
    expect(kit.map((c) => c.id)).toEqual(stage.ids.finishContents)
    expect(kit.filter((c) => c.body.type === 'shard').map((c) => c.body.shard?.name)).toEqual(['Platform 4', 'Bounce pad', 'Trampoline', 'Start line', 'Finish line'])
    for (const c of kit) expect(c.verified).toBe(true)
  })

  it('is kept per player, for its guide and spawn only', async () => {
    const guide = generateSecretKey()
    const player = 'a'.repeat(64)
    const l = tutorialLayout(MID, 0)
    const stage = await buildStage(guide, player, l, keyAt)
    const m = new Map<string, string>()
    const g = globalThis as { localStorage?: unknown }
    const had = g.localStorage
    g.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } }
    try {
      expect(writeStage(stage, player)).toBe(true)
      expect(readStage(player, stage.guide, stageKey(l))?.ids).toEqual(stage.ids)
      expect(readStage(player, 'b'.repeat(64), stageKey(l))).toBe(null)
      expect(readStage(player, stage.guide, stageKey(tutorialLayout({ ...MID, z: MID.z + 1n }, 0)))).toBe(null)
      // The same spawn, a layout tuned since: staged again.
      expect(readStage(player, stage.guide, stageKey({ ...l, cover: { ...l.cover, height: l.cover.height + 1 } }))).toBe(null)
      expect(readStage('c'.repeat(64), stage.guide, stageKey(l))).toBe(null)
    } finally { g.localStorage = had }
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
    expect(isGuideAuthor(stage.guide)).toBe(true)
    expect(isGuideAuthor('f'.repeat(64))).toBe(false)
    setGuideBags(stage.bags, { passTaps: [stage.ids.blueBox] })
    expect(passesTaps(stage.ids.blueBox)).toBe(true)
    expect(passesTaps(stage.ids.chest)).toBe(false)
    setGuideBags(null)
    expect(passesTaps(stage.ids.blueBox)).toBe(false)
    // A guide stays known after its bags go: a card still never asks about it.
    expect(isGuideAuthor(stage.guide)).toBe(true)
    expect(heard).toBe(3)
    expect(guideBagsFor(lookups)).toEqual([])
    off()
  })
})
