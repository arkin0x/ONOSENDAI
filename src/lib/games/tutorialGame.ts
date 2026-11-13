/**
 * tutorialGame.ts - THE constant for the first-arrival tutorial's dungeon
 * (first-arrival tutorial, Track C; DECK-0002 §9). Its design, map and the
 * owner's deploy steps: onosendai/games-dungeon/DESIGN.md and DEPLOY.md.
 *
 * The dungeon is real; its key is not yet. The owner rules (2026-11-10) that
 * the game is a new npub he creates and holds, and that he deploys the
 * pieces himself. THE ONE LINE is TUTORIAL_PUBKEY, below. While it is the
 * DEV key:
 *
 * - the DEV key was generated on the build machine. Its secret is not in
 *   this repository. Nothing it signed has been, or may be, sent to any relay.
 * - `world` is a bundled fixture: the dungeon's one bag, signed by that key
 *   and sealed to the region. It is loaded only when the game is entered, so
 *   it costs the main bundle nothing.
 * - `relayHint` is empty, and the game is off on the production host
 *   (lib/games/flag.ts): entries are permanent public history, and they
 *   would name a throwaway key.
 *
 * Set to the owner's hex pubkey, and nothing else changed, the game is LIVE
 * (lib/games/flag.ts gameLive): `world` becomes `{ kind: 'relays' }` (his
 * world, published per DEPLOY.md), `relayHint` becomes the canonical relay,
 * and the game is on everywhere, production included, so the tutorial's
 * final card offers DUNGEON. The region, the layout and the rules stay as
 * they are; his world is built from the DEV fixture's own items
 * (lib/games/worldDeploy.ts), so it is the same dungeon, entry point
 * included (the `entry` item, DECK-0002 §2.2, at TUTORIAL_ENTRY).
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

import type { GameDef, GameWorldSource } from './types'

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

/**
 * THE ONE LINE: the tutorial dungeon's game key, 64 lowercase hex. Set
 * 2026-11-13 (owner: "you can generate a tutorial key with nak and keep it
 * locally for the game key. lets get the tutorial live today"): the
 * dungeon's world (15 objects and its bag) is published under it on
 * wss://relay.onosendai.tech. Its secret is kept off-repo on the build
 * machine, never in this code.
 */
export const TUTORIAL_PUBKEY: string = 'ee248d6a63557359a4afe95e7eed365499393a0c9d06cbb7ce7df658fdf06a5b'

/** The relay the owner publishes the world to (DEPLOY.md), and every live entry's relay hint (DECK-0002 §2.1). */
export const TUTORIAL_RELAY = 'wss://relay.onosendai.tech'

/** The DEV world: the bundled fixture, signed by the DEV key, never on any relay. */
export const TUTORIAL_FIXTURE_WORLD: GameWorldSource = { kind: 'fixture', load: async () => (await import('./tutorialDungeon.fixture.json')).default.events }

/**
 * The tutorial dungeon under game key `pubkey`: the DEV key reads the
 * bundled fixture with no relay hint, as it always has; any other key reads
 * its world from the relays, hinted at TUTORIAL_RELAY.
 */
export function tutorialGameFor(pubkey: string): GameDef {
  const dev = pubkey === TUTORIAL_DEV_PUBKEY
  return {
    pubkey,
    relayHint: dev ? '' : TUTORIAL_RELAY,
    name: 'TUTORIAL DUNGEON',
    region: { base: BASE, height: 6, plane: 1 },
    pads: [
      // The arrival shrine's pad: to the climb, which nothing joins to the arrival.
      { at: at(8, 17, 24), to: at(40, 17, 45) },
    ],
    world: dev ? TUTORIAL_FIXTURE_WORLD : { kind: 'relays' },
    gravity: true,
    key: { at: KEY_AT },
    door: { at: GATE_AT },
    // Standing on the finish tile in the exit shrine.
    exit: { lo: at(38, 18, 6), hi: at(42, 19, 10) },
  }
}

export const TUTORIAL_GAME: GameDef = tutorialGameFor(TUTORIAL_PUBKEY)

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
