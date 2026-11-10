/**
 * bracket.ts - the three kinds of event a player signs to play a game:
 * enter-virtual (spec §8.11.1), a game action (§8.11.2; DECK-0002 §4) and
 * exit-virtual (§8.11.3). Pure templates, signed by the store
 * (useCyberspace enterGame, signGameAction, exitGame), which checks the chain
 * before it signs any of them.
 */

import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { ACTION_KIND, positionHex, sectorTags, type EventTemplate } from '../events'
import type { GameDef } from './types'

const HEX_64 = /^[0-9a-f]{64}$/

/** The links every chain event after the spawn carries (spec §8.8). */
export interface Links {
  createdAt: number
  genesisId: string
  previousId: string
}

/** The game's region as the `region` tag writes it: the aligned base's coordinate and its height. */
export function regionTag(game: Pick<GameDef, 'region'>): string[] {
  const { base, height, plane } = game.region
  const low = (1n << BigInt(height)) - 1n
  if ((base.x & low) !== 0n || (base.y & low) !== 0n || (base.z & low) !== 0n) throw new Error('a game region is written from its aligned base (spec §8.11.1)')
  return ['region', positionHex(base, plane), String(height)]
}

/** Sector tags for a coordinate, read from its own hex so the plane bit is whatever the chain says. */
function sectorsOf(coordHex: string): string[][] {
  const at = coordToXyz(hexToCoord(coordHex))
  return sectorTags({ x: at.x, y: at.y, z: at.z })
}

/**
 * §8.11.1: enter a game from where you stand. `coordHex` is the chain head's
 * own `C` (never rebuilt from a position and the plane lined up for the next
 * move, the mistake enterHyperspaceTemplate's notes record), and it is both
 * `c` and `C`: entering does not move you.
 */
export function enterVirtualTemplate(i: Links & { coordHex: string; game: Pick<GameDef, 'pubkey' | 'relayHint' | 'region'> }): EventTemplate {
  if (!HEX_64.test(i.coordHex)) throw new Error('an entry names where you stand: 64 lowercase hex')
  if (!HEX_64.test(i.game.pubkey)) throw new Error('a game is named by its pubkey: 64 lowercase hex')
  return {
    kind: ACTION_KIND,
    created_at: i.createdAt,
    content: '',
    tags: [
      ['A', 'enter-virtual'],
      ['e', i.genesisId, '', 'genesis'],
      ['e', i.previousId, '', 'previous'],
      ['c', i.coordHex],
      ['C', i.coordHex],
      regionTag(i.game),
      ['p', i.game.pubkey, i.game.relayHint, 'game'],
      ...sectorsOf(i.coordHex),
    ],
  }
}

/** The names a game action may never take (spec §8.11.4 rule 3, and spawn and exit-virtual, which are never inside). */
const RESERVED = new Set(['spawn', 'hop', 'sidestep', 'enter-hyperspace', 'hyperjump', 'enter-virtual', 'exit-virtual'])

/**
 * DECK-0002 §4.1: the game put you at `toHex` with no path between. `fromHex`
 * is the game position you left, absent on the arrival (§2.2).
 */
export function teleportTemplate(i: Links & { toHex: string; fromHex?: string }): EventTemplate {
  if (!HEX_64.test(i.toHex) || (i.fromHex !== undefined && !HEX_64.test(i.fromHex))) throw new Error('a game position is 64 lowercase hex')
  return gameActionTemplate('teleport', i, [...(i.fromHex ? [['c', i.fromHex]] : []), ['C', i.toHex]])
}

/** Any game action (spec §8.11.2): a name of the game's own, the links, and the game's tags. */
export function gameActionTemplate(name: string, i: Links, tags: string[][]): EventTemplate {
  if (!name || RESERVED.has(name)) throw new Error(`"${name}" is not a game action's name: inside a game the base protocol's names are reserved (spec §8.11.4 rule 3)`)
  return {
    kind: ACTION_KIND,
    created_at: i.createdAt,
    content: '',
    tags: [['A', name], ['e', i.genesisId, '', 'genesis'], ['e', i.previousId, '', 'previous'], ...tags],
  }
}

/**
 * §8.11.3: leave the game. `coordHex` is the open entry's `c`, the base
 * position restored; `gameHex`, when given, is where you were inside the game,
 * written in the exit's free `c` (DECK-0002 §7), which no verifier reads.
 */
export function exitVirtualTemplate(i: Links & { entryId: string; coordHex: string; gameHex?: string }): EventTemplate {
  if (!HEX_64.test(i.coordHex) || !HEX_64.test(i.entryId)) throw new Error('an exit names its entry and the base position: 64 lowercase hex each')
  return {
    kind: ACTION_KIND,
    created_at: i.createdAt,
    content: '',
    tags: [
      ['A', 'exit-virtual'],
      ['e', i.genesisId, '', 'genesis'],
      ['e', i.previousId, '', 'previous'],
      ['e', i.entryId, '', 'entry'],
      ...(i.gameHex && HEX_64.test(i.gameHex) ? [['c', i.gameHex]] : []),
      ['C', i.coordHex],
      ...sectorsOf(i.coordHex),
    ],
  }
}
