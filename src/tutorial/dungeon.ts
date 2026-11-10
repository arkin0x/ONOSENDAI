/**
 * dungeon.ts - the tutorial's DUNGEON choice (Track C, step C4): PLAY THE
 * DUNGEON on the final card enters the tutorial dungeon (DECK-0002) from
 * where the player stands.
 *
 * Offered only with games on for this device (lib/games/flag.ts: ?games=1,
 * never on the production host while the game is a placeholder). With games
 * off nothing is registered and the card shows HYPERSPACE and AGENTS only.
 *
 * The card waits while the entry publishes and goes away once the game is on
 * screen. A refusal stays on the card in short plain words: game mode's own
 * refusals are already that; anything else (a signer's or relay's words) is
 * said as DUNGEON_FAILED_MESSAGE here and left in full in the console and on
 * the Proof chain panel (useGame `message`).
 */

import {
  COVERED_MESSAGE, GAME_ALREADY_MESSAGE, GAMES_OFF_MESSAGE, WALK_BUSY_MESSAGE,
  enterTutorialDungeon, gamesEnabled, useGame,
} from '../store/useGame'
import { registerTutorialChoice } from '../store/useTutorial'

/** The `when` the script's dungeon choice names (tutorial/script.ts CHOICE). */
export const DUNGEON_CHOICE = 'dungeon'
export const DUNGEON_FAILED_MESSAGE = 'The dungeon did not open. Try again.'

/** Game mode's refusals that already read as short plain words. */
const PLAIN_REFUSALS = new Set([GAMES_OFF_MESSAGE, GAME_ALREADY_MESSAGE, WALK_BUSY_MESSAGE, COVERED_MESSAGE])

/** What the card says for a refusal. */
export function dungeonRefusal(why: string): string {
  if (PLAIN_REFUSALS.has(why)) return why
  console.warn('[tutorial] the dungeon refused:', why)
  return DUNGEON_FAILED_MESSAGE
}

/**
 * Enter the dungeon for the tutorial: null once the game is on screen (not
 * after its arrival is signed, so the card does not sit over the game), or
 * the words for the card.
 */
export function enterDungeonFromTutorial(): Promise<string | null> {
  return new Promise((resolve) => {
    const unsubscribe = useGame.subscribe((s, prev) => { if (s.session && !prev.session) settle(null) })
    function settle(note: string | null): void { unsubscribe(); resolve(note) }
    enterTutorialDungeon().then(
      (why) => settle(why ? dungeonRefusal(why) : null),
      (err: unknown) => settle(dungeonRefusal(err instanceof Error ? err.message : String(err))),
    )
  })
}

/** Offer the dungeon on the final card when games are on for this device; whether it was. */
export function registerDungeonChoice(): boolean {
  if (!gamesEnabled()) return false
  registerTutorialChoice(DUNGEON_CHOICE, { run: enterDungeonFromTutorial })
  return true
}

registerDungeonChoice()
