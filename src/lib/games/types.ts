/**
 * types.ts - what this client knows about a game it implements (DECK-0002).
 *
 * A game is its pubkey (spec §8.11.1, arkinox 2026-10-02): there is no game
 * event to read, so everything else here is the game's rules, which a client
 * that implements the game carries in its own code. The world is the one part
 * that is read from the relays: the bags the game key seals to the region
 * (DECK-0002 §5).
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
}

/** Where the world's bags come from (DECK-0002 §5.1). */
export type GameWorldSource =
  /** The relays: the game key's bags with the region's lookup id. */
  | { kind: 'relays' }
  /** Bags signed ahead of time and bundled, never on any relay: for LOCAL tests of a placeholder world. */
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
  /** Where the arrival puts you (DECK-0002 §2.2), a game position inside the region. */
  start: Position
  /** The teleport pads, the mechanic cyberspace does not have. */
  pads: readonly GamePad[]
  world: GameWorldSource
}
