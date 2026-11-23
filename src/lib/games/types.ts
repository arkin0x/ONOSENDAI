/**
 * types.ts - what this client knows about a game it implements (DECK-0002).
 *
 * A game is its pubkey (spec §8.11.1, arkinox 2026-10-02): there is no game
 * event to read, so everything else here is the game's rules, which a client
 * that implements the game carries in its own code. The world is the one part
 * that is read from the relays: the bags the game key seals to the region
 * (DECK-0002 §5), and with it the game's entry point, where a player appears
 * by virtue of entering (DECK-0002 §2.2): the `C` of the world item carrying
 * an `entry` tag. It is not in this definition, because it is the game's to
 * set in its world, not this client's.
 */

import type { NostrEvent } from '../events'
import type { Plane } from 'cyberspace-core'
import type { Position } from '../space'

/** One teleport pad (game logic): standing on it sends the player to `to`. */
export interface GamePad {
  /** The pad shard's own coordinate. The player stands on it one gibson above, within one gibson of it on X and Z. */
  at: Position
  /** Where it sends the player: a game position inside the region. */
  to: Position
  /**
   * A column of light this many gibsons tall over the pad, drawn by the game
   * view so the pad is found from afar: for a pad with no world shard to show
   * it (the tutorial dungeon's way back for a player who fell out).
   */
  beacon?: number
}

/** A box of game positions, both corners included (game logic). */
export interface GameZone {
  lo: Position
  hi: Position
}

/**
 * LEGACY (the world published 2026-11-13, game-only key and gate): the world
 * shard standing at `at` is the key's look, taken by a tap within reach and
 * kept only in the game. Read only while the game's newest world bag holds no
 * door (lib/games/keyDoor.ts): a world with a DECK-0004 door uses the real key
 * item and door instead. Remove once that world is live.
 */
export interface GameKey {
  at: Position
}

/**
 * LEGACY (as GameKey): the world shards standing at `at` are the gate's
 * looks, one that holds a walker the closed look, one that does not the open
 * look. Read only while the newest world bag holds no door.
 */
export interface GameDoor {
  at: Position
}

/**
 * Where the game hid its key item (game logic, as a pad's place is): a bag of
 * the game key's sealed to the region of `height` holding `at` (DECK-0004
 * §2, spec §7.6), not to the game's region, so the world bag alone never
 * opens it. Reaching that region in the game is what derives its key and
 * opens it. `at` is also where the game marks the key from afar.
 */
export interface GameKeyBag {
  at: Position
  height: number
}

/** Where the world's bags come from (DECK-0002 §5.1). */
export type GameWorldSource =
  /** The relays: the game key's bags with the region's lookup id. */
  | { kind: 'relays' }
  /** Events signed ahead of time and bundled, never on any relay, asked as a relay is asked (lib/games/source.ts): for LOCAL tests of a placeholder world. */
  | { kind: 'fixture'; load: () => Promise<NostrEvent[]> }

/** A game this client implements: its identity, its region, and its rules. */
export interface GameDef {
  /** The game's pubkey, 64 lowercase hex: the `p` marked `game` on every entry. */
  pubkey: string
  /** Where its bags are found; the entry's relay hint. May be empty. */
  relayHint: string
  /** Shown on the game's bar while you play. */
  name: string
  /** The aligned cube the game is played in (spec §8.11.1): its base, height and plane. */
  region: { base: Position; height: number; plane: Plane }
  /** The teleport pads, the mechanic cyberspace does not have. */
  pads: readonly GamePad[]
  world: GameWorldSource
  /** Gravity and jumps (lib/games/gravity.ts). Absent: the game is flown through, UP and DOWN. */
  gravity?: boolean
  /** LEGACY: the game-only key, for a world with no door (GameKey). */
  key?: GameKey
  /** LEGACY: the game-only gate the key opens (GameDoor). */
  door?: GameDoor
  /** Where the key item's bag is sealed, for a world whose gate is a DECK-0004 door. */
  keyBag?: GameKeyBag
  /** Reaching it clears the game: the clear time stops and the exit card shows. */
  exit?: GameZone
}
