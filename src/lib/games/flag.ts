/**
 * flag.ts - THE SWITCH for games (DECK-0002).
 *
 * A game is on in one of two ways:
 *
 * - It is LIVE (gameLive): its key is a real one its owner holds, not a
 *   placeholder whose secret sits on a build machine, and its world is read
 *   from the relays, not a bundled fixture. A live game is on everywhere,
 *   the production host included, with no switch to turn.
 * - This device asked for games, off the production host: ?games=1 turns
 *   them on for this device and keeps them on, ?games=0 turns them off
 *   again. On the production host the device switch is not honoured at all
 *   (review of #660): every entry is permanent public history, and a game
 *   that is not live would name a throwaway DEV key. Vercel previews and
 *   localhost honour it.
 *
 * With neither, there is no way into that game, and a chain already inside
 * one is shown as before (the IN A GAME notice).
 *
 * The tutorial dungeon (lib/games/tutorialGame.ts) goes live when its pubkey
 * becomes the owner's: that one line makes it LIVE, and Track A (the
 * first-arrival tutorial) offers DUNGEON in its final choice on production.
 */

import { TUTORIAL_DEV_PUBKEY } from './tutorialGame'
import type { GameDef } from './types'

const KEY = 'onosendai:games'

/**
 * The production hosts, where the device switch is not honoured while a game
 * is not live (review of #660). Vercel previews and localhost honour it.
 */
const PRODUCTION_HOSTS = new Set(['onosendai.tech', 'www.onosendai.tech'])

function productionHost(): boolean {
  try { return PRODUCTION_HOSTS.has(location.hostname.toLowerCase()) } catch { return false }
}

function fromUrl(): void {
  if (productionHost() && !import.meta.env.DEV) return
  try {
    const asked = new URLSearchParams(location.search).get('games')
    if (asked === '1') localStorage.setItem(KEY, '1')
    else if (asked === '0') localStorage.removeItem(KEY)
  } catch { /* no location or no storage: the switch stays as it is */ }
}
fromUrl()

/** Whether games are on for this device by its own switch (?games=1), never on the production host. */
export function gamesEnabled(): boolean {
  if (productionHost() && !import.meta.env.DEV) return false
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

/**
 * Keys that are never a real game's: placeholders generated on a build
 * machine, whose entries must never reach production. Never shrinking.
 */
const PLACEHOLDER_KEYS: ReadonlySet<string> = new Set([TUTORIAL_DEV_PUBKEY])

/** Whether `game` is live: a real key (64 lowercase hex, not a placeholder), and its world read from the relays. */
export function gameLive(game: Pick<GameDef, 'pubkey' | 'world'>): boolean {
  return game.world.kind === 'relays' && /^[0-9a-f]{64}$/.test(game.pubkey) && !PLACEHOLDER_KEYS.has(game.pubkey)
}

/** Whether `game` is on here: everywhere once it is live, else only by this device's switch (gamesEnabled). */
export function gameEnabled(game: Pick<GameDef, 'pubkey' | 'world'>): boolean {
  return gameLive(game) || gamesEnabled()
}
