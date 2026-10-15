/**
 * script.ts: the words and scenes of the /demo tour (arkinox, 2026-10-14).
 *
 * Edit freely: this file is data. Each caption is plain text, one to three
 * short sentences, read aloud by SPEAK. A step's `scene` says where to look
 * and at what zoom, `wait` names something the visitor is asked to do (the
 * tour never forces it: NEXT always works), and `panel` shows a live panel
 * under the caption. Claims are checked against the spec (CYBERSPACE_V2.md)
 * and the DECKs; keep them that way when editing.
 */

import type { DemoScript } from './types'

/**
 * The demo district: where chapter 5 flies everyone to scan and find
 * things. PLACEHOLDER (2026-10-14): the port of Bitcoin block 971,473, a
 * real hyperspace port in ideaspace, read from its kind 321 anchor.
 * arkinox: replace with the port you choose once the demo world is built
 * there. A full 64-hex coord256; its last bit is the plane (1 = ideaspace).
 */
export const DEMO_DISTRICT = {
  coord: 'c68df687ca58f6d3a9e8b7e6ab7fdd94d32b155c4f7d5351f4edb8be32d891cb',
  label: 'DEMO DISTRICT',
}

/** A port: block 971,270's merkle root as an explorer shows it (DECK-0001 §1). */
const PORT_ROOT = '6edfc6badd201e338a5003ac86485f273838406c7825caae704e71824c985e93'
/** A landfall: block 900,000's merkle root; its stop is on Earth, placed by the block hash. */
const LANDFALL_ROOT = '0cfb54e522b07bd1a381adc774ec1851590ef4c3add83958135106534569f970'

export const DEMO_SCRIPT: DemoScript = {
  chapters: [
    { id: 'key', title: 'You are a key' },
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
    // 1. You are a key
    {
      id: 'welcome', chapter: 'key', title: 'Welcome to Cyberspace',
      caption: 'This is a guided tour of Cyberspace. It runs in LOCAL mode: nothing you do here leaves this device unless you choose to go LIVE at the end.',
      scene: { target: 'self', scale: 6 },
    },
    {
      id: 'spawn', chapter: 'key', title: 'Your key is a place',
      caption: 'Your Nostr public key is a 256-bit number, and that number is also a coordinate. This is your spawn point. No one assigned it; the math did.',
      scene: { target: 'spawn', scale: 6 },
    },
    {
      id: 'identity', chapter: 'key', title: 'Identity is location',
      caption: 'Know someone\'s public key and you know where they spawn. Want a different spawn point? You need a different key.',
      scene: { target: 'spawn', scale: 20 },
    },

    // 2. Built on Nostr
    {
      id: 'event', chapter: 'nostr', title: 'Everything is an event',
      caption: 'Everything here is a Nostr event: a small JSON object signed by a key. This is your newest movement event, kind 3333.',
      captionNew: 'Everything here is a Nostr event: a small JSON object signed by a key. You have not moved yet, so this is the spawn event your first move will sign.',
      scene: { target: 'self', scale: 6 },
      panel: 'event-json',
    },
    {
      id: 'verify', chapter: 'nostr', title: 'Checked, not trusted',
      caption: 'An event\'s id is the SHA-256 hash of its fields, and its signature is a Schnorr signature over that id. Your browser just checked both: only your key could have made this event.',
      captionNew: 'An event\'s id is the SHA-256 hash of its fields, and its signature is a Schnorr signature over that id. Make your first move and the tour will check yours.',
      scene: { target: 'keep' },
      panel: 'verify',
    },
    {
      id: 'relays', chapter: 'nostr', title: 'Relays',
      caption: 'Relays are simple servers that store and forward events. Anyone can run one, and no relay can forge your moves, because it cannot sign as you.',
      scene: { target: 'keep' },
      panel: 'relays',
    },
    {
      id: 'kinds', chapter: 'nostr', title: 'Kinds',
      caption: 'The kind number says what an event means. Cyberspace defines a few: movement, hidden bags, objects, avatars, and Bitcoin block anchors.',
      scene: { target: 'keep' },
      panel: 'kinds',
    },
    {
      id: 'chain', chapter: 'nostr', title: 'A hash-linked chain',
      caption: 'Every movement event names the one before it by id. Your history is a hash-linked chain that anyone can fetch and verify, with no server to trust.',
      scene: { target: 'keep' },
      panel: 'chain',
    },
    {
      id: 'portable', chapter: 'nostr', title: 'Yours, not ours',
      caption: 'Your key and your events belong to you, not to ONOSENDAI. Other apps can read them too: Ditto already shows Cyberspace objects as furniture.',
      scene: { target: 'keep' },
    },

    // 3. Scale
    {
      id: 'gibson', chapter: 'scale', title: 'The gibson',
      caption: 'Space is three axes of 85 bits each. One step along an axis is a gibson, the smallest distance there is.',
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
      scene: { target: 'self', scale: 84 },
    },
    {
      id: 'planes', chapter: 'scale', title: 'Two planes',
      caption: 'The last bit of a coordinate picks the plane. Dataspace maps onto Earth and the space around it. Ideaspace is the same space with no physical meaning.',
      scene: { target: 'self', scale: 52 },
    },

    // 4. Distance costs work
    {
      id: 'cantor', chapter: 'work', title: 'Moving is work',
      caption: 'Moving is not free. To hop, you compute a Cantor pairing tree over the region you cross, and that computation is the proof.',
      scene: { target: 'self', scale: 4, layers: { boxes: true } },
    },
    {
      id: 'lca', chapter: 'work', title: 'Boundaries',
      caption: 'The cost is set by the highest power-of-two boundary you cross on each axis, its LCA height. A height h boundary means a tree with 2^h leaves. The boxes around you are those boundaries.',
      scene: { target: 'self', scale: 4, layers: { boxes: true } },
    },
    {
      id: 'hop', chapter: 'work', title: 'Make a hop',
      caption: 'Your turn. Move the cursor with the pad or WASD, then press COMMIT. The hop is proved and signed right here on this device.',
      scene: { target: 'self', scale: 2 },
      wait: 'hop',
      hint: 'Move the cursor, then press COMMIT.',
    },
    {
      id: 'hop-event', chapter: 'work', title: 'What you just made',
      caption: 'This is the event your hop created. The proof is in its tags, and its previous tag names the move before it.',
      scene: { target: 'self' },
      panel: 'event-json',
    },
    {
      id: 'no-cheat', chapter: 'work', title: 'No shortcuts',
      caption: 'Many small steps cost no less than one big one: any path across a boundary must cross it. Each hop also does a small piece of work seeded by the previous event, so a chain cannot be computed ahead of time or replayed.',
      scene: { target: 'self' },
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
      caption: 'Every aligned region has a key derived from its Cantor root. You get it by doing the work of being there. Looking costs about the same as walking in, and a little less.',
      scene: { target: 'self' },
    },
    {
      id: 'district', chapter: 'hidden', title: 'The demo district',
      caption: 'This is the demo district. As you arrive, ONOSENDAI computes the region keys around you and asks the relays for anything encrypted to them.',
      scene: { target: 'district', scale: 8 },
      wait: 'scan',
      hint: 'Scanning the district.',
    },
    {
      id: 'found', chapter: 'hidden', title: 'Found',
      caption: 'Whatever decrypted is now drawn in the scene. Tap something to open it.',
      scene: { target: 'keep' },
      wait: 'open-item',
      hint: 'Tap something you found.',
    },
    {
      id: 'chalk', chapter: 'hidden', title: 'Chalk on the sidewalk',
      caption: 'Think of chalk on a sidewalk. The ciphertext sits on public relays, but only someone who did the work of being here can read it.',
      scene: { target: 'keep' },
    },

    // 6. Items and chests
    {
      id: 'key-item', chapter: 'items', title: 'Key items',
      caption: 'A key item is a keypair hidden at a place. Find it and you hold its private key, and holding the key is owning the item.',
      scene: { target: 'keep' },
    },
    {
      id: 'chest', chapter: 'items', title: 'Chests',
      caption: 'A chest is a list of things sealed to an item\'s public key. Whoever holds that item can open it, wherever the chest is found.',
      scene: { target: 'keep' },
    },
    {
      id: 'item-feed', chapter: 'items', title: 'The item feed',
      caption: 'A creator can list an item in the ITEM FEED: its name, picture and public key, never the private key. Then anyone can seal a chest to it.',
      scene: { target: 'keep' },
    },

    // 7. Hyperspace
    {
      id: 'line', chapter: 'hyperspace', title: 'A line through space',
      caption: 'Hyperspace is a transit line threaded through Cyberspace by Bitcoin\'s proof of work. Every Bitcoin block is a stop on it.',
      scene: { target: 'self', scale: 84 },
    },
    {
      id: 'port', chapter: 'hyperspace', title: 'A port',
      caption: 'When a block\'s merkle root ends in a 1 bit, its stop is a port in ideaspace, sitting exactly at the merkle root read as a coordinate. This is block 971,270.',
      scene: { target: { block: PORT_ROOT }, scale: 12 },
    },
    {
      id: 'landfall', chapter: 'hyperspace', title: 'A landfall',
      caption: 'Otherwise the stop is a landfall on Earth, at a point derived from the block hash. This is block 900,000.',
      scene: { target: { block: LANDFALL_ROOT }, scale: 40 },
    },
    {
      id: 'ride', chapter: 'hyperspace', title: 'Riding the line',
      caption: 'To ride, you board from where you stand and appear at your station, the nearest stop. A ride proves fresh work for every block it passes, and from the stop where you arrive, the last mile is ordinary movement.',
      scene: { target: 'keep' },
    },

    // 8. Others
    {
      id: 'avatars', chapter: 'others', title: 'Avatars',
      caption: 'People choose shapes to be seen as. An avatar is an event with proof of work priced by the shape\'s size and detail.',
      scene: { target: 'self', scale: 4 },
    },
    {
      id: 'presence', chapter: 'others', title: 'Presence',
      caption: 'Presence comes from movement chains. When someone moves near you, their newest event puts them here.',
      scene: { target: 'self' },
    },
    {
      id: 'chat', chapter: 'others', title: 'Local chat',
      caption: 'Local chat is sealed to the region you stand in, so only people here can read it. Type @ to tag someone and they are notified.',
      scene: { target: 'self', chat: true },
    },

    // 9. Agents
    {
      id: 'agents', chapter: 'agents', title: 'Agents live here too',
      caption: 'AI agents live in Cyberspace too. An agent has its own key and its own movement chain, and it pays the same costs to move.',
      scene: { target: 'self' },
    },
    {
      id: 'operator', chapter: 'agents', title: 'One operator',
      caption: 'An agent obeys only its operator: the person its profile names, who also follows it. Orders arrive as private NIP-17 messages.',
      scene: { target: 'keep' },
    },
    {
      id: 'xor', chapter: 'agents', title: 'XOR',
      caption: 'XOR is one such agent. It builds objects, hides them and rides hyperspace, all through the same protocol you just used.',
      scene: { target: 'keep' },
    },

    // 10. Your turn
    {
      id: 'recap', chapter: 'yours', title: 'That is Cyberspace',
      caption: 'Identity is location, distance costs work, and places can hold secrets. There is no administrator who can move you or delete you.',
      scene: { target: 'self', scale: 6 },
    },
    {
      id: 'live', chapter: 'yours', title: 'Go LIVE',
      caption: 'Going LIVE publishes your movement chain to relays, including the hops you made in this tour. You can also stay LOCAL and keep exploring.',
      scene: { target: 'keep' },
      panel: 'finish',
    },
  ],
}
