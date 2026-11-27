/**
 * gameCard.ts - what marks the game's own blueprint (the Compiler's, granted
 * by gameBlueprint.ts), with no store behind it, so lists and placing can ask
 * without loading TERRAIN.
 */

/** The game as a blueprint's maker: never a key, shown as ONOSENDAI. */
export const GAME_MAKER = 'onosendai'
/** The card's id in BLUEPRINTS: one per identity. */
export const COMPILER_CARD_ID = 'game:compiler'
/** What a game blueprint says where DEPLOY would be. */
export const GAME_NO_DEPLOY = 'Everyone gets this one. Build it to make your Compiler.'
/** Whether a card is the game's own (never placed, never put in a chest). */
export const isGameCard = (card: { source?: string }): boolean => card.source === 'game'
