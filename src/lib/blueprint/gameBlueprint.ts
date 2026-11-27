/**
 * gameBlueprint.ts - the Compiler's own blueprint, the game's gift (owner,
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
 */

import type { NostrEvent } from '../events'
import { useBlueprints } from '../../store/useBlueprints'
import { useCyberspace } from '../../store/useCyberspace'
import { terrainSession, useTerrain } from '../../store/useTerrain'
import { useToast } from '../../store/useToast'
import { bytesFromCells, recordTemplate, sealPrize, sheetShape, toBase64, type PrizeView, type RecordEvent } from './format'
import { hexToBytes } from '../events'
import { COMPILER_RECIPE, FERROVEIN, GLOWCORE, RUSTBAND } from './recipes'
import { COMPILER_CARD_ID, GAME_MAKER } from './gameCard'

export { COMPILER_CARD_ID, GAME_MAKER, GAME_NO_DEPLOY, isGameCard } from './gameCard'

/** The Compiler recipe's key and lookup (PBKDF2-SHA256, 500,000 rounds; checked by test against the real derivation). */
export const COMPILER_KEY_HEX = '593eabd69f12d642d07764e4a7599d1ce1aa1f75912928ef892dfdead5821e77'
export const COMPILER_LOOKUP = '84b131f9c9fd4fe30f118e8c115e7dfd86c7debd3d2f7cef26ddddae053f8564'
/** The block types that earn it. */
export const COMPILER_TYPES: readonly number[] = [FERROVEIN, RUSTBAND, GLOWCORE]
/** What the toast says when it arrives. */
export const COMPILER_FOUND = 'You found the Compiler blueprint'

/** The Compiler's blueprint record: every block shown, the prize public with its pictures (or described, with none). */
export async function compilerRecord(views: Partial<Record<PrizeView, string>>): Promise<RecordEvent> {
  const shown = Object.keys(views).length > 0
  const sheet = {
    ...sheetShape(COMPILER_RECIPE, () => true),
    lock: 'standard' as const,
    prize: shown
      ? { reveal: 'render' as const, name: 'The Compiler', views }
      : { reveal: 'description' as const, text: 'The Compiler: the hammer that compiles blueprints.', name: 'The Compiler' },
  }
  const sealed = await sealPrize(hexToBytes(COMPILER_KEY_HEX), { type: 'tool', tool: 'compiler' })
  const t = recordTemplate({ lookup: COMPILER_LOOKUP, sheet, sealed, title: 'The Compiler', createdAt: 1_795_000_000 })
  return { ...t, id: COMPILER_CARD_ID, pubkey: GAME_MAKER, sig: '' }
}

/** Whether `counts` holds at least one block of a type in the recipe. */
export const holdsRecipeType = (counts: Readonly<Record<number, number>>): boolean => COMPILER_TYPES.some((id) => (counts[id] ?? 0) > 0)

/** The pictures of the Compiler's model, as a render (empty where there is no canvas). */
async function drawCompiler(): Promise<Partial<Record<PrizeView, string>>> {
  try {
    const [{ compilerModel }, { prizeImagesWhole }] = await Promise.all([import('./compilerModel'), import('./prizeViews')])
    const m = await compilerModel()
    return m ? await prizeImagesWhole(m, 'render', ['iso', 'z', 'y', 'x']) : {}
  } catch { return {} }
}

let granting: string | null = null

/**
 * Grant the Compiler's blueprint to `owner` now if it is due: BLUEPRINTS
 * loaded for that owner, a recipe block held, and no such card yet. Returns
 * whether it granted. `draw` makes the pictures (tests pass their own).
 */
export async function grantCompilerIfDue(owner: string, counts: Readonly<Record<number, number>>, draw: () => Promise<Partial<Record<PrizeView, string>>> = drawCompiler): Promise<boolean> {
  const bp = useBlueprints.getState()
  if (!owner || bp.owner !== owner || bp.loadedFor !== owner || granting === owner) return false
  if (!holdsRecipeType(counts)) return false
  if (bp.cards.some((c) => c.rowKey === `${owner}/${COMPILER_CARD_ID}`)) return false
  granting = owner
  try {
    const record = await compilerRecord(await draw())
    // Still the same identity, and still not granted, after the pictures were drawn.
    const now = useBlueprints.getState()
    if (now.owner !== owner || now.cards.some((c) => c.rowKey === `${owner}/${COMPILER_CARD_ID}`)) return false
    now.addGame({ lookup: COMPILER_LOOKUP, record: record as NostrEvent, secret: { cells: toBase64(bytesFromCells(COMPILER_RECIPE.cells)), key: COMPILER_KEY_HEX, size: [...COMPILER_RECIPE.size] as [number, number, number] } })
    try { useToast.getState().show({ label: 'BLUEPRINT', meta: COMPILER_FOUND, mark: 'build' }) } catch { /* no toast here */ }
    return true
  } finally {
    granting = null
  }
}

let started = false

/** Watch for the moment it is due: the TERRAIN inventory changing, and BLUEPRINTS loading for an identity. */
export function startCompilerGrant(draw: () => Promise<Partial<Record<PrizeView, string>>> = drawCompiler): void {
  if (started) return
  started = true
  const check = (): void => {
    const me = useCyberspace.getState().identity.pubkey
    // The TERRAIN inventory is the identity's whose session it is.
    if (terrainSession && terrainSession.owner !== me) return
    void grantCompilerIfDue(me, useTerrain.getState().inventory.counts, draw)
  }
  useTerrain.subscribe((t, prev) => { if (t.inventory.counts !== prev.inventory.counts) check() })
  useBlueprints.subscribe((b, prev) => { if (b.loadedFor !== prev.loadedFor) check() })
  check()
}
