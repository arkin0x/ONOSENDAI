/**
 * gameCard.ts - what marks the game's own blueprints (the Compiler's and the
 * Quarry Charge's, granted by gameBlueprint.ts), with no store behind it, so
 * lists, placing and the smash's rules can ask without loading TERRAIN.
 */

/** The game as a blueprint's maker: never a key, shown as ONOSENDAI. */
export const GAME_MAKER = 'onosendai'
/** The card's id in BLUEPRINTS: one per identity. */
export const COMPILER_CARD_ID = 'game:compiler'
/** The Quarry Charge's card id in BLUEPRINTS: one per identity. */
export const QUARRY_CARD_ID = 'game:quarry-charge'
/** The Quarry Charge recipe's key and lookup (DECK-0010 §8.5 and §11; checked by test against the real derivation and the vectors). */
export const QUARRY_KEY_HEX = '4a98648039e97902a1e300ec678a4a2d37dfdebf177b8ef5d644343cad3819d9'
export const QUARRY_LOOKUP = 'e12e7f66a13349efa89ad831967ef367411d0c9831081b8d420993c4afb46995'
/** What its prize is called. */
export const QUARRY_NAME = 'Quarry Charges'
/** What a game blueprint says where DEPLOY would be. */
export const GAME_NO_DEPLOY = 'Everyone gets this one. The Compiler can smash a 16x16x16 blueprint build with speed and style.'
/** What the Quarry Charge's blueprint says there. */
export const QUARRY_NO_DEPLOY = 'Everyone gets this one. Quarry Charges loosen all blocks in a 7x7x7 area so you can easily collect them.'
/** CONSTRUCTION on a game blueprint's card row (owner's wording, 2026-11-28), in place of "May be built anywhere". */
export const GAME_CONSTRUCTION = 'Air gapped.'
/** CONSTRUCTION on a game blueprint's examine sheet, after its label (owner's wording, 2026-11-28). */
export const GAME_CONSTRUCTION_SHEET = 'air-gapped. Build must not touch any other blocks. Use Air Placement (under PLACE button).'
/** Short, where the title block has room for a word or two. */
export const GAME_CONSTRUCTION_SHORT = 'In the air'
/** PRIZE on a game blueprint (owner's wording, 2026-11-28): the Compiler's is "The Compiler", the Quarry Charge's "7 Quarry Charges". */
export const gamePrizeName = (cardId?: string): string => (cardId === QUARRY_CARD_ID ? '7 Quarry Charges' : 'The Compiler')
/** Whether a card is the game's own (never placed, never put in a chest). */
export const isGameCard = (card: { source?: string }): boolean => card.source === 'game'
/** What a game card says where DEPLOY would be: its own line. */
export const gameNoDeploy = (card: { record?: { id?: string } }): string => (card.record?.id === QUARRY_CARD_ID ? QUARRY_NO_DEPLOY : GAME_NO_DEPLOY)

/** Whether a prize is Quarry Charges (a tool from the Quarry Charge's recipe). */
export const isQuarryPrize = (p: { type: string; tool?: string }): boolean => p.type === 'tool' && p.tool === 'quarry-charge'
/** What a tool prize is called. */
export const toolName = (p: { type: string; tool?: string }): string => (isQuarryPrize(p) ? QUARRY_NAME : 'The Compiler')
/** What a tool prize is, in one line where it waits to be taken. */
export function toolWhat(p: { type: string; tool?: string; count?: number }): string {
  if (!isQuarryPrize(p)) return 'A tool. It sits in slot 1 for good.'
  const n = p.count ?? 1
  return `${n === 7 ? 'Seven' : n} Quarry Charges. They sit beside the Compiler: PLACE one and it clears the blocks round it.`
}
