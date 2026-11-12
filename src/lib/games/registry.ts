/**
 * registry.ts - the games this client implements (DECK-0002, "implements a
 * game"): today only the first-arrival tutorial's dungeon. A game is its
 * pubkey, so this is how a chain's open bracket is matched to rules this
 * client knows. Behind THE SWITCH (lib/games/flag.ts gameEnabled): a game
 * that is neither live nor switched on for this device is not implemented
 * here, and a chain inside one reads as before.
 */

import { gameEnabled } from './flag'
import { TUTORIAL_GAME } from './tutorialGame'
import type { GameDef } from './types'

const GAMES: readonly GameDef[] = [TUTORIAL_GAME]

/**
 * Every game pubkey this client has ever shipped, never shrinking: a chain
 * inside one of their brackets can always be left from here, whatever the
 * switch says on this device and whatever key the game uses now (review of
 * #660). The placeholder's DEV key stays here after the real key lands.
 */
const EVER_SHIPPED: ReadonlySet<string> = new Set([
  '718c171d3e5a21c631dfd33159befec43f8687efb91bd42802f380c4afd37663', // the tutorial dungeon's placeholder DEV key, 2026-11-10
  ...GAMES.map((g) => g.pubkey),
])

/** Whether this client can leave a bracket of the game `pubkey`: one it plays, or ever played. */
export function canLeave(pubkey: string | undefined): boolean {
  return !!pubkey && EVER_SHIPPED.has(pubkey)
}

/** The game this client implements under `pubkey`, or null (null for a game that is off here: flag.ts gameEnabled). */
export function gameFor(pubkey: string | undefined): GameDef | null {
  if (!pubkey) return null
  const game = GAMES.find((g) => g.pubkey === pubkey)
  return game && gameEnabled(game) ? game : null
}
