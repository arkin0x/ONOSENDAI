/**
 * gameBlueprint.ts - the game's own blueprints, its gifts: the Compiler's,
 * and the Quarry Charge's (DECK-0010 §8.4 to §8.6), granted the same way.
 *
 * The Compiler's (owner,
 * 2026-11-27: "once a user collects at least 1 of the block types that are in
 * the compiler recipe, they should get the blueprint for the compiler
 * automatically added to their inventory. the blueprint should have the full
 * preview of the compiler").
 *
 * - The trigger: the first time the identity on screen holds at least one
 *   block of a type in the recipe (Ferrovein, Rustband or Glowcore), by its
 *   TERRAIN inventory. Checked whenever the inventory changes and whenever
 *   BLUEPRINTS loads, so a player who already holds one gets it at once.
 * - Kept per npub with the rest of BLUEPRINTS (IndexedDB, keyed by owner;
 *   switching identity never deletes): the card itself is the mark, so it is
 *   granted once and stays (archived or not).
 * - What it is: a built-in blueprint like the recipe itself. No published
 *   record and no card event: a tool prize comes only from the game's own
 *   recipe (DECK-0010 §8.1), and a smash of the recipe never reads records
 *   (smash.ts compile). Every block revealed; the prize public, with real
 *   pictures of the Compiler's model. Its maker is the game (GAME_MAKER),
 *   and it is never placed (its source is 'game').
 *
 * The Quarry Charge's (owner, 2026-11-27: "the game's Quarry Charge blueprint
 * is granted the first time an identity collects any one of its four block
 * types"): the same in every way, for Umberslate, Rustband, Cinderrock or
 * Ferrovein, with its own model's pictures (quarryModel.ts). Its prize is a
 * tool, so it wears the orange item mark too (itemMark.ts).
 */

import type { NostrEvent } from '../events'
import { useBlueprints } from '../../store/useBlueprints'
import { useCyberspace } from '../../store/useCyberspace'
import { terrainSession, useTerrain } from '../../store/useTerrain'
import { useToast } from '../../store/useToast'
import { bytesFromCells, recordTemplate, sealPrize, sheetShape, toBase64, type Arrangement, type Prize, type PrizeView, type RecordEvent } from './format'
import { hexToBytes } from '../events'
import { CINDERROCK, COMPILER_RECIPE, FERROVEIN, GLOWCORE, QUARRY_CHARGE_COUNT, QUARRY_CHARGE_RECIPE, RUSTBAND, UMBERSLATE } from './recipes'
import { COMPILER_CARD_ID, GAME_MAKER, QUARRY_CARD_ID, QUARRY_KEY_HEX, QUARRY_LOOKUP } from './gameCard'

export { COMPILER_CARD_ID, GAME_MAKER, GAME_NO_DEPLOY, QUARRY_CARD_ID, QUARRY_KEY_HEX, QUARRY_LOOKUP, QUARRY_NO_DEPLOY, gameNoDeploy, isGameCard } from './gameCard'

/** The Compiler recipe's key and lookup (PBKDF2-SHA256, 500,000 rounds; checked by test against the real derivation). */
export const COMPILER_KEY_HEX = '593eabd69f12d642d07764e4a7599d1ce1aa1f75912928ef892dfdead5821e77'
export const COMPILER_LOOKUP = '84b131f9c9fd4fe30f118e8c115e7dfd86c7debd3d2f7cef26ddddae053f8564'
/** The block types that earn it. */
export const COMPILER_TYPES: readonly number[] = [FERROVEIN, RUSTBAND, GLOWCORE]
/** What the toast says when it arrives. */
export const COMPILER_FOUND = 'You found the Compiler blueprint'
/** The block types that earn the Quarry Charge's blueprint: any one of its four. */
export const QUARRY_TYPES: readonly number[] = [UMBERSLATE, RUSTBAND, CINDERROCK, FERROVEIN]
/** What the toast says when it arrives. */
export const QUARRY_FOUND = 'You found the Quarry Charge blueprint'

type Pictures = Partial<Record<PrizeView, string>>

/** One of the game's own blueprints: what it is, what earns it, and how its pictures are drawn. */
export interface GameGift {
  cardId: string
  title: string
  /** The prize said in words, where no picture could be drawn. */
  text: string
  recipe: Arrangement
  keyHex: string
  lookup: string
  prize: Prize
  types: readonly number[]
  found: string
  draw: () => Promise<Pictures>
}

/** The pictures of a model, as a render (empty where there is no canvas). */
async function drawModel(load: () => Promise<import('sno-core/shards').ShardModel | null>): Promise<Pictures> {
  try {
    const [m, { prizeImagesWhole }] = await Promise.all([load(), import('./prizeViews')])
    return m ? await prizeImagesWhole(m, 'render', ['iso', 'z', 'y', 'x']) : {}
  } catch { return {} }
}

export const COMPILER_GIFT: GameGift = {
  cardId: COMPILER_CARD_ID, title: 'The Compiler', text: 'The Compiler: the hammer that compiles blueprints.',
  recipe: COMPILER_RECIPE, keyHex: COMPILER_KEY_HEX, lookup: COMPILER_LOOKUP, prize: { type: 'tool', tool: 'compiler' },
  types: COMPILER_TYPES, found: COMPILER_FOUND,
  draw: () => drawModel(async () => (await import('./compilerModel')).compilerModel()),
}

export const QUARRY_GIFT: GameGift = {
  cardId: QUARRY_CARD_ID, title: 'The Quarry Charge', text: 'Seven Quarry Charges: place one and it clears the blocks round it.',
  recipe: QUARRY_CHARGE_RECIPE, keyHex: QUARRY_KEY_HEX, lookup: QUARRY_LOOKUP, prize: { type: 'tool', tool: 'quarry-charge', count: QUARRY_CHARGE_COUNT },
  types: QUARRY_TYPES, found: QUARRY_FOUND,
  draw: () => drawModel(async () => (await import('./quarryModel')).quarryModel()),
}

/** The game's gifts, in the order they are checked. */
export const GAME_GIFTS: readonly GameGift[] = [COMPILER_GIFT, QUARRY_GIFT]

/** A game blueprint's record: every block shown, the prize public with its pictures (or described, with none). */
export async function giftRecord(gift: GameGift, views: Pictures): Promise<RecordEvent> {
  const shown = Object.keys(views).length > 0
  const sheet = {
    ...sheetShape(gift.recipe, () => true),
    lock: 'standard' as const,
    prize: shown
      ? { reveal: 'render' as const, name: gift.title, views }
      : { reveal: 'description' as const, text: gift.text, name: gift.title },
  }
  const sealed = await sealPrize(hexToBytes(gift.keyHex), gift.prize)
  const t = recordTemplate({ lookup: gift.lookup, sheet, sealed, title: gift.title, createdAt: 1_795_000_000 })
  return { ...t, id: gift.cardId, pubkey: GAME_MAKER, sig: '' }
}

/** The Compiler's blueprint record. */
export const compilerRecord = (views: Pictures): Promise<RecordEvent> => giftRecord(COMPILER_GIFT, views)

/** Whether `counts` holds at least one block of a type in the gift's recipe. */
export const holdsTypeOf = (gift: GameGift, counts: Readonly<Record<number, number>>): boolean => gift.types.some((id) => (counts[id] ?? 0) > 0)
/** Whether `counts` holds at least one block of a type in the Compiler's recipe. */
export const holdsRecipeType = (counts: Readonly<Record<number, number>>): boolean => holdsTypeOf(COMPILER_GIFT, counts)

const granting = new Set<string>()

/**
 * Grant a game blueprint to `owner` now if it is due: BLUEPRINTS loaded for
 * that owner, a block of its recipe held, and no such card yet. Returns
 * whether it granted. `draw` makes the pictures (tests pass their own).
 */
export async function grantGiftIfDue(gift: GameGift, owner: string, counts: Readonly<Record<number, number>>, draw: () => Promise<Pictures> = gift.draw): Promise<boolean> {
  const bp = useBlueprints.getState()
  const busy = `${gift.cardId}|${owner}`
  if (!owner || bp.owner !== owner || bp.loadedFor !== owner || granting.has(busy)) return false
  if (!holdsTypeOf(gift, counts)) return false
  const rowKey = `${owner}/${gift.cardId}`
  if (bp.cards.some((c) => c.rowKey === rowKey)) return false
  granting.add(busy)
  try {
    const record = await giftRecord(gift, await draw())
    // Still the same identity, and still not granted, after the pictures were drawn.
    const now = useBlueprints.getState()
    if (now.owner !== owner || now.cards.some((c) => c.rowKey === rowKey)) return false
    now.addGame({ lookup: gift.lookup, record: record as NostrEvent, secret: { cells: toBase64(bytesFromCells(gift.recipe.cells)), key: gift.keyHex, size: [...gift.recipe.size] as [number, number, number] } })
    try { useToast.getState().show({ label: 'BLUEPRINT', meta: gift.found, mark: 'build' }) } catch { /* no toast here */ }
    return true
  } finally {
    granting.delete(busy)
  }
}

/** The Compiler's blueprint, if it is due. */
export const grantCompilerIfDue = (owner: string, counts: Readonly<Record<number, number>>, draw?: () => Promise<Pictures>): Promise<boolean> => grantGiftIfDue(COMPILER_GIFT, owner, counts, draw)
/** The Quarry Charge's blueprint, if it is due. */
export const grantQuarryIfDue = (owner: string, counts: Readonly<Record<number, number>>, draw?: () => Promise<Pictures>): Promise<boolean> => grantGiftIfDue(QUARRY_GIFT, owner, counts, draw)

let started = false

/**
 * Watch for the moment a gift is due: the TERRAIN inventory changing, and
 * BLUEPRINTS loading for an identity. `draw`, for tests, draws every gift's
 * pictures; otherwise each draws its own model.
 */
export function startCompilerGrant(draw?: () => Promise<Pictures>): void {
  if (started) return
  started = true
  const check = (): void => {
    const me = useCyberspace.getState().identity.pubkey
    // The TERRAIN inventory is the identity's whose session it is.
    if (terrainSession && terrainSession.owner !== me) return
    const counts = useTerrain.getState().inventory.counts
    // One after the other, so two toasts never race for the same moment.
    void (async () => { for (const g of GAME_GIFTS) await grantGiftIfDue(g, me, counts, draw) })()
  }
  useTerrain.subscribe((t, prev) => { if (t.inventory.counts !== prev.inventory.counts) check() })
  useBlueprints.subscribe((b, prev) => { if (b.loadedFor !== prev.loadedFor) check() })
  check()
}
/** The same watch, by what it does now: every game blueprint. */
export const startGameGrants = startCompilerGrant
