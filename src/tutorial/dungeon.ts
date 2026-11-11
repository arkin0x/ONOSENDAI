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
 * screen. A refusal stays on the card in plain words: game mode's and the
 * chain's refusals are written for the player already (finish your walk,
 * wait for your move to land, RELOAD) and are shown as they are; only a raw
 * error (a signer's or relay's own words, wrapped as "Signing failed:" or
 * "Something went wrong:") is said as DUNGEON_FAILED_MESSAGE, and left in
 * full in the console.
 */

import { enterTutorialDungeon, gamesEnabled, useGame } from '../store/useGame'
import { registerTutorialChoice } from '../store/useTutorial'

/** The `when` the script's dungeon choice names (tutorial/script.ts CHOICE). */
export const DUNGEON_CHOICE = 'dungeon'
export const DUNGEON_FAILED_MESSAGE = 'The dungeon did not open. Try again.'

/** A raw error, not a refusal written for the player (lib/signWithin.ts signingFailed, useGame failed). */
const RAW_ERROR = /^(Signing failed|Something went wrong):/

/** What the card says for a refusal. */
export function dungeonRefusal(why: string): string {
  if (!RAW_ERROR.test(why)) return why
  console.warn('[tutorial] the dungeon did not open:', why)
  return DUNGEON_FAILED_MESSAGE
}

/**
 * Enter the dungeon for the tutorial: null once the game is on screen (not
 * after the world is read, so the card does not sit over the game), or
 * the words for the card.
 */
export function enterDungeonFromTutorial(): Promise<string | null> {
  return new Promise((resolve) => {
    const unsubscribe = useGame.subscribe((s, prev) => { if (s.session && !prev.session) settle(null) })
    function settle(note: string | null): void { unsubscribe(); resolve(note) }
    enterTutorialDungeon().then(
      (why) => settle(why ? dungeonRefusal(why) : null),
      (err: unknown) => { console.warn('[tutorial] the dungeon did not open:', err); settle(DUNGEON_FAILED_MESSAGE) },
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
