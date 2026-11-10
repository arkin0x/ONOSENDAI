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
 *     bounce course (tutorial/course.ts), the dirt plot and the tutorial
 *     tree's DNA (tutorial/dna.ts), seen from the spawn;
 *   - the box bag (the blue box's own height-3 region): the treasure chest,
 *     locked to that region (DECK-0004 §3.8, the region's lock), so whoever
 *     stands in the box carries the key that opens it (store/useKeyring). In
 *     it: a shard, a message and the welcome item;
 *   - the finish bag (the finish deck's height-3 region): the finish chest,
 *     locked the same way, with course pieces to build a course of your own.
 *
 * The welcome item is a placeholder signed by the guide key until the owner
 * publishes theirs; theirs then goes in as their own signed event, which a
 * chest reads as theirs (lib/chests.ts readContents).
 *
 * A stage is kept per player on this device (STAGE_PREFIX), so a reload
 * finds the same chest (an opened chest stays opened, by its id) and nothing
 * is signed twice. RESTART stages again: a new chest to open.
 */

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from 'nostr-tools'
import { fromPayload, type ShardModel, type ShardPayload } from 'sno-core/shards'
import { DEFAULT_BAG_SETTINGS, HIDDEN_KIND, bagTemplate, chestInnerTemplate, keyInnerTemplate, messageInnerTemplate, rumorOf, shardInnerTemplate, type BagEntry, type ChestItem, type KeyItem } from '../lib/hidden'
import { forgeKey, sealEntries } from '../lib/chests'
import { lockOf } from '../lib/locks'
import type { Position } from '../lib/space'
import { BOX_HEIGHT, regionBase, toWorld, type TutorialLayout } from './layout'
import { BACK_STEP, CATCH_FLOOR, COURSE, FINISH_CHEST, PLOT, PLOT_AT, courseToWorld, type CoursePart } from './course'
import { TUTORIAL_DNA } from './dna'
import { dnaTemplate } from '../lib/seeds/plant'
import trophyPayload from './pieces/trophy.json'
import platSquare6 from './pieces/plat-square-6.json'
import platSquare4 from './pieces/plat-square-4.json'
import lineStart from './pieces/line-start-4x2.json'
import lineFinish from './pieces/line-finish-8x2.json'
import trampoline from './pieces/trampoline-4.json'
import flagCheckered from './pieces/flag-checkered.json'
import padBounce from './pieces/pad-bounce-2.json'

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

/** Bump when what a stage holds changes, so a kept stage from before is staged again. */
export const STAGE_VERSION = 4

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
  /** The dirt plot shard and the tutorial tree's DNA event. */
  plot: string
  dna: string
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
  chestName: 'Treasure chest',
  message: `You found it. Whatever you TAKE is yours, in your ITEMS. There is a seed for you too: plant the ${TUTORIAL_DNA.name.toUpperCase()} on the dirt.`,
  welcomeName: 'Welcome',
  welcomeAbout: 'Your first day in cyberspace.',
  finishName: 'Finish chest',
  finishMessage: 'Pieces for a course of your own. Place them in BUILD.',
} as const

/** The blue box: a see-through cube filling the box region, nothing a walker bumps into. */
export function blueBoxModel(): ShardModel {
  // Drawn from its origin at a gibson's centre (the box's middle gibson,
  // base + 4), so corners at -4.5 and +3.5 meet the region's faces exactly:
  // the whole numbers -5 and 3, with 60 of 120 ticks.
  const c = [[-5, -5, -5], [3, -5, -5], [3, -5, 3], [-5, -5, 3], [-5, 3, -5], [3, 3, -5], [3, 3, 3], [-5, 3, 3]] as Array<[number, number, number]>
  const payload: ShardPayload = {
    v: 2,
    name: 'Blue box',
    unit: 0,
    extent: 8,
    mode: 'solid',
    vertices: c,
    ticks: c.map(() => [60, 60, 60] as [number, number, number]),
    colors: c.map(() => 36),
    faces: [[4, 7, 6], [4, 6, 5], [0, 1, 2], [0, 2, 3], [3, 2, 6], [3, 6, 7], [1, 0, 4], [1, 4, 5], [2, 1, 5], [2, 5, 6], [0, 3, 7], [0, 7, 4]],
    opacity: 22,
    constrain: 'off',
  } as ShardPayload
  const model = fromPayload(payload, 'tutorial-blue-box')
  if (!model) throw new Error('The blue box did not read as a shard.')
  return model
}

/** A shard from one of the tutorial's piece files. */
export function pieceModel(payload: unknown, id: string): ShardModel {
  const model = fromPayload(payload, id)
  if (!model) throw new Error(`The piece ${id} did not read as a shard.`)
  return model
}

/** Sign as the guide. */
function signer(secret: Uint8Array): (t: Parameters<typeof finalizeEvent>[0]) => NostrEvent {
  return (t) => finalizeEvent(t, secret) as NostrEvent
}

/**
 * Seal one bag of the guide's at a region: its entries under that region's
 * key, signed by the guide. `at` is any point inside the region.
 */
async function sealBag(sign: (t: Parameters<typeof finalizeEvent>[0]) => NostrEvent, inners: BagEntry[], key: Uint8Array, lookupId: string, height: number, createdAt: number, at: Position, plane: TutorialLayout['plane']): Promise<NostrEvent> {
  return sign(await bagTemplate(inners, key, lookupId, height, createdAt, HIDDEN_KIND, DEFAULT_BAG_SETTINGS, { at, plane }))
}

/** The welcome item, a placeholder until the owner publishes theirs (design §7, question 6). */
export function welcomeItem(): KeyItem {
  return forgeKey(STAGE_TEXT.welcomeName, STAGE_TEXT.welcomeAbout)
}

/** Stage the tutorial for a player, signed by the guide key `secret`, for the layout from their spawn. */
export async function buildStage(secret: Uint8Array, player: string, layout: TutorialLayout, keyAt: KeyAt, createdAt = Math.floor(Date.now() / 1000)): Promise<Stage> {
  const sign = signer(secret)
  const guide = getPublicKey(secret)
  const { plane, frame, cover } = layout
  const b = frame.boxBase
  // The box's middle gibson, which the blue box is drawn around.
  const boxMiddle: Position = { x: b.x + 4n, y: b.y + 4n, z: b.z + 4n }
  // The chest sits in the box, a little toward the near side, so it shows from the way in.
  const chestAt = toWorld(frame, 3, 3, 3)

  // The finish chest, on the deck, in the deck's own height-3 region (course.ts).
  const finishAt = courseToWorld(frame, FINISH_CHEST)
  const finishBase = regionBase(finishAt, BOX_HEIGHT)

  const [coverKey, boxKey, finishKey] = await Promise.all([keyAt(cover.base, cover.height), keyAt(b, BOX_HEIGHT), keyAt(finishBase, BOX_HEIGHT)])

  /** A chest at `at`, sealed to the lock of the region whose key is `key`, holding `contents`. */
  const chestOf = (name: string, key: Uint8Array, at: Position, contents: BagEntry[]): NostrEvent => {
    const lock = lockOf(key)
    if (!lock) throw new Error('This region has no lock.')
    const sealed = sealEntries(contents, lock.pubkey)
    const item: ChestItem = { name, lockPubkey: lock.pubkey, senderPubkey: sealed.senderPubkey, requires: REGION_REQUIRES, payload: sealed.payload }
    return sign(chestInnerTemplate(item, at, plane, createdAt))
  }

  // The treasure chest's contents, each placed at the chest, sealed to the box region's lock.
  const trophy = sign(shardInnerTemplate(pieceModel(trophyPayload, 'tutorial-trophy'), chestAt, plane, createdAt))
  const message = rumorOf(messageInnerTemplate(STAGE_TEXT.message, chestAt, plane, createdAt), guide)
  const welcome = sign(keyInnerTemplate(welcomeItem(), chestAt, plane, createdAt))
  const contents: BagEntry[] = [trophy, message, welcome]
  const chest = chestOf(STAGE_TEXT.chestName, boxKey.key, chestAt, contents)

  // The finish chest's: pieces to build with, and a line on what they are for.
  const finishContents: BagEntry[] = [
    ...FINISH_KIT.map(([payload, id]) => sign(shardInnerTemplate(pieceModel(payload, `tutorial-${id}`), finishAt, plane, createdAt))),
    rumorOf(messageInnerTemplate(STAGE_TEXT.finishMessage, finishAt, plane, createdAt), guide),
  ]
  const finishChest = chestOf(STAGE_TEXT.finishName, finishKey.key, finishAt, finishContents)

  const blueBox = sign(shardInnerTemplate(blueBoxModel(), boxMiddle, plane, createdAt))
  const course = COURSE.map((part, i) => sign(shardInnerTemplate(pieceModel(PIECES[part.piece], `tutorial-course-${i}`), courseToWorld(frame, part.at), plane, createdAt)))
  // The dirt plot, and the tutorial tree's DNA beside it (A5, T6): a bag is
  // where a reader looks first for the DNA of a seed planted there (DECK-0008
  // §8.2), and a DNA is read from a bag's entries, not from inside a chest.
  const plot = sign(shardInnerTemplate(pieceModel(PLOT, 'tutorial-plot'), toWorld(frame, PLOT_AT.f, PLOT_AT.r, PLOT_AT.u), plane, createdAt))
  const dna = sign(dnaTemplate(TUTORIAL_DNA.text, TUTORIAL_DNA.caps, createdAt))

  const bags = await Promise.all([
    sealBag(sign, [blueBox, ...course, plot, dna], coverKey.key, coverKey.lookupId, cover.height, createdAt, cover.base, plane),
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
      dna: dna.id,
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
