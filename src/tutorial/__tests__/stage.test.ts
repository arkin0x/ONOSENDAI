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
 * - signed by the guide, never the player, through lib/signers.ts, so
 *   carrying ONOSENDAI's client tag as a player's own bags do.
 */
import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import type { NostrEvent } from 'nostr-tools'
import { regionKeyAt } from '../../lib/shardCrypto'
import { hiddenLabel, unbag, type Hidden } from '../../lib/hidden'
import { decryptForRegion } from '../../lib/shardCrypto'
import { DNA_KIND } from '../../lib/seeds/seedItem'
import { lockOf } from '../../lib/locks'
import { NIP44_MAX_PLAINTEXT, openWithSecret, plaintextBytes, readContents } from '../../lib/chests'
import { BAG_SAFE_BYTES } from '../../lib/bagSize'
import { CLIENT_TAG } from '../../lib/client'
import { BOX_HEIGHT, COVER_MAX, FOOTPRINT, arrivalCell, chestCell, inRegion, regionBase, toFrame, toWorld, tutorialLayout } from '../layout'
import { TUTORIAL_DNA_EVENT } from '../dna'
import { STAGE_TEXT, WELCOME_ITEM, boxModel, buildStage, pieceModel, readStage, stageKey, writeStage, type KeyAt } from '../stage'
import { guideBagsFor, isGuideAuthor, isGuideBag, onGuideBags, passesTaps, setGuideBags } from '../guideBags'
import { COURSE, FINISH_CHEST, PLOT_STAND, START_STAND, TARGET, atStart, courseToFrame, courseToWorld, onPlot, onTarget, plantCell, targetAt, targetPayload } from '../course'
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
    // The hop target is inside the footprint, so inside every cover (owner, 2026-11-13).
    const t = courseToFrame(TARGET)
    expect(t.f).toBeGreaterThanOrEqual(FOOTPRINT.f[0]); expect(t.f).toBeLessThan(FOOTPRINT.f[1])
    expect(t.r).toBeGreaterThanOrEqual(FOOTPRINT.r[0]); expect(t.r).toBeLessThan(FOOTPRINT.r[1])
    expect(t.u).toBeGreaterThanOrEqual(FOOTPRINT.u[0]); expect(t.u).toBeLessThan(FOOTPRINT.u[1])
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

  it('floats the hop target 2 gibsons over the middle of the start square, in the cover, at the start (owner, 2026-11-13)', () => {
    for (const spawn of [MID, { x: (1n << 50n) + 4095n, y: (1n << 50n) + 4095n, z: (1n << 50n) + 4000n }]) {
      const l = tutorialLayout(spawn, 0)
      const t = targetAt(l.frame)
      const stand = courseToWorld(l.frame, START_STAND)
      expect(t).toEqual({ ...stand, y: stand.y + 2n })
      expect(inRegion(t, l.cover.base, l.cover.height)).toBe(true)
      expect(atStart(l.frame, t)).toBe(true)
      expect(onTarget(l.frame, t)).toBe(true)
      expect(onTarget(l.frame, stand)).toBe(false)
      // Pure: the same spawn, the same target.
      expect(targetAt(tutorialLayout(spawn, 0).frame)).toEqual(t)
    }
  })

  it('draws the hop target as glowing cyan lines nothing bumps into, small enough to stay over a walker\'s head', () => {
    const m = pieceModel(targetPayload(), 'tutorial-target')
    expect(m.mode).toBe('lines')
    expect(m.faces).toEqual([])
    expect(m.opacity ?? 100).toBe(100)
    // Every point within 1.5 gibsons of the target's centre, and none lower than 1 under it:
    // from the start square, 2 below, its lowest point is a gibson over the walker.
    for (const v of m.vertices) {
      const y = v.p[1] + (v.t?.[1] ?? 0) / 120
      expect(y).toBeGreaterThanOrEqual(-1 - 1e-9)
      const r = Math.hypot(v.p[0] + (v.t?.[0] ?? 0) / 120, y, v.p[2] + (v.t?.[2] ?? 0) / 120)
      expect(r).toBeLessThanOrEqual(1.5 + 1e-2)
    }
    expect((targetPayload() as { constrain: string }).constrain).toBe('off')
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
      // Signed through lib/signers.ts like every raw key (clientTagGuard.test.ts), so attributed as a player's bag is.
      expect(b.tags).toContainEqual(CLIENT_TAG)
    }

    const [coverBag, boxBag, finishBag] = stage.bags
    const coverItems = await open(coverBag, MID, l.cover.height)
    expect(coverItems[0].eventId).toBe(stage.ids.blueBox)
    // The blue box and the whole course, every piece where the course puts it, all in the cover (§7.6).
    // ... and the dirt plot (A5), and the hop target (owner, 2026-11-13). No DNA here: the tree's DNA is in the welcome chest (item 8).
    expect(coverItems).toHaveLength(1 + COURSE.length + 2)
    expect(coverItems[coverItems.length - 2].eventId).toBe(stage.ids.plot)
    const target = coverItems[coverItems.length - 1]
    expect(target.eventId).toBe(stage.ids.target)
    expect(target.type).toBe('shard')
    expect(target.author).toBe(stage.guide)
    expect(target.shard?.name).toBe('Target')
    expect(target.at).toEqual(targetAt(l.frame))
    expect(inRegion(target.at, l.cover.base, l.cover.height)).toBe(true)
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
    // At its cell in line with the spawn (layout.ts chestCell; feedback 2026-11-12, item 1).
    const cell = chestCell(l)
    expect(chest.at).toEqual(toWorld(l.frame, cell.f, cell.r, cell.u))
    expect(chest.chest?.name).toBe(STAGE_TEXT.chestName)

    // Locked to the box region's lock: whoever stands there carries its key.
    const lock = lockOf(regionKeyAt(l.frame.boxBase, BOX_HEIGHT, MAX_COMPUTE).key)!
    expect(chest.chest?.lockPubkey).toBe(lock.pubkey)
    const contents = readContents(openWithSecret(chest.chest!, lock.secretHex), stage.guide)
    expect(contents.map((c) => c.body.type)).toEqual(['shard', 'message', 'key', 'dna'])
    expect(contents.map((c) => c.id)).toEqual(stage.ids.chestContents)
    // Every entry verifies. The trophy and the message are the guide's; the
    // welcome item is the owner's own published event, embedded as theirs.
    for (const c of contents) expect(c.verified).toBe(true)
    expect(contents[0].event.pubkey).toBe(stage.guide)
    expect(contents[1].event.pubkey).toBe(stage.guide)
    expect(contents[2].event.id).toBe(WELCOME_ITEM.id)
    expect(contents[2].event.pubkey).toBe(WELCOME_ITEM.pubkey)
    // The guide's signed shard carries the client tag; the message is a rumor,
    // never signed, so never tagged; the owner's welcome item is theirs, not
    // re-signed here, so it carries no guide tag of ours.
    expect(contents[0].event.tags).toContainEqual(CLIENT_TAG)
    expect(contents[1].event.tags).not.toContainEqual(CLIENT_TAG)
    expect(contents[2].event.tags).not.toContainEqual(CLIENT_TAG)
    expect(contents[1].body.text).toBe(STAGE_TEXT.message)
    expect(contents[2].body.key?.name).toBe('Black Sun')
    // The tutorial tree's DNA beside the welcome item (feedback 2026-11-12,
    // item 8): the owner's published event, placed unchanged, a TAKE-able item.
    expect(contents[3].event.id).toBe(TUTORIAL_DNA_EVENT.id)
    expect(contents[3].event.pubkey).toBe(TUTORIAL_DNA_EVENT.pubkey)
    expect(contents[3].event.sig).toBe(TUTORIAL_DNA_EVENT.sig)
    expect(contents[3].body.dna?.name).toBe('moon blossom')
    expect(hiddenLabel(contents[3].body)).toBe('moon blossom DNA')

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

describe('the green box (feedback item 1)', () => {
  it('is a lime outline of exactly the twelve cube edges: no faces, so no face diagonals in LINES', () => {
    const m = boxModel()
    expect(m.mode).toBe('lines')
    expect(m.faces).toEqual([])
    const v = m.vertices.map((x) => x.p.join(','))
    const edges = new Set<string>()
    for (let i = 1; i < v.length; i++) edges.add([v[i - 1], v[i]].sort().join('|'))
    expect(edges.size).toBe(12)
    // Every segment runs along one axis: an edge, never a diagonal.
    for (let i = 1; i < m.vertices.length; i++) {
      const a = m.vertices[i - 1].p, b = m.vertices[i].p
      expect([0, 1, 2].filter((k) => a[k] !== b[k])).toHaveLength(1)
    }
  })
})

describe('the first move lands level with the chest, two gibsons in front of it, facing it (feedback 2026-11-12, item 1)', () => {
  const frames = [{ fwd: 1, side: 1 }, { fwd: -1, side: -1 }] as const
  const boxBase = { x: 800n, y: 800n, z: 800n }
  it('the chest stands in line with the spawn, and the landing is two along the forward axis with one empty gibson between', () => {
    for (const f of frames) {
      const frame = { ...f, boxBase }
      for (const [r, u] of [[3, 3], [0, 7], [5, 1]]) {
        const spawn = toWorld(frame, -4, r, u)
        const c = chestCell({ frame, spawn })
        const a = arrivalCell({ frame, spawn })
        // Inside the box, in line with the spawn and level with it.
        expect(c).toEqual({ f: 3, r, u })
        // Same height, same side position, two in front: one empty gibson between.
        expect(a).toEqual({ f: c.f - 2, r: c.r, u: c.u })
      }
      // A box lifted a cube off the spawn keeps the chest inside it.
      expect(chestCell({ frame, spawn: toWorld(frame, -4, 3, 12) }).u).toBe(7)
    }
  })
  it('from somewhere else (a RESTART on the course), lands on the chest\'s side nearest the player, level with it, inside the box', () => {
    for (const f of frames) {
      const frame = { ...f, boxBase }
      const spawn = toWorld(frame, -4, 3, 3)
      // Beyond the box, forward: behind the chest (f 5). Off to the side: beside it (r 5), never out of the box.
      expect(arrivalCell({ frame, spawn }, toWorld(frame, 40, 3, 10))).toEqual({ f: 5, r: 3, u: 3 })
      expect(arrivalCell({ frame, spawn }, toWorld(frame, 3, 30, 0))).toEqual({ f: 3, r: 5, u: 3 })
      const edge = toWorld(frame, -4, 7, 3)
      expect(arrivalCell({ frame, spawn: edge }, toWorld(frame, 3, 30, 3))).toEqual({ f: 1, r: 7, u: 3 })
    }
  })
  it('toFrame undoes toWorld, whichever way the layout faces', () => {
    for (const f of frames) {
      const frame = { ...f, boxBase }
      expect(toFrame(frame, toWorld(frame, -5, 2, 9))).toEqual({ f: -5, r: 2, u: 9 })
    }
  })
})

describe('the plant cursor goes on the dirt beside the player (feedback 2026-11-12, item 6)', () => {
  const frames = [{ fwd: 1, side: 1 }, { fwd: -1, side: -1 }] as const
  it('to one side, the other at the plot\'s edge, at the standing height, never on the player; none off the plot', () => {
    for (const f of frames) {
      const frame = { ...f, boxBase: { x: 800n, y: 800n, z: 800n } }
      const u = PLOT_STAND.u
      expect(plantCell(frame, toWorld(frame, 14, 4, u))).toEqual(toWorld(frame, 14, 5, u))
      // At the side edge (r 6), the other side.
      expect(plantCell(frame, toWorld(frame, 14, 6, u))).toEqual(toWorld(frame, 14, 5, u))
      // Standing a gibson up, still on the dirt's surface.
      const up = plantCell(frame, toWorld(frame, 13, 3, u + 1))!
      expect(onPlot(frame, up)).toBe(true)
      expect(up).toEqual(toWorld(frame, 13, 4, u))
      expect(plantCell(frame, toWorld(frame, 30, 4, u))).toBe(null)
    }
  })
})
