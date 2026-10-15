/**
 * script.ts: the words and scenes of the /demo tour (arkinox, 2026-10-14).
 *
 * Edit freely: this file is data. Each caption is plain text, one to three
 * short sentences (a few run longer, in arkinox's words), read aloud by
 * SPEAK. A step's `scene` says where to look and at what zoom, `wait` names
 * something the visitor is asked to do (an invitation, with NEXT reading
 * SKIP, unless the step has `gate`: then NEXT waits for it), and `panel`
 * shows a live panel under the caption. Claims are checked against the spec (CYBERSPACE_V2.md)
 * and the DECKs; keep them that way when editing.
 */

import { coordToHex, xyzToCoord } from 'cyberspace-core'
import type { DemoScript } from './types'

/**
 * Block 0, Bitcoin's genesis block: its merkle root as an explorer shows it
 * (DECK-0001 §1). The last bit is 1, so its station is a port in ideaspace
 * at the root read as a coordinate. Checked 2026-10-15 with the app's own
 * functions (headers.ts over the headers-v1 blob 0, stops.ts stopFromAnchor):
 * block 0 hashes to the pinned GENESIS_HASH, its root has plane bit 1, and
 * its stop is a port at exactly this coordinate. Inside the header blobs, so
 * the tour names it at once with no relay.
 */
export const GENESIS_ROOT = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b'

/**
 * The demo district: where chapter 5 flies everyone to scan and find
 * things. Block 0's port (arkinox, 2026-10-15: he builds a welcoming area
 * there for the class on 2026-10-28). Labeled as the tour labels any
 * station. A full 64-hex coord256; its last bit is the plane (1 = ideaspace).
 */
export const DEMO_DISTRICT = {
  coord: GENESIS_ROOT,
  label: 'BLOCK 0 · PORT',
}

/**
 * Whose hidden things the tour shows at the district: arkinox and his agent
 * XOR. A famous public station can collect anything from anyone before the
 * class, so the district's steps draw only these authors (DemoScene.curated);
 * ONOSENDAI outside the tour shows everything as before. Hex pubkeys:
 * npub1arkn0xxxll4llgy9qxkrncn3vc4l69s0dz8ef3zadykcwe7ax3dqrrh43w (arkinox),
 * npub16njvq7dd3chcftcd54hetstpgvfzdy6rnrncc73uy38z23lk702qa5ehsr (XOR's
 * cyberspace identity, the key its MCP body signs with).
 */
export const DEMO_CURATORS: readonly string[] = [
  'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a',
  'd4e4c079ad8e2f84af0da56f95c161431226934398e78c7a3c244e2547f6f3d4',
]

/** The port example: block 0's station, the same place as the district. */
const PORT_ROOT = GENESIS_ROOT
/**
 * The landfall example: block 1's merkle root. Its last bit is 0, so its
 * station is on Earth, placed by the block hash
 * (00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048); checked
 * 2026-10-15 the same way as block 0, a landfall in dataspace.
 */
const LANDFALL_ROOT = '0e3e2357e806b6cdb1f70b54c3a3a17b6714ee1f0e68bebb44a74b1efd512098'

/**
 * Earth's center: dataspace's half-axis point, where §9.7 centers the WGS84
 * mapping (lib/earthSurface.ts CENTRE). The planes step looks at Earth from
 * here; Earth's radius is about 2^55.6 gibsons.
 */
const EARTH_CENTER = coordToHex(xyzToCoord(1n << 84n, 1n << 84n, 1n << 84n, 0)).padStart(64, '0')

export const DEMO_SCRIPT: DemoScript = {
  chapters: [
    { id: 'key', title: 'Identity is location' },
    { id: 'nostr', title: 'Built on Nostr' },
    { id: 'scale', title: 'Scale' },
    { id: 'work', title: 'Distance costs work' },
    { id: 'hidden', title: 'Hidden in place' },
    { id: 'items', title: 'Items and chests' },
    { id: 'hyperspace', title: 'Hyperspace' },
    { id: 'others', title: 'Others' },
    { id: 'agents', title: 'Agents' },
    { id: 'yours', title: 'Your turn' },
  ],
  steps: [
    // 1. Identity is location
    {
      id: 'welcome', chapter: 'key', title: 'Welcome to cyberspace',
      caption: 'This is a guided tour of cyberspace. The red dodecahedron is your avatar, located at your spawn point. You can customize your avatar later. Let\'s talk about how you got here.',
      // An identity with a chain is not at its spawn, and one with its own
      // avatar is not a red dodecahedron (2026-10-15).
      captionReturning: 'This is a guided tour of cyberspace. The shape at the center is your avatar, at your current position. Let\'s talk about how you got here.',
      // Your own head, in its own plane, at 2^0 (arkinox, 2026-10-15).
      scene: { target: 'self', scale: 0 },
    },
    {
      id: 'everything', chapter: 'key', title: 'All of cyberspace',
      caption: 'This cubic area is all of cyberspace. It is 0.48 light years across and Earth is at the center. Note where your avatar is relative to the whole cube. Touch and drag to orbit the camera.',
      scene: { target: 'self', scale: 84 },
    },
    {
      id: 'spawn', chapter: 'key', title: 'Your key is a place',
      caption: 'Your Nostr public key is a 256-bit number, and that number is also a coordinate. This is your spawn point. No one assigned it; a random private key is generated using CSPRNG and becomes a public key deterministically.',
      scene: { target: 'spawn', scale: 0 },
    },
    {
      id: 'identity', chapter: 'key', title: 'Identity is location',
      caption: 'Know someone\'s public key and you know where they spawn. Want a different spawn point? You need a different private key, which is a whole new identity. However, your spawn point is only the beginning of your story. Soon we\'ll move around.',
      scene: { target: 'spawn', scale: 0 },
    },

    // 2. Built on Nostr
    {
      id: 'event', chapter: 'nostr', title: 'Everything is an event',
      caption: 'Everything in cyberspace is a Nostr event: a small JSON object signed by a key. This is your newest movement event, kind 3333.',
      captionNew: 'Everything in cyberspace is a Nostr event: a small JSON object signed by a key. You have no movement events yet, so this is the spawn event that will start your chain, kind 3333.',
      scene: { target: 'self', scale: 0 },
      panel: 'event-json',
      wait: 'spawn',
      gate: true,
      hint: 'Press SPAWN to sign your spawn event.',
    },
    {
      id: 'verify', chapter: 'nostr', title: 'Checked, not trusted',
      caption: 'An event\'s ID is the SHA-256 hash of its fields, and its signature is a Schnorr signature by your private key over that ID. Your browser just checked both: only your key could have made this event.',
      captionWaiting: 'An event\'s ID is the SHA-256 hash of its fields, and its signature is a Schnorr signature by your private key over that ID. Your cursor is set 3 gibsons up, right and forward: press COMMIT to sign a hop, and the tour will check it.',
      scene: { target: 'keep', scale: 0 },
      panel: 'verify',
      wait: 'own-hop',
      gate: true,
      aim: { up: 3, right: 3, forward: 3, scale: 0 },
      hint: 'Press COMMIT to make the hop.',
    },
    {
      id: 'relays', chapter: 'nostr', title: 'Relays',
      caption: 'Relays are simple servers that store and forward events. Anyone can run one. The state of cyberspace is the union of all cyberspace events you can access, which may be across multiple relays.',
      scene: { target: 'keep', scale: 0 },
      panel: 'relays',
    },
    {
      id: 'kinds', chapter: 'nostr', title: 'Kinds',
      caption: 'The kind number says what an event means. Cyberspace defines a few: movement, hidden bags, objects, avatars, and hyperspace block anchors.',
      scene: { target: 'keep', scale: 0 },
      panel: 'kinds',
    },
    {
      id: 'chain', chapter: 'nostr', title: 'A hash-linked chain',
      caption: 'Every movement event names the one before it by ID. Your history is a hash-linked chain that anyone can fetch and verify, with no server to trust. Use the Controls panel in the bottom right to choose a new coordinate to move to and COMMIT.',
      scene: { target: 'keep', scale: 0 },
      panel: 'chain',
      wait: 'hop',
      gate: true,
      gateUnlessHadHops: true,
      hint: 'Choose a new coordinate, then press COMMIT.',
    },
    {
      id: 'portable', chapter: 'nostr', title: 'Yours, not ours',
      caption: 'Your key and your events belong to you, not to ONOSENDAI. The events carry your unique verifiable signature and live on relays. Other apps can read them too: Ditto already shows cyberspace objects as furniture in the virtual pet minigame.',
      scene: { target: 'keep', scale: 0 },
    },

    // 3. Scale
    {
      id: 'gibson', chapter: 'scale', title: 'The gibson',
      caption: 'Space is three axes of 85 bits each. One step along an axis is a gibson, the smallest unit in cyberspace, which is roughly the size of a hydrogen atom.',
      scene: { target: 'self', scale: 0 },
    },
    {
      id: 'human', chapter: 'scale', title: 'Powers of two',
      caption: 'Each zoom level doubles what you see. At 2^34 gibsons across, the scale the spec calls human height, a region is about two meters in dataspace.',
      scene: { target: 'self', scale: 34 },
    },
    {
      id: 'cube', chapter: 'scale', title: 'The whole cube',
      caption: 'This is all of it: 2^85 gibsons on a side. Zoom yourself with the + and − keys on the pad, or Q and E.',
      scene: { target: 'self', scale: 84, plane: 1 },
    },
    {
      id: 'planes', chapter: 'scale', title: 'Two planes',
      caption: 'The last bit of a coordinate picks the plane. Dataspace maps onto Earth and the space around it. Ideaspace is the same space with no physical meaning.',
      scene: { target: { coord: EARTH_CENTER, label: 'EARTH' }, scale: 54 },
    },

    // 4. Distance costs work
    {
      id: 'cantor', chapter: 'work', title: 'Moving is work',
      caption: 'Moving is not free. To hop, you compute a Cantor pairing tree over the region you cross, and that computation is the proof. The blue area is the region you\'ll compute when you press COMMIT.',
      scene: { target: 'self', scale: 0, layers: { boxes: true } },
      // A preview only: the cursor 5 gibsons up shows the region a hop there
      // would cover (CoveringBox), and the next step brings it home.
      aim: { up: 5, right: 0, forward: 0, scale: 0 },
    },
    {
      id: 'lca', chapter: 'work', title: 'Boundaries',
      caption: 'The cost is set by the highest power-of-two boundary you cross on each axis, its LCA height. A height h boundary means a tree with 2^h leaves. The boxes around you are those boundaries.',
      scene: { target: 'self', scale: 0, layers: { boxes: true } },
    },
    {
      id: 'no-cheat', chapter: 'work', title: 'No shortcuts',
      caption: 'The proof travels in each hop event\'s tags. Many small steps cost no less than one big one: any path across a boundary must cross it. Each hop also does a small piece of work seeded by the previous event, so a chain cannot be computed ahead of time or replayed.',
      scene: { target: 'self', scale: 0 },
    },
    {
      id: 'walk', chapter: 'work', title: 'Walk',
      caption: 'Press the mode button under the pad until it reads WALK. You move first person, and the grid on the walls shows how hard each boundary is to cross.',
      scene: { target: 'self', scale: 0, layers: { boxes: true } },
      wait: 'walk',
      hint: 'Tap the mode button until it reads WALK.',
    },

    // 5. Hidden in place
    {
      id: 'region-keys', chapter: 'hidden', title: 'Places have keys',
      caption: 'Every aligned region has a key derived from its Cantor root. The green boxes represent regions you have the keys for.',
      // 2^0, where the regions of the tour's own small hops are drawn (SecretRegions).
      scene: { target: 'self', scale: 0 },
    },
    {
      id: 'district', chapter: 'hidden', title: 'The demo district',
      caption: 'This is the demo district. As you arrive, ONOSENDAI computes the region keys around you and asks the relays for anything encrypted to them.',
      scene: { target: 'district', scale: 8, curated: true },
      wait: 'scan',
      hint: 'Scanning the district.',
    },
    {
      id: 'found', chapter: 'hidden', title: 'Found',
      caption: 'Whatever decrypted is now drawn in the scene. Tap something to open it.',
      scene: { target: 'keep', scale: 8, curated: true },
      wait: 'open-item',
      hint: 'Tap something you found.',
      emptyHint: 'Nothing is hidden here yet.',
    },
    {
      id: 'chalk', chapter: 'hidden', title: 'Chalk on the sidewalk',
      caption: 'Think of chalk on a sidewalk. The ciphertext sits on public relays, but only someone who did the work of being here can read it.',
      scene: { target: 'keep', scale: 0, curated: true },
    },

    // 6. Items and chests
    {
      id: 'key-item', chapter: 'items', title: 'Key items',
      caption: 'A key item is a keypair hidden at a place. Find it and you hold its private key, and holding the key is owning the item.',
      scene: { target: 'keep', scale: 0, curated: true },
    },
    {
      id: 'chest', chapter: 'items', title: 'Chests',
      caption: 'A chest is a list of things sealed to an item\'s public key. Whoever holds that item can open it, wherever the chest is found.',
      scene: { target: 'keep', scale: 0, curated: true },
    },
    {
      id: 'item-feed', chapter: 'items', title: 'The item feed',
      caption: 'A creator can list an item in the ITEM FEED: its name, picture and public key, never the private key. Then anyone can seal a chest to it.',
      scene: { target: 'keep', scale: 0, curated: true },
    },

    // 7. Hyperspace
    {
      id: 'line', chapter: 'hyperspace', title: 'A line through space',
      caption: 'Hyperspace is a transit line threaded through cyberspace by Bitcoin\'s proof of work. Every Bitcoin block is a station you can board or disembark.',
      // Ideaspace at 2^84, the line running station to station (TourLine).
      scene: { target: 'self', scale: 84, plane: 1, hyperline: true },
    },
    {
      id: 'port', chapter: 'hyperspace', title: 'A port',
      caption: 'When a block\'s merkle root ends in a 1 bit, its station is a port in ideaspace, sitting exactly at the merkle root read as a coordinate. This is block 0, Bitcoin\'s genesis block.',
      // Block 0's port is the district's own coordinate, so the port step
      // draws only the curators' things too (review of #364, 2026-10-15).
      scene: { target: { block: PORT_ROOT }, scale: 0, curated: true },
    },
    {
      id: 'landfall', chapter: 'hyperspace', title: 'A landfall',
      caption: 'Otherwise the station is a landfall on Earth, at a point derived from the block hash. This is block 1.',
      scene: { target: { block: LANDFALL_ROOT }, scale: 52 },
    },
    {
      id: 'ride', chapter: 'hyperspace', title: 'Riding the line',
      caption: 'To ride, you board from where you stand and appear at your station, the nearest one. A ride proves fresh work for every block it passes, and from the stop where you arrive, the last mile is ordinary movement.',
      scene: { target: 'self', scale: 84, plane: 1, hyperline: true },
    },

    // 8. Others
    {
      id: 'avatars', chapter: 'others', title: 'Avatars',
      caption: 'People choose shapes to be seen as. An avatar is an event with proof of work priced by the shape\'s size and detail.',
      scene: { target: 'self', scale: 0 },
    },
    {
      id: 'presence', chapter: 'others', title: 'Presence',
      caption: 'Presence comes from movement chains. When someone moves near you, their newest event puts them here.',
      scene: { target: 'self', scale: 0 },
    },
    {
      id: 'chat', chapter: 'others', title: 'Local chat',
      caption: 'Local chat is sealed to the region you stand in, so only people here can read it. Type @ to tag someone and they are notified.',
      scene: { target: 'self', scale: 0, chat: true },
    },

    // 9. Agents
    {
      id: 'agents', chapter: 'agents', title: 'Agents live here too',
      caption: 'AI agents live in cyberspace too. An agent has its own key and its own movement chain, and it pays the same costs to move.',
      scene: { target: 'self', scale: 0 },
    },
    {
      id: 'operator', chapter: 'agents', title: 'One operator',
      caption: 'An agent obeys only its operator: the person its profile names, who also follows it. Orders arrive as private NIP-17 messages.',
      scene: { target: 'keep', scale: 0 },
    },
    {
      id: 'xor', chapter: 'agents', title: 'XOR',
      caption: 'XOR is one such agent. It builds objects, hides them and rides hyperspace, all through the same protocol you just used.',
      scene: { target: 'keep', scale: 0 },
    },

    // 10. Your turn
    {
      id: 'menu', chapter: 'yours', title: 'The menu',
      caption: 'There are many useful panels in the menu. Each includes an EXPLAIN button to help you learn more.',
      scene: { target: 'self', scale: 0, highlight: '.hamburger-menu' },
    },
    {
      id: 'recap', chapter: 'yours', title: 'That is cyberspace',
      caption: 'Identity is location, distance costs work, and places can hold secrets. There is no administrator who can move you or delete you.',
      scene: { target: 'self', scale: 0 },
    },
    {
      id: 'live', chapter: 'yours', title: 'Go LIVE',
      caption: 'Going LIVE publishes your movement chain to relays, including the hops you made in this tour. You can also stay LOCAL and keep exploring.',
      scene: { target: 'keep', scale: 0 },
      panel: 'finish',
    },
  ],
}
