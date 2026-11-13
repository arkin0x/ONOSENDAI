/**
 * stage.ts: the tutorial's things, sealed by the guide key and kept on this
 * device (first-arrival tutorial design, 2026-11-10, D1 and T4).
 *
 * Built from the pure builders the app hides with (lib/hidden.ts templates,
 * lib/chests.ts sealEntries, lib/locks.ts lockOf, the region keys of spec
 * §7.2), signed by the guide key (tutorial/guide.ts), never by the player
 * and never sent to a relay. The bags go to tutorial/guideBags.ts, where the
 * discovery scan opens them as a stranger's.
 *
 * Three bags:
 *   - the covering bag (tutorial/layout.ts cover): the blue box, the
 *     bounce course (tutorial/course.ts), the dirt plot and the hop target
 *     over the course's start, seen from the spawn;
 *   - the box bag (the blue box's own height-3 region): the treasure chest,
 *     locked to that region (DECK-0004 §3.8, the region's lock), so whoever
 *     stands in the box carries the key that opens it (store/useKeyring). In
 *     it: a shard, a message, the welcome item and the tutorial tree's DNA;
 *   - the finish bag (the finish deck's height-3 region): the finish chest,
 *     locked the same way, with course pieces to build a course of your own.
 *
 * The guide signs through lib/signers.ts localSigner, like every raw key in
 * the app (clientTagGuard.test.ts), so its signed events carry ONOSENDAI's
 * client tag as a player's own do (the chests' messages are unsigned rumors,
 * untagged, as a player's are); nothing it signs is published either way.
 *
 * The welcome item is the owner's own published key item (kind 3340, the
 * Black Sun, signed by arkinox, WELCOME_ITEM), embedded as their signed event
 * rather than re-signed by the guide, so a chest reads it as theirs
 * (lib/chests.ts readContents). It is never published from here.
 *
 * A stage is kept per player on this device (STAGE_PREFIX), so a reload
 * finds the same chest (an opened chest stays opened, by its id) and nothing
 * is signed twice. RESTART stages again: a new chest to open.
 */

import { getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from 'nostr-tools'
import type { EventTemplate } from '../lib/events'
import { localSigner } from '../lib/signers'
import { fromPayload, type ShardModel, type ShardPayload } from 'sno-core/shards'
import { DEFAULT_BAG_SETTINGS, HIDDEN_KIND, bagTemplate, chestInnerTemplate, messageInnerTemplate, rumorOf, shardInnerTemplate, type BagEntry, type ChestItem } from '../lib/hidden'
import { sealEntries } from '../lib/chests'
import { lockOf } from '../lib/locks'
import type { Position } from '../lib/space'
import { BOX_HEIGHT, chestCell, regionBase, toWorld, type TutorialLayout } from './layout'
import { BACK_STEP, CATCH_FLOOR, COURSE, FINISH_CHEST, PLOT, PLOT_AT, courseToWorld, targetAt, targetPayload, type CoursePart } from './course'
import trophyPayload from './pieces/trophy.json'
import platSquare6 from './pieces/plat-square-6.json'
import platSquare4 from './pieces/plat-square-4.json'
import lineStart from './pieces/line-start-4x2.json'
import lineFinish from './pieces/line-finish-8x2.json'
import trampoline from './pieces/trampoline-4.json'
import flagCheckered from './pieces/flag-checkered.json'
import padBounce from './pieces/pad-bounce-2.json'
import welcomeItemSigned from './welcome-item.json'
import { TUTORIAL_DNA_EVENT } from './dna'

/** Each course piece's payload, by its name in tutorial/course.ts. */
const PIECES: Record<CoursePart['piece'], unknown> = {
  'plat-square-6': platSquare6,
  'plat-square-4': platSquare4,
  'line-start-4x2': lineStart,
  'trampoline-4': trampoline,
  'flag-checkered': flagCheckered,
  'catch-floor': CATCH_FLOOR,
  'back-step': BACK_STEP,
}

/** What the finish chest holds: pieces to build a course of your own. */
const FINISH_KIT: Array<[unknown, string]> = [[platSquare4, 'platform'], [padBounce, 'bounce-pad'], [trampoline, 'trampoline'], [lineStart, 'start-line'], [lineFinish, 'finish-line']]

/** What a region-locked chest says opens it, as the composer writes it (hud/RegionLockPicker REGION_REQUIRES). */
const REGION_REQUIRES = 'the key of a place'

/**
 * Bump when what a stage holds changes, so a kept stage from before is staged
 * again. Not for a change only to tags nothing reads, such as the client tag
 * the guide's events gained when they moved to lib/signers.ts: a kept stage
 * without it still plays the same, and a bump would hand a player a new,
 * unopened chest.
 */
export const STAGE_VERSION = 8

/** One player's stage, by pubkey. */
export const STAGE_PREFIX = 'onosendai:tutorial:stage:'

/** The region key at a place and height: the app computes it off the main thread, a test on it. */
export type KeyAt = (at: Position, height: number) => Promise<{ key: Uint8Array; lookupId: string }>

/** What the steps watch for, by id. */
export interface StageIds {
  /** The blue box shard's event id. */
  blueBox: string
  /** The treasure chest's event id. */
  chest: string
  /** What is in the chest: each entry's id, as ITEMS files it. */
  chestContents: string[]
  /** The box region's lookup id. */
  boxLookup: string
  /** The finish chest's event id, what is in it, and its region's lookup id. */
  finishChest: string
  finishContents: string[]
  finishLookup: string
  /** The dirt plot shard. */
  plot: string
  /** The hop target over the course's start (owner, 2026-11-13). */
  target: string
}

export interface Stage {
  v: number
  /** The player it was staged for. */
  player: string
  /** The guide key that signed it. */
  guide: string
  /** The layout it was staged for (stageKey), so a stage for another spawn or layout is never reused. */
  at: string
  bags: NostrEvent[]
  ids: StageIds
}

/** Caption copy that lives in the staged things, drafts in the owner's voice (design §7, question 7). */
export const STAGE_TEXT = {
  chestName: 'Tutorial welcome chest',
  message: 'You found it. Whatever you TAKE is yours, in your ITEMS.',
  finishName: 'Tutorial course chest',
  finishMessage: 'Pieces for a course of your own. Place them in BUILD.',
} as const

/**
 * The owner's own welcome item (kind 3340, the Black Sun), as they published
 * it: a sign-only key item whose secret tag is the item and whose model is the
 * live object 33331:e8ed3798...:welcome-black-sun. Embedded as the owner's
 * signed event, never published from here (D1).
 */
export const WELCOME_ITEM = welcomeItemSigned as unknown as NostrEvent

/**
 * The box: a lime-green outline cube filling the box region, nothing a walker
 * bumps into. An outline, not a filled cube, and green rather than blue, which
 * read too close to the HOP region colour (tutorial feedback 2026-11-11, item
 * 1). No faces: in LINES mode a faced cube draws every triangle edge, the six
 * face diagonals too (scene/ShardMesh.tsx outlineGeometry). Without faces it
 * is one line through its points, so the points trace the twelve edges once
 * each, retracing three to get round (16 points).
 */
export function boxModel(): ShardModel {
  // Drawn from its origin at a gibson's centre (the box's middle gibson,
  // base + 4), so corners at -4.5 and +3.5 meet the region's faces exactly:
  // the whole numbers -5 and 3, with 60 of 120 ticks.
  const corner = [[-5, -5, -5], [3, -5, -5], [3, -5, 3], [-5, -5, 3], [-5, 3, -5], [3, 3, -5], [3, 3, 3], [-5, 3, 3]] as Array<[number, number, number]>
  const c = [0, 1, 2, 3, 0, 4, 5, 6, 7, 4, 5, 1, 2, 6, 7, 3].map((i) => corner[i])
  const payload: ShardPayload = {
    v: 2,
    name: 'Green box',
    unit: 0,
    extent: 8,
    mode: 'lines',
    vertices: c,
    ticks: c.map(() => [60, 60, 60] as [number, number, number]),
    colors: c.map(() => 159),
    faces: [],
    // The outline reads clearly from across the region, but short of solid so
    // it never hides the chest inside it (readOpacity takes 1..99).
    opacity: 85,
    constrain: 'off',
  } as ShardPayload
  const model = fromPayload(payload, 'tutorial-green-box')
  if (!model) throw new Error('The green box did not read as a shard.')
  return model
}

/** A shard from one of the tutorial's piece files. */
export function pieceModel(payload: unknown, id: string): ShardModel {
  const model = fromPayload(payload, id)
  if (!model) throw new Error(`The piece ${id} did not read as a shard.`)
  return model
}

/** A signer for templates as the guide (lib/signers.ts localSigner). */
type Sign = (t: EventTemplate) => Promise<NostrEvent>

/** Sign as the guide. */
function signer(secret: Uint8Array): Sign {
  const guide = localSigner(secret)
  return (t) => guide.signEvent(t)
}

/**
 * Seal one bag of the guide's at a region: its entries under that region's
 * key, signed by the guide. `at` is any point inside the region.
 */
async function sealBag(sign: Sign, inners: BagEntry[], key: Uint8Array, lookupId: string, height: number, createdAt: number, at: Position, plane: TutorialLayout['plane']): Promise<NostrEvent> {
  return sign(await bagTemplate(inners, key, lookupId, height, createdAt, HIDDEN_KIND, DEFAULT_BAG_SETTINGS, { at, plane }))
}

/** Stage the tutorial for a player, signed by the guide key `secret`, for the layout from their spawn. */
export async function buildStage(secret: Uint8Array, player: string, layout: TutorialLayout, keyAt: KeyAt, createdAt = Math.floor(Date.now() / 1000)): Promise<Stage> {
  const sign = signer(secret)
  const guide = getPublicKey(secret)
  const { plane, frame, cover } = layout
  const b = frame.boxBase
  // The box's middle gibson, which the blue box is drawn around.
  const boxMiddle: Position = { x: b.x + 4n, y: b.y + 4n, z: b.z + 4n }
  // The chest sits in the box, a little toward the near side, so it shows
  // from the way in, level with the spawn and in line with it (chestCell).
  const cell = chestCell(layout)
  const chestAt = toWorld(frame, cell.f, cell.r, cell.u)

  // The finish chest, on the deck, in the deck's own height-3 region (course.ts).
  const finishAt = courseToWorld(frame, FINISH_CHEST)
  const finishBase = regionBase(finishAt, BOX_HEIGHT)

  const [coverKey, boxKey, finishKey] = await Promise.all([keyAt(cover.base, cover.height), keyAt(b, BOX_HEIGHT), keyAt(finishBase, BOX_HEIGHT)])

  /** A chest at `at`, sealed to the lock of the region whose key is `key`, holding `contents`. */
  const chestOf = (name: string, key: Uint8Array, at: Position, contents: BagEntry[]): Promise<NostrEvent> => {
    const lock = lockOf(key)
    if (!lock) throw new Error('This region has no lock.')
    const sealed = sealEntries(contents, lock.pubkey)
    const item: ChestItem = { name, lockPubkey: lock.pubkey, senderPubkey: sealed.senderPubkey, requires: REGION_REQUIRES, payload: sealed.payload }
    return sign(chestInnerTemplate(item, at, plane, createdAt))
  }

  // The treasure chest's contents, each placed at the chest, sealed to the box region's lock.
  const trophy = await sign(shardInnerTemplate(pieceModel(trophyPayload, 'tutorial-trophy'), chestAt, plane, createdAt))
  const message = rumorOf(messageInnerTemplate(STAGE_TEXT.message, chestAt, plane, createdAt), guide)
  // The owner's own signed welcome item, embedded as theirs, not re-signed.
  const welcome = WELCOME_ITEM
  // The tutorial tree's DNA beside it, the owner's published event placed
  // unchanged, as DECK-0008 §8.1 asks of another author's DNA carried in a
  // bag or chest (there, the one holding seeds planted from it; this chest
  // carries it for the seed the player plants next, which §8.1 does not
  // describe and nothing forbids): the player TAKEs it, and the plant step
  // plants it from ITEMS (tutorial feedback 2026-11-12, item 8).
  const contents: BagEntry[] = [trophy, message, welcome, TUTORIAL_DNA_EVENT]
  const chest = await chestOf(STAGE_TEXT.chestName, boxKey.key, chestAt, contents)

  // The finish chest's: pieces to build with, and a line on what they are for.
  const finishContents: BagEntry[] = [
    ...await Promise.all(FINISH_KIT.map(([payload, id]) => sign(shardInnerTemplate(pieceModel(payload, `tutorial-${id}`), finishAt, plane, createdAt)))),
    rumorOf(messageInnerTemplate(STAGE_TEXT.finishMessage, finishAt, plane, createdAt), guide),
  ]
  const finishChest = await chestOf(STAGE_TEXT.finishName, finishKey.key, finishAt, finishContents)

  const blueBox = await sign(shardInnerTemplate(boxModel(), boxMiddle, plane, createdAt))
  const course = await Promise.all(COURSE.map((part, i) => sign(shardInnerTemplate(pieceModel(PIECES[part.piece], `tutorial-course-${i}`), courseToWorld(frame, part.at), plane, createdAt))))
  // The dirt plot (A5). The tutorial tree's DNA is in the welcome chest as
  // the owner signed it, never re-signed by the guide, since a DNA's id names
  // its signer; a seed names that event (TUTORIAL_DNA_ID).
  const plot = await sign(shardInnerTemplate(pieceModel(PLOT, 'tutorial-plot'), toWorld(frame, PLOT_AT.f, PLOT_AT.r, PLOT_AT.u), plane, createdAt))

  // The hop target over the course's start (course.ts TARGET; owner, 2026-11-13).
  const target = await sign(shardInnerTemplate(pieceModel(targetPayload(), 'tutorial-target'), targetAt(frame), plane, createdAt))

  const bags = await Promise.all([
    sealBag(sign, [blueBox, ...course, plot, target], coverKey.key, coverKey.lookupId, cover.height, createdAt, cover.base, plane),
    sealBag(sign, [chest], boxKey.key, boxKey.lookupId, BOX_HEIGHT, createdAt, b, plane),
    sealBag(sign, [finishChest], finishKey.key, finishKey.lookupId, BOX_HEIGHT, createdAt, finishBase, plane),
  ])

  return {
    v: STAGE_VERSION,
    player,
    guide,
    at: stageKey(layout),
    bags,
    ids: {
      blueBox: blueBox.id,
      chest: chest.id,
      chestContents: contents.map(entryId),
      boxLookup: boxKey.lookupId,
      finishChest: finishChest.id,
      finishContents: finishContents.map(entryId),
      finishLookup: finishKey.lookupId,
      plot: plot.id,
      target: target.id,
    },
  }
}

/** An entry's id as ITEMS files it: a signed event's own, a rumor's hash (which rumorOf sets as its id). */
function entryId(e: BagEntry): string {
  return (e as NostrEvent).id
}

/**
 * What a kept stage must match to be reused: the version and the whole
 * layout (spawn, frame, cover), so a stage from another spawn or from a
 * layout tuned since is staged again. A change to what is staged at the same
 * places (a piece, a chest's contents) bumps STAGE_VERSION.
 */
export function stageKey(layout: TutorialLayout): string {
  const p = (v: Position): string => `${v.x},${v.y},${v.z}`
  return `${STAGE_VERSION}|${p(layout.spawn)}|${layout.plane}|${layout.frame.fwd},${layout.frame.side},${p(layout.frame.boxBase)}|${layout.cover.height},${p(layout.cover.base)}`
}

/** A player's kept stage, if it is whole, of this version, for this guide and this spawn. */
export function readStage(player: string, guide: string, at: string): Stage | null {
  try {
    const raw = localStorage.getItem(STAGE_PREFIX + player)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<Stage>
    if (s.v !== STAGE_VERSION || s.player !== player || s.guide !== guide || s.at !== at) return null
    if (!Array.isArray(s.bags) || !s.ids || typeof s.ids.chest !== 'string' || !Array.isArray(s.ids.chestContents) || typeof s.ids.finishChest !== 'string' || !Array.isArray(s.ids.finishContents)) return null
    return s as Stage
  } catch { return null }
}

/** Keep a player's stage on this device; false when it could not be kept (it is then this visit's only). */
export function writeStage(stage: Stage | null, player: string): boolean {
  try {
    if (stage === null) localStorage.removeItem(STAGE_PREFIX + player)
    else localStorage.setItem(STAGE_PREFIX + player, JSON.stringify(stage))
    return true
  } catch { return false }
}
