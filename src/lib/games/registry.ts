/**
 * registry.ts - the games this client implements (DECK-0002, "implements a
 * game"): today only the first-arrival tutorial's dungeon. A game is its
 * pubkey, so this is how a chain's open bracket is matched to rules this
 * client knows. Behind THE SWITCH (lib/games/flag.ts): with it off, no game
 * is implemented here, and a chain inside one reads as before.
 */

import { gamesEnabled } from './flag'
import { TUTORIAL_GAME } from './tutorialGame'
import type { GameDef } from './types'

const GAMES: readonly GameDef[] = [TUTORIAL_GAME]

/** The game this client implements under `pubkey`, or null (always null with the switch off). */
export function gameFor(pubkey: string | undefined): GameDef | null {
  if (!pubkey || !gamesEnabled()) return null
  return GAMES.find((g) => g.pubkey === pubkey) ?? null
}
