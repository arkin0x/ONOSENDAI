/**
 * tutorialGame.ts - THE constant for the first-arrival tutorial's dungeon
 * (first-arrival tutorial, Track C; DECK-0002 §9).
 *
 * PLACEHOLDER. The owner has not yet said which key is the tutorial game, who
 * builds its dungeon, or which mechanics it shows. Until then:
 *
 * - `pubkey` is a DEV key generated on the build machine. Its secret is not in
 *   this repository. Nothing it signed has been, or may be, sent to any relay.
 * - `world` is a bundled fixture: one bag that key signed, sealed to the
 *   region, holding a small dungeon assembled from Maze Kit pieces (two sealed
 *   chambers with nothing between them but a pair of teleport pads). It is
 *   loaded only when the game is entered, so it costs the main bundle nothing.
 *
 * The real game drops in here and nowhere else: its pubkey and relay hint, its
 * region, where it starts, its pads, and `world: { kind: 'relays' }`. Entering
 * a game publishes the player's own enter-virtual, teleports and exit-virtual
 * (DECK-0002 §2, §4, §7), which name this pubkey, so the switch that lets
 * anyone enter (lib/games/flag.ts) stays OFF in production until it is real.
 *
 * Regenerating the fixture: src/lib/games/__tests__/tutorialDungeon.gen.test.ts.
 */

import type { GameDef } from './types'

/**
 * The placeholder's region: a cube of height 6 (64 gibsons a side) in
 * ideaspace, its base the bits of sha256("ONOSENDAI tutorial dungeon,
 * placeholder") read as a coordinate, aligned. Far from everyone: the player
 * reaches it through the game, not across cyberspace.
 */
const BASE = {
  x: 17516774915360765657102720n,
  y: 20246235312240823932540032n,
  z: 21425891919374062630302016n,
}

/** A point of the dungeon, in gibsons from the region's base. */
const at = (x: number, y: number, z: number) => ({ x: BASE.x + BigInt(x), y: BASE.y + BigInt(y), z: BASE.z + BigInt(z) })

/** The dev key that signed the fixture (placeholder; see above). */
export const TUTORIAL_DEV_PUBKEY = '718c171d3e5a21c631dfd33159befec43f8687efb91bd42802f380c4afd37663'

export const TUTORIAL_GAME: GameDef = {
  pubkey: TUTORIAL_DEV_PUBKEY,
  relayHint: '',
  name: 'TUTORIAL DUNGEON',
  region: { base: BASE, height: 6, plane: 1 },
  // Chamber A, near the sealed far end of its hall.
  start: at(8, 18, 30),
  pads: [
    // Chamber A's pad, by the shrine: to chamber B, which nothing joins to A.
    { at: at(8, 17, 8), to: at(40, 18, 26) },
    // Chamber B's pad: back to the start.
    { at: at(40, 17, 21), to: at(8, 18, 30) },
  ],
  world: { kind: 'fixture', load: async () => (await import('./tutorialDungeon.fixture.json')).default.events },
}

/**
 * Where each Maze Kit piece of the placeholder stands, for the generator: a
 * tile's origin is the centre of its 16-gibson cell (Maze Kit kit.ts), so
 * tiles stand at 8, 24 and 40 from the base and never reach its far walls.
 */
export const TUTORIAL_DUNGEON_LAYOUT: ReadonlyArray<{ piece: string; at: ReturnType<typeof at> }> = [
  { piece: 'a-dead-end', at: at(8, 24, 8) },
  { piece: 'a-hall-sealed', at: at(8, 24, 24) },
  { piece: 'b-room-sealed', at: at(40, 24, 24) },
  ...TUTORIAL_GAME.pads.map((p) => ({ piece: 'pad', at: p.at })),
]
