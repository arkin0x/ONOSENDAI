/**
 * flag.ts - THE SWITCH for games (DECK-0002), OFF by default everywhere.
 *
 * Production auto-deploys from v2, and the tutorial game is a placeholder
 * (lib/games/tutorialGame.ts), so nothing about games shows unless this device
 * asked for it: ?games=1 turns it on for this device and keeps it on,
 * ?games=0 turns it off again. With it off there is no way into a game, and a
 * chain already inside one is shown as before (the IN A GAME notice).
 *
 * Track A (the first-arrival tutorial) asks gamesEnabled() before it offers
 * DUNGEON in its final choice.
 */

const KEY = 'onosendai:games'

function fromUrl(): void {
  try {
    const asked = new URLSearchParams(location.search).get('games')
    if (asked === '1') localStorage.setItem(KEY, '1')
    else if (asked === '0') localStorage.removeItem(KEY)
  } catch { /* no location or no storage: the switch stays as it is */ }
}
fromUrl()

/** Whether games are on for this device. */
export function gamesEnabled(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
