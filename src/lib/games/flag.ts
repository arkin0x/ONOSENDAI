/**
 * flag.ts - THE SWITCH for games (DECK-0002), OFF by default everywhere.
 *
 * Production auto-deploys from v2, and the tutorial game is a placeholder
 * (lib/games/tutorialGame.ts), so nothing about games shows on the production
 * host at all, and elsewhere only when this device asked for it: ?games=1 turns it on for this device and keeps it on,
 * ?games=0 turns it off again. With it off there is no way into a game, and a
 * chain already inside one is shown as before (the IN A GAME notice).
 *
 * Track A (the first-arrival tutorial) asks gamesEnabled() before it offers
 * DUNGEON in its final choice.
 */

const KEY = 'onosendai:games'

/**
 * The production hosts, where the switch is not honoured at all while the
 * tutorial game is a placeholder (review of #660): every entry is permanent
 * public history, and it would name a throwaway DEV key. Vercel previews and
 * localhost honour it. When the real game key lands, this goes.
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

/** Whether games are on for this device. */
export function gamesEnabled(): boolean {
  if (productionHost() && !import.meta.env.DEV) return false
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
