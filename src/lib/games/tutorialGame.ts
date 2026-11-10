/**
 * tutorialGame.ts - THE constant for the first-arrival tutorial's dungeon
 * (first-arrival tutorial, Track C; DECK-0002 §9). Its design, map and the
 * owner's deploy steps: onosendai/games-dungeon/DESIGN.md and DEPLOY.md.
 *
 * The dungeon is real; its key is not yet. The owner rules (2026-11-10) that
 * the game is a new npub he creates and holds, and that he deploys the
 * pieces himself. Until then:
 *
 * - `pubkey` is a DEV key generated on the build machine. Its secret is not in
 *   this repository. Nothing it signed has been, or may be, sent to any relay.
 * - `world` is a bundled fixture: the dungeon's one bag, signed by that key
 *   and sealed to the region. It is loaded only when the game is entered, so
 *   it costs the main bundle nothing.
 *
 * The owner's key drops in here and nowhere else: `pubkey`, `relayHint`, and
 * `world: { kind: 'relays' }`. The region, the layout and the rules stay as
 * they are, and his bag is built from the same layout (DEPLOY.md); the entry
 * point comes with the world, as the `entry` item of its bag (DECK-0002
 * §2.2), which the generator places at TUTORIAL_ENTRY. Entering
 * publishes the player's own enter-virtual, pad teleports and exit-virtual,
 * which name this pubkey, so the switch that lets anyone enter
 * (lib/games/flag.ts) stays OFF in production until it is real.
 *
 * The dungeon, in order (cyberspace -Z is forward, the way the camera faces):
 * the ARRIVAL hall, where you appear by virtue of entering, runs to a shrine with a
 * teleport pad; the pad sends you to the CLIMB, a domed rotunda with four
 * platforms rising in jumps of 3 to the key; the GATE, a hall gate the key
 * opens, leads down a hall to the EXIT shrine, whose finish tile stops the
 * clock. Gravity is on throughout.
 *
 * Regenerating the fixture: src/lib/games/__tests__/tutorialDungeon.gen.test.ts.
 */

import type { GameDef } from './types'

/**
 * The region: a cube of height 6 (64 gibsons a side, a key a phone computes
 * in a moment, DECK-0002 §5.2) in ideaspace, its base the bits of
 * sha256("ONOSENDAI tutorial dungeon") read as a coordinate, aligned. Far
 * from everyone: the player reaches it through the game, not across
 * cyberspace.
 */
const BASE = {
  x: 34500138390960292550048512n,
  y: 38447600649236693133563136n,
  z: 29172052326469197797686656n,
}

/** A point of the dungeon, in gibsons from the region's base. */
const at = (x: number, y: number, z: number) => ({ x: BASE.x + BigInt(x), y: BASE.y + BigInt(y), z: BASE.z + BigInt(z) })

/** The dev key that signed the fixture (until the owner's key; see above). */
export const TUTORIAL_DEV_PUBKEY = '718c171d3e5a21c631dfd33159befec43f8687efb91bd42802f380c4afd37663'

/**
 * Where a player appears by virtue of entering (DECK-0002 §2.2): the arrival
 * hall's sealed end, on its floor, facing the shrine. The world carries it,
 * as a flat floor marker with the `entry` tag that the generator places here;
 * this constant is only what the generator writes.
 */
export const TUTORIAL_ENTRY = at(8, 17, 45)

/** The key's coordinate: on the top platform, beside its centre (no other piece stands there). */
const KEY_AT = at(37, 26, 43)
/** The hall gate's coordinate: the sill of the rotunda's hallway, in its rim plane. */
const GATE_AT = at(40, 16, 32)

export const TUTORIAL_GAME: GameDef = {
  pubkey: TUTORIAL_DEV_PUBKEY,
  relayHint: '',
  name: 'TUTORIAL DUNGEON',
  region: { base: BASE, height: 6, plane: 1 },
  pads: [
    // The arrival shrine's pad: to the climb, which nothing joins to the arrival.
    { at: at(8, 17, 24), to: at(40, 17, 45) },
  ],
  world: { kind: 'fixture', load: async () => (await import('./tutorialDungeon.fixture.json')).default.events },
  gravity: true,
  key: { at: KEY_AT },
  door: { at: GATE_AT },
  // Standing on the finish tile in the exit shrine.
  exit: { lo: at(38, 18, 6), hi: at(42, 19, 10) },
}

/**
 * Where each piece stands, for the generator and for the owner's deploy: a
 * Maze Kit tile's origin is the centre of its 16-gibson cell (floor 8 below
 * it), an AeroCarnival piece's is the middle of its top face, a door's is the
 * middle of its sill. `piece` names a payload in the deploy's pieces folder.
 */
export const TUTORIAL_DUNGEON_LAYOUT: ReadonlyArray<{ piece: string; at: ReturnType<typeof at> }> = [
  // The arrival.
  { piece: 'arrival-hall', at: at(8, 24, 40) },
  { piece: 'arrival-shrine', at: at(8, 24, 24) },
  { piece: 'pad', at: at(8, 17, 24) },
  // The climb: four platforms, each 3 above the last but the level jump between the second and third.
  { piece: 'rotunda', at: at(40, 24, 40) },
  { piece: 'platform', at: at(44, 20, 42) },
  { piece: 'platform', at: at(44, 23, 36) },
  { piece: 'platform', at: at(37, 23, 36) },
  { piece: 'platform', at: at(37, 26, 42) },
  { piece: 'key', at: KEY_AT },
  // The gate: both looks at its sill.
  { piece: 'gate-closed', at: GATE_AT },
  { piece: 'gate-open', at: GATE_AT },
  // The way out.
  { piece: 'hall', at: at(40, 24, 24) },
  { piece: 'exit-shrine', at: at(40, 24, 8) },
  { piece: 'finish', at: at(40, 17, 8) },
]
