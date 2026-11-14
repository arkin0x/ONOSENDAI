/**
 * tutorialGame.ts - THE constant for the first-arrival tutorial's dungeon
 * (first-arrival tutorial, Track C; DECK-0002 §9). Its design, map and the
 * owner's deploy steps: onosendai/games-dungeon/DESIGN.md and DEPLOY.md.
 *
 * The dungeon is live under its real key since 2026-11-13. The owner first
 * ruled (2026-11-10) that he would create and hold the game's npub; on
 * 2026-11-13 he had it generated and kept on the build machine instead, and
 * the world was published under it. THE ONE LINE is TUTORIAL_PUBKEY, below.
 * Back when it was the DEV key:
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
 * clock. Gravity is on throughout. A player who climbs out through the
 * rotunda's open oculus and falls finds a pad on the region's floor that sends
 * them back to the arrival (FALLOUT_PAD).
 *
 * The key and the gate are Cyberspace primitives (owner, 2026-11-13, ruled A):
 * the key is a key item (DECK-0004 §2) in a bag of its own sealed to the
 * small region around the top platform (KEY_BAG), opened when a player
 * reaches it in the game; the gate is a DECK-0004 door in the world bag,
 * sealed to that key item, whose room holds the finish tile. The code plays
 * that world and the one published 2026-11-13 (game-only key and gate,
 * `key` and `door` below, LEGACY) alike, by what the newest world bag holds
 * (lib/games/keyDoor.ts), so the code deploys first and the world switches
 * after. Design: onosendai/games-dungeon/DESIGN.md, "The key and the gate as
 * Cyberspace primitives"; publish order: deploy/world-ee248d6a-v2/DEPLOY-v2.md.
 *
 * Regenerating the fixture: src/lib/games/__tests__/tutorialDungeon.gen.test.ts.
 */

import type { GameDef, GamePad, GameWorldSource } from './types'

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
export const KEY_AT = at(37, 26, 43)
/** The hall gate's coordinate: the sill of the rotunda's hallway, in its rim plane. The door stands here. */
export const GATE_AT = at(40, 16, 32)

/**
 * The key item's bag: sealed to the region of height 3 holding the key, the
 * smallest aligned cube that holds the whole top platform and the air a
 * player stands and jumps in over it (offsets 32 to 39, 24 to 31, 40 to 47:
 * height 2 leaves the platform's far row out). Reaching it in the game derives
 * its key, a moment's work, and opens the bag. No other platform reaches it.
 */
export const KEY_BAG = { at: KEY_AT, height: 3 }

/** The gate door's height: its room is the whole dungeon region (DECK-0004 §3.7.1: no higher than the bag holding it). */
export const GATE_DOOR_HEIGHT = 6

/**
 * The way back in for a player who fell out of the dungeon (owner, 2026-11-13:
 * "make a teleport that brings you back to the main room that is on the
 * game's region boundary floor"). The rotunda's oculus is open (it keeps the
 * piece under the inline size limit, DESIGN.md), and a double jump from the key
 * platform's edge goes up through it onto the dome; off the dome, or the hall
 * roof it joins, a player falls past every room to the region's lower edge,
 * the one floor that is not a face (lib/games/gravity.ts standing). Nothing
 * stands on that floor, and nothing stands below the rooms' floors, so all of
 * it is one open floor, walked to anywhere.
 *
 * So one pad is enough, on that floor directly under the oculus: a fall off
 * the dome lands within a few gibsons of it, and its column of light (`beacon`)
 * is seen from anywhere on the floor. It sends the player to the arrival, the
 * main room, on the entry point, where the run began. The world is not
 * changed (it is published under the game key): this pad is game logic only,
 * drawn by the game view (game/GameView.tsx PadMark), with no world shard.
 * Its own coordinate is one under the floor, outside the region, because a
 * pad holds whoever stands one gibson above it (lib/games/play.ts padUnder).
 */
export const FALLOUT_PAD: GamePad = { at: at(40, -1, 40), to: TUTORIAL_ENTRY, beacon: 15 }

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
      // The way back for anyone who fell out (owner, 2026-11-13). See FALLOUT_PAD.
      FALLOUT_PAD,
    ],
    world: dev ? TUTORIAL_FIXTURE_WORLD : { kind: 'relays' },
    gravity: true,
    // LEGACY: the game-only key and gate of the world published 2026-11-13, read only while its bag holds no door.
    key: { at: KEY_AT },
    door: { at: GATE_AT },
    keyBag: KEY_BAG,
    // Standing on the finish tile in the exit shrine. From one lower too: the tile stands in the gate's room, and a room
    // that could not be retrieved leaves you on the shrine's floor there; with the tile in place that gibson is inside it.
    exit: { lo: at(38, 17, 6), hi: at(42, 19, 10) },
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
