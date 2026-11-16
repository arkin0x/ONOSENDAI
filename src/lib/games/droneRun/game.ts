/**
 * game.ts - DRONE RUN as a game this client implements (DECK-0002): its
 * identity, its region and where its world comes from. Design and the split
 * between protocol and client: onosendai/drone-run/DESIGN.md.
 *
 * A placeholder, like the tutorial dungeon was before its key was the
 * owner's:
 *
 * - the key is a DEV key generated on the build machine. Its secret is not in
 *   this repository, and nothing it signed has been, or may be, sent to any
 *   relay. It is on flag.ts PLACEHOLDER_KEYS, so the game is never LIVE and is
 *   never on at the production host; and on registry.ts EVER_SHIPPED, so a
 *   chain inside its bracket can always be left.
 * - `world` is the bundled fixture (fixture/droneRun.fixture.json): the world
 *   exactly as a real publish would put it on a relay, signed by the DEV key
 *   and sealed to the region. Loaded only when the game is entered, so it
 *   costs the main bundle nothing. Built by __tests__/droneRun.gen.test.ts
 *   from level/level.json.
 * - `relayHint` is empty, and the game is entered only in LOCAL (store/useGame
 *   enter refuses a fixture world while LIVE), so no entry naming the DEV key
 *   is ever published.
 *
 * How it is played is the game's own code (GamePlay `drone-run`: the
 * simulation in droneRun/sim, the screen in game/droneRun), none of the
 * dungeon's.
 */

import type { NostrEvent } from '../../events'
import type { GameDef, GameWorldSource } from '../types'
import type { Position } from '../../space'

/** The DEV key that signs the fixture (a throwaway; its secret stays off the repository). */
export const DRONE_RUN_DEV_PUBKEY = 'e4efa8b1f8b4f3b04da52f979734e4e233e0cdbc2d9bfd85a9b6cf6d8065beda'

/** The region's height: 256 gibsons a side, a key a phone computes in a moment (DECK-0002 §5.2). */
export const DRONE_RUN_HEIGHT = 8

/** The words hashed for the region's base (DRONE_RUN_BASE). */
export const DRONE_RUN_BASE_SEED = 'ONOSENDAI drone run'

/**
 * The region's base: the tutorial dungeon's recipe exactly (lib/games/
 * tutorialGame.ts BASE), with its own words: the bits of
 * sha256("ONOSENDAI drone run") read as a coordinate (cyberspace-core
 * hexToCoord, coordToXyz), each axis aligned down to 2^8, the hash's plane
 * bit ignored (the game is in ideaspace, plane 1). Written out, as the
 * tutorial's is; __tests__/game.test.ts computes it again from the words.
 * Far from everyone: the player reaches it through the game, not across
 * cyberspace.
 */
export const DRONE_RUN_BASE: Position = {
  x: 24865338648449284388715264n,
  y: 1529194971657471975461632n,
  z: 28847323613456181709782784n,
}

/** The variant played (lib/games/droneRun/variants/<id>.json). */
export const DRONE_RUN_VARIANT = 'drone-run-base'

/** A region-local point (gibsons from the base, as level.json writes them) as a game position. */
export function droneRunAt(x: number, y: number, z: number): Position {
  return { x: DRONE_RUN_BASE.x + BigInt(x), y: DRONE_RUN_BASE.y + BigInt(y), z: DRONE_RUN_BASE.z + BigInt(z) }
}

/** The DEV world: the bundled fixture, signed by the DEV key, never on any relay. */
export const DRONE_RUN_FIXTURE_WORLD: GameWorldSource = {
  kind: 'fixture',
  load: async () => (await import('./fixture/droneRun.fixture.json')).default.events as NostrEvent[],
}

export const DRONE_RUN_GAME: GameDef = {
  pubkey: DRONE_RUN_DEV_PUBKEY,
  relayHint: '',
  name: 'DRONE RUN',
  region: { base: DRONE_RUN_BASE, height: DRONE_RUN_HEIGHT, plane: 1 },
  pads: [],
  world: DRONE_RUN_FIXTURE_WORLD,
  play: { kind: 'drone-run', variant: DRONE_RUN_VARIANT },
}
