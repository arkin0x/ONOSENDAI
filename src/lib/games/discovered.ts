/**
 * discovered.ts - the games an identity has found, for the menu's GAMES
 * panel (owner, 2026-11-13: "a game panel in the menu UI so that you can
 * enter a game that you've discovered whenever you want").
 *
 * No relay lists games: a game is its pubkey (spec §8.11.1), and ONOSENDAI
 * enters only the games it implements (registry.ts). So "found" is said from
 * what this device already knows about the identity. A game is found when:
 *
 * - its chain holds an entry naming the game: an enter-virtual, its bracket
 *   open or closed, proves the game was entered;
 * - one of the game's world bags opened here: a find signed by the game's
 *   key, standing inside the game's region (DECK-0002 §5);
 * - this device noted it for the identity: the game was entered or gone back
 *   into here (store/useGame.ts), the tutorial's "Where next?" card offered
 *   it (tutorial/dungeon.ts), or one of the two above was seen
 *   (store/foundGames.ts), so a respawn, which starts a new chain, or a
 *   reload, which starts with no finds, forgets nothing.
 *
 * Only a game that is on here is ever listed (registry implementedGames): a
 * placeholder is never offered on the production host. Kept per identity on
 * this device; nothing is published for it.
 */

import { create } from 'zustand'
import type { ActionEvent } from '../events'
import type { Hidden } from '../hidden'
import { implementedGames } from './registry'
import { inRegion } from './play'
import type { GameDef } from './types'

/** Where the games an identity found are kept: their pubkeys, under the identity's. */
export const FOUND_GAMES_PREFIX = 'onosendai:games:found:'

const HEX_64 = /^[0-9a-f]{64}$/

/** A device that would not keep the list (private mode): this page's, per identity. */
const unkept = new Map<string, string[]>()

/** Bumped on every new note, so the panel draws again. */
export const useFoundGames = create<{ version: number }>(() => ({ version: 0 }))

/** The game pubkeys noted for `identity` on this device. */
export function notedGames(identity: string): string[] {
  if (!identity) return []
  const page = unkept.get(identity)
  if (page) return page
  try {
    const raw = JSON.parse(localStorage.getItem(FOUND_GAMES_PREFIX + identity) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string' && HEX_64.test(k)) : []
  } catch { return [] }
}

/** Note that `identity` found the game `pubkey`. A game noted already writes nothing. */
export function noteFoundGame(identity: string, pubkey: string): void {
  if (!identity || !HEX_64.test(pubkey)) return
  const now = notedGames(identity)
  if (now.includes(pubkey)) return
  const next = [...now, pubkey]
  try {
    localStorage.setItem(FOUND_GAMES_PREFIX + identity, JSON.stringify(next))
    unkept.delete(identity)
  } catch { unkept.set(identity, next) }
  useFoundGames.setState((s) => ({ version: s.version + 1 }))
}

/** The games a chain has entered: the pubkey of every enter-virtual on it. */
export function enteredOnChain(chain: readonly ActionEvent[]): string[] {
  const out = new Set<string>()
  for (const a of chain) if (a.role === 'enter' && a.game?.pubkey) out.add(a.game.pubkey)
  return [...out]
}

/** The games among `games` with a world bag in `finds`: an item signed by the game's key, inside its region. */
export function worldsOpened(finds: Iterable<Pick<Hidden, 'author' | 'at' | 'plane'>>, games: readonly GameDef[]): string[] {
  const out = new Set<string>()
  for (const h of finds) {
    const game = games.find((g) => g.pubkey === h.author)
    if (game && h.plane === game.region.plane && inRegion(game, h.at)) out.add(game.pubkey)
  }
  return [...out]
}

/** What says a game was found: the device's notes, the chain, and the finds. */
export interface FoundSources {
  noted: readonly string[]
  chain: readonly ActionEvent[]
  finds: Iterable<Pick<Hidden, 'author' | 'at' | 'plane'>>
}

/** The games found, in the registry's order, among those on here. */
export function discoveredGames(src: FoundSources): GameDef[] {
  const games = implementedGames()
  const found = new Set([...src.noted, ...enteredOnChain(src.chain), ...worldsOpened(src.finds, games)])
  return games.filter((g) => found.has(g.pubkey))
}

/**
 * THE SEAM for a game that is entered only from a certain place (the draft
 * `enter-from` requirement, cyberspace PR #104, not merged): the words that
 * say where to enter `game` from, while the player stands anywhere else, or
 * null when it may be entered from here. Null for every game today: the
 * owner ruled (2026-11-13) that a game is entered from anywhere, since
 * entering puts you at its entry point. Once the draft is merged, this reads
 * the game's newest world bag and the chain head; the GAMES panel shows the
 * words under the game and keeps ENTER greyed out, and useGame enter should
 * refuse with them too.
 */
export function enterFromRefusal(_game: GameDef): string | null {
  return null
}
