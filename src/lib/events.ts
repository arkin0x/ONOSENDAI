/**
 * events.ts — the movement chain as it goes on the wire.
 *
 * Everything the app knows about where an avatar is comes down to a per-pubkey
 * linear chain of signed kind:3333 events (spec §8): one spawn, then hops and
 * sidesteps, each naming the one before it. Until now the proof hash stood in
 * for the previous event id, which kept the temporal work honest but produced
 * nothing anyone else could read or verify. These builders produce the real
 * thing, so the same chain that drives the avatar is the chain that gets
 * published, and the same parser that reads our own events reads everyone
 * else's.
 *
 * Pure. Signing happens in the store, which is the only place the key lives;
 * this file only ever sees templates and finished events.
 */

import {
  coordToHex,
  coordToXyz,
  hexToCoord,
  sectorTag,
  xyzToCoord,
  xyzToSectorId,
  type Plane,
} from 'cyberspace-core'
import type { Position } from './space'

/** §8.1: every movement action, spawn included, is this one kind. */
export const ACTION_KIND = 3333

/**
 * The chain rules this client implements (spec §8.12), with arkinox's
 * rulings of 2026-10-07 folded in: no zero-length ride, and a virtual bracket
 * opaque to the base protocol. A rule this revision introduced is marked on
 * the break (`breakSince`), because a chain made before it was valid when it
 * was made, and the person whose chain it is deserves to be told so.
 */
export const CHAIN_RULES_REVISION = '2026-09-28-virtual-brackets'

/**
 * The actions this client recognizes (spec §8.8, §8.9): the base protocol's
 * three movement actions and two bracket actions, and DECK-0001's two, which
 * every verifier must implement because a hyperjump moves an identity.
 * Every way an identity can change its position is in this list, which is
 * what lets an action outside it be skipped rather than stop the chain.
 */
export const RECOGNIZED_ACTIONS = ['spawn', 'hop', 'sidestep', 'enter-hyperspace', 'hyperjump', 'enter-virtual', 'exit-virtual'] as const

export type RecognizedAction = (typeof RECOGNIZED_ACTIONS)[number]

/**
 * What an action is on the chain. The recognized names, and `other` for
 * every event on a chain that is not a well-formed recognized action in its
 * place: an action this client does not recognize (skipped, spec §8.9), a
 * game's own action inside a bracket (virtual, §8.11.2), or an event that
 * breaks a rule this client can see (broken). Only buildChain produces
 * `other`, because only the chain around an event says which of the three
 * it is; parseAction on its own never returns one.
 */
export type ActionType = RecognizedAction | 'other'

/**
 * The part an event plays in its chain, which buildChain decides by walking
 * the chain from its spawn (spec §8.9, §8.11):
 *
 * | Role | Event | Moves the identity? |
 * |---|---|---|
 * | base | spawn, hop, sidestep, enter-hyperspace, hyperjump outside a bracket | to its `C` |
 * | enter | enter-virtual: a game begins | no: its `c` is held |
 * | virtual | any other name inside a bracket: the game's own move | no |
 * | exit | exit-virtual closing the open bracket | back to the held position |
 * | skipped | a name this client does not recognize, outside a bracket | no: position is carried across |
 * | broken | a recognized name out of place or malformed: a base action inside a bracket (rule 3), an exit with no bracket or the wrong entry (rule 6) | no |
 *
 * A broken event is a point where a verifier says the chain stops being
 * valid. This client is a viewer and not a verifier (parseAction), so it
 * keeps following the links past it, the same way it never checked a proof,
 * and marks the row so nobody reads it as a move.
 *
 * A bracket is opaque to the base protocol (arkinox, 2026-10-07, Q2): inside
 * one, only the links and the names are read. A game's own actions may carry
 * any `c` and `C`, or none, and none of them is checked: not where the last
 * one left off, and not whether it stays in the region. The game checks its
 * own moves; the base protocol checks only that the identity entered from
 * where it stood, did not move by entering, and came back to the same place.
 *
 * More breaks are visible without checking any proof, and each of these
 * keeps its role and carries `breaks` like every broken event: an action
 * whose `c` is not where the chain stood (spec §8.9 rule 2, §8.11.5), an
 * enter-virtual whose `C` is not its own `c` (entering does not move you),
 * and a zero-length ride, whose destination block is the block it started
 * from (abolished, arkinox 2026-10-07, Q1).
 *
 * An invalid chain stands at its last valid position (arkinox, 2026-10-07,
 * Q3): from the first event that breaks a rule on, every entry's position is
 * where the event before that one left the identity, frozen there until a
 * respawn, and what the event itself claimed is kept apart in `declared`.
 */
export type ChainRole = 'base' | 'enter' | 'virtual' | 'exit' | 'skipped' | 'broken'

/** A place in cyberspace, in the three forms the app passes around. */
export interface Placed {
  coordHex: string
  position: Position
  plane: Plane
  /** The `S` tag for this place. */
  sector: string
}

/** The aligned cube a game is played in (spec §8.11.1). */
export interface GameRegion {
  /** The cube's aligned base, 64 lowercase hex. */
  coordHex: string
  /** The cube's height H: each side is 2^H gibsons. */
  height: number
  base: Position
  plane: Plane
}

/** The shape nostr-tools signs and relays return; named here so nothing in
 * the app has to import it from the library to talk about an event. */
export interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

export type EventTemplate = Pick<NostrEvent, 'kind' | 'tags' | 'content' | 'created_at'>

/** A kind:3333 event with its tags read back into what they mean. */
export interface ActionEvent {
  id: string
  pubkey: string
  createdAt: number
  type: ActionType
  /** The `A` tag as written. The same as `type` for a recognized action; the game's or the extension's own name otherwise. */
  name: string
  /** The part this event plays in its chain (ChainRole). parseAction gives the role a recognized action has on its own; buildChain decides it in context. */
  role: ChainRole
  /**
   * Where the identity is in cyberspace once this action stands. For a base
   * action and an exit that is its `C` tag. For an enter-virtual it is the
   * `c` tag, the position held for the whole bracket (§8.11.4 rule 1), and
   * for a virtual, skipped or broken event it is the position carried from
   * the action before it (§8.9 rules 2 and 5). Never a place inside a game.
   */
  coordHex: string
  position: Position
  plane: Plane
  /**
   * Where this event's own `C` tag points, when that is not the identity's
   * position: a game action's place inside the game, the declared `C` of a
   * skipped or broken event, the `C` an enter-virtual names when it is not
   * its `c`, and the `C` of any action at or after the first break, where
   * the identity is frozen. Absent for a base action and an exit on a valid
   * chain, whose `C` is the position, for an enter-virtual whose `C` is its
   * `c`, and for an event with no readable `C`.
   */
  declared?: Placed
  /** The `c` tag; null on a spawn, which comes from nowhere, and on an event that has none. */
  prevCoordHex: string | null
  /** `e` tags with the `genesis` and `previous` markers; null on a spawn. */
  genesisId: string | null
  previousId: string | null
  /** The `proof` tag; null on a spawn and on any action that carries no work. */
  proofHash: string | null
  /** The sector of `coordHex`: the `S` tag when the tag names the position, computed when it names a place in a game. */
  sector: string
  /** Enter-virtual only: the game, from its one `p` tag marked `game` (§8.11.1). */
  game?: { pubkey: string; relayHint: string }
  /** Enter-virtual only: the declared region. */
  region?: GameRegion
  /** Exit-virtual only: the `e` tag marked `entry`, the enter-virtual it closes. */
  entryId?: string
  /** Set by buildChain on an enter, its virtual actions and its exit: the id of the enter-virtual that opened the bracket. */
  bracketId?: string
  /**
   * Set by buildChain when this event breaks a chain rule this client can
   * see: the rule, in words. Every broken event has one, and so does an
   * action whose `c` is not where the chain stood. A verifier treats the
   * chain as invalid from the first event that has one (firstBreak).
   */
  breaks?: string
  /**
   * Set with `breaks` when the rule broken was introduced by a spec change:
   * the chain rules revision that introduced it (CHAIN_RULES_REVISION). Such
   * a chain may have been valid under the rules when it was made. Absent for
   * a rule every revision has had.
   */
  breakSince?: string
  /**
   * Set with `breaks` when the break is a known ONOSENDAI bug rather than
   * anything the identity did: `plane-bit` is a boarding whose `c` differs
   * from where the chain stood only in the plane bit, which ONOSENDAI signed
   * until PR #225 fixed it.
   */
  breakBug?: 'plane-bit'
  /** Hyperjump only (DECK-0001 v3 §5.2): the boarding and destination heights. */
  fromHeight?: number
  toHeight?: number
  /** Hyperjump only: the declared station set bound (as_of tag). */
  asOf?: number
  /** Hyperjump only: the sampled openings, as written in the `mp` tag. */
  mp?: string
  /**
   * Hyperjump and sidestep: the re-roll nonce of the `mn` tag (DECK-0001
   * §5.5, spec 6.10), exactly 16 lowercase hex. Absent on a ride or sidestep
   * published before the re-roll price, which stands only if exempt by id.
   */
  mn?: string
}

const HEX_64 = /^[0-9a-f]{64}$/

/** The names a bracket may not contain (§8.11.4 rule 3): every base and DECK-0001 action but spawn, which is a respawn wherever it appears. */
const BASE_INSIDE_BRACKET: ReadonlySet<string> = new Set(['hop', 'sidestep', 'enter-hyperspace', 'hyperjump', 'enter-virtual'])

function isRecognized(name: string): name is RecognizedAction {
  return (RECOGNIZED_ACTIONS as readonly string[]).includes(name)
}

/** A 64-hex coordinate as a place, or null when it is not one. */
function placeOf(coordHex: string | undefined, sector?: string): Placed | null {
  if (!coordHex || !HEX_64.test(coordHex)) return null
  const { x, y, z, plane } = coordToXyz(hexToCoord(coordHex))
  const position = { x, y, z }
  return { coordHex, position, plane, sector: sector ?? sectorTag(xyzToSectorId(x, y, z)) }
}

/** Whether a place lies inside a game's region (§8.11.1): same plane, and the same aligned cube on every axis. */
export function insideRegion(p: { position: Position; plane: Plane }, r: GameRegion): boolean {
  const h = BigInt(r.height)
  return p.plane === r.plane &&
    p.position.x >> h === r.base.x >> h &&
    p.position.y >> h === r.base.y >> h &&
    p.position.z >> h === r.base.z >> h
}

/** The `region` tag (§8.11.1): an aligned base and a canonical height in [0, 85], or null. */
function regionOf(ev: NostrEvent): GameRegion | null {
  const t = ev.tags.find((x) => x[0] === 'region')
  if (!t) return null
  const [, coordHex, hStr] = t
  if (!coordHex || !HEX_64.test(coordHex)) return null
  if (hStr === undefined || !/^(0|[1-9][0-9]*)$/.test(hStr)) return null
  const height = Number.parseInt(hStr, 10)
  if (height > 85) return null
  const { x, y, z, plane } = coordToXyz(hexToCoord(coordHex))
  const h = BigInt(height)
  const low = (1n << h) - 1n
  if ((x & low) !== 0n || (y & low) !== 0n || (z & low) !== 0n) return null
  return { coordHex, height, base: { x, y, z }, plane }
}

/** §10: per-axis sector tags plus the combined one, all base-10, no padding. */
export function sectorTags(p: Position): string[][] {
  const sid = xyzToSectorId(p.x, p.y, p.z)
  return [
    ['X', sid.sx.toString()],
    ['Y', sid.sy.toString()],
    ['Z', sid.sz.toString()],
    ['S', sectorTag(sid)],
  ]
}

/** 64-char lowercase hex for a position in a plane. */
export function positionHex(p: Position, plane: Plane): string {
  return coordToHex(xyzToCoord(p.x, p.y, p.z, plane))
}

/**
 * §8.3. The coordinate IS the pubkey, so there is nothing to choose: the only
 * input besides identity is when.
 */
export function spawnTemplate(pubkey: string, createdAt: number): EventTemplate {
  const at = coordToXyz(hexToCoord(pubkey))
  return {
    kind: ACTION_KIND,
    created_at: createdAt,
    content: '',
    tags: [['A', 'spawn'], ['C', pubkey], ...sectorTags(at)],
  }
}

export interface HopInput {
  createdAt: number
  genesisId: string
  previousId: string
  /** Taken from the previous event's `C` tag, never recomputed, so the chain
   * cannot disagree with itself about where it was. */
  prevCoordHex: string
  to: Position
  plane: Plane
  proofHash: string
}

/** §8.4. */
export function hopTemplate(i: HopInput): EventTemplate {
  return {
    kind: ACTION_KIND,
    created_at: i.createdAt,
    content: '',
    tags: [
      ['A', 'hop'],
      ['e', i.genesisId, '', 'genesis'],
      ['e', i.previousId, '', 'previous'],
      ['c', i.prevCoordHex],
      ['C', positionHex(i.to, i.plane)],
      ['proof', i.proofHash],
      ...sectorTags(i.to),
    ],
  }
}

export interface SidestepInput extends HopInput {
  /** Per-axis Merkle roots, 64 hex chars each. */
  merkleRoots: [string, string, string]
  /** Per-axis openings (spec 6.10, 8.5): the destination path then the eight
   * sampled paths, every sibling leaf first, one hex string per axis; an axis
   * that did not move contributes an empty string. */
  openings: [string, string, string]
  /** The re-roll nonce the samples were drawn under (spec 6.10), 16 lowercase hex. */
  mnHex: string
  lcaHeights: [number, number, number]
}

/** §8.5. */
export function sidestepTemplate(i: SidestepInput): EventTemplate {
  const hop = hopTemplate(i)
  const [hx, hy, hz] = i.lcaHeights
  return {
    ...hop,
    tags: [
      ['A', 'sidestep'],
      ...hop.tags.slice(1, 6),
      ['mr', i.merkleRoots.join(':')],
      ['mp', i.openings.join(':')],
      ['mn', i.mnHex],
      ['hx', String(hx)],
      ['hy', String(hy)],
      ['hz', String(hz)],
      ...sectorTags(i.to),
    ],
  }
}

export interface EnterHyperspaceInput {
  createdAt: number
  genesisId: string
  previousId: string
  /**
   * Where the identity is standing, exactly as the chain says it: the `C` of
   * the last recognized action (buildChain). An enter does not move (§3.3),
   * so this is both its `c` and its `C`. Taken as the hex itself, never
   * rebuilt from a position and a plane: the plane a client has lined up for
   * its next move can differ from the plane it stands in, and a boarding
   * rebuilt from that plane named a coordinate the chain never reached.
   */
  coordHex: string
  /** The §3.2 entry proof hash, computed over this same coordinate. */
  proofHash: string
}

/** DECK-0001 v3 §3.1: board the line from wherever you stand. c equals C. */
export function enterHyperspaceTemplate(i: EnterHyperspaceInput): EventTemplate {
  const here = i.coordHex
  const at = coordToXyz(hexToCoord(here))
  return {
    kind: ACTION_KIND,
    created_at: i.createdAt,
    content: '',
    tags: [
      ['A', 'enter-hyperspace'],
      ['e', i.genesisId, '', 'genesis'],
      ['e', i.previousId, '', 'previous'],
      ['c', here],
      ['C', here],
      ['proof', i.proofHash],
      ...sectorTags({ x: at.x, y: at.y, z: at.z }),
    ],
  }
}

export interface HyperjumpInput {
  createdAt: number
  genesisId: string
  previousId: string
  /** The identity's current coordinate (the enter coordinate, or the previous stop). */
  prevCoordHex: string
  /** The destination stop's coordinate, already a 64-hex coord256. */
  toCoordHex: string
  fromHeight: number
  toHeight: number
  /** The station set bound: the highest stop height considered when the
   * station was computed (DECK-0001 v3 §4.2 as amended). Travelers declare
   * the tip they synced to. */
  asOf?: number
  /** The ride's Merkle root, 64 hex. */
  rootHex: string
  /** The sampled openings. */
  mp: string
  /** The re-roll nonce (§5.5), 16 lowercase hex. */
  mnHex: string
}

/**
 * DECK-0001 v3 §5.2: ride the line from the station (or current stop) to a
 * stop. Never a zero-length ride (arkinox, 2026-10-07): a destination that is
 * the block the ride starts from throws, so no path can sign one.
 */
export function hyperjumpTemplate(i: HyperjumpInput): EventTemplate {
  if (i.fromHeight === i.toHeight) throw new Error(`a zero-length ride (block ${i.toHeight} to itself) is never signed: a ride always goes to a different block`)
  const at = coordToXyz(hexToCoord(i.toCoordHex))
  return {
    kind: ACTION_KIND,
    created_at: i.createdAt,
    content: '',
    tags: [
      ['A', 'hyperjump'],
      ['e', i.genesisId, '', 'genesis'],
      ['e', i.previousId, '', 'previous'],
      ['c', i.prevCoordHex],
      ['C', i.toCoordHex],
      ['from_height', String(i.fromHeight)],
      ['B', String(i.toHeight)],
      ...(i.asOf !== undefined ? [['as_of', String(i.asOf)]] : []),
      ['proof', i.rootHex],
      ['mp', i.mp],
      ['mn', i.mnHex],
      ...sectorTags({ x: at.x, y: at.y, z: at.z }),
    ],
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 ? '0' + hex : hex
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

function tag(ev: NostrEvent, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1]
}

function marked(ev: NostrEvent, marker: string): string | undefined {
  return ev.tags.find((t) => t[0] === 'e' && t[3] === marker)?.[1]
}

/**
 * Read a kind:3333 event as a recognized action, or refuse it.
 *
 * Strict about shape and silent about everything else: a malformed event is
 * dropped rather than thrown, because relays return whatever they were given
 * and one bad event must not take down a chain. Proofs are not checked here;
 * that is a verifier's job, and this client is a viewer. An action this
 * client does not recognize is refused here too, because on its own it says
 * nothing about where anyone is (spec §8.9); buildChain still follows the
 * links through it (actionLink).
 */
export function parseAction(ev: NostrEvent): ActionEvent | null {
  if (ev.kind !== ACTION_KIND) return null
  const type = tag(ev, 'A')
  if (type === undefined || !isRecognized(type)) return null
  const coordHex = tag(ev, 'C')
  if (!coordHex || !HEX_64.test(coordHex)) return null
  const sector = tag(ev, 'S')
  if (!sector) return null

  const { x, y, z, plane } = coordToXyz(hexToCoord(coordHex))
  const base = {
    id: ev.id,
    pubkey: ev.pubkey,
    createdAt: ev.created_at,
    name: type,
    role: 'base' as ChainRole,
    coordHex,
    position: { x, y, z },
    plane,
    sector,
  }

  if (type === 'spawn') {
    // §8.3: a spawn that is not at its own pubkey is not a spawn.
    if (coordHex !== ev.pubkey) return null
    return { ...base, type, prevCoordHex: null, genesisId: null, previousId: null, proofHash: null }
  }

  const c = tag(ev, 'c')
  const genesisId = marked(ev, 'genesis')
  const previousId = marked(ev, 'previous')
  if (!genesisId || !HEX_64.test(genesisId)) return null
  if (!previousId || !HEX_64.test(previousId)) return null

  if (type === 'exit-virtual') {
    // §8.11.3: the entry it closes; its `C` is the position restored. Its
    // `c` is where the game left off, which is the game's business and is
    // not read (arkinox, 2026-10-07, Q2): absent or malformed, it is null.
    const entryId = marked(ev, 'entry')
    if (!entryId || !HEX_64.test(entryId)) return null
    const prevCoordHex = c && HEX_64.test(c) ? c : null
    return { ...base, type, role: 'exit', prevCoordHex, genesisId, previousId, proofHash: null, entryId }
  }

  if (!c || !HEX_64.test(c)) return null
  const prevCoordHex = c
  const links = { prevCoordHex, genesisId, previousId }

  if (type === 'enter-virtual') {
    // §8.11.1: exactly one `p` tag marked `game`, holding a 32-byte lowercase
    // hex pubkey, and the region declared in the clear, aligned with a
    // canonical height. Both are checked for form only. Entering does not
    // move the identity (arkinox, 2026-10-07, Q2), so its `C` must equal its
    // `c`, and where it starts inside the game is the game's own tag. An
    // enter whose `C` is elsewhere still parses, so buildChain can say what
    // it broke; its position is the `c` either way, and the `C` it named is
    // kept in `declared`.
    const games = ev.tags.filter((t) => t[0] === 'p' && t[3] === 'game')
    if (games.length !== 1 || !HEX_64.test(games[0][1] ?? '')) return null
    const region = regionOf(ev)
    if (!region) return null
    const held = placeOf(prevCoordHex)!
    return {
      ...base,
      ...held,
      type,
      role: 'enter',
      ...(coordHex !== prevCoordHex ? { declared: placeOf(coordHex, sector)! } : {}),
      ...links,
      proofHash: null,
      game: { pubkey: games[0][1], relayHint: games[0][2] ?? '' },
      region,
    }
  }

  const proofHash = tag(ev, 'proof')
  if (!proofHash || !HEX_64.test(proofHash)) return null
  // The re-roll nonce: optional here, because events from before the price
  // carry none and stand if exempt, but never malformed.
  const mn = tag(ev, 'mn')
  if (mn !== undefined && !/^[0-9a-f]{16}$/.test(mn)) return null
  if (type === 'sidestep') {
    for (const t of ['mr', 'mp', 'hx', 'hy', 'hz']) if (tag(ev, t) === undefined) return null
  }
  if (type === 'enter-hyperspace') {
    // §3.1: an enter does not move; c must equal C.
    if (prevCoordHex !== coordHex) return null
  }
  if (type === 'hyperjump') {
    // §5.2: boarding and destination heights, and the openings tag (possibly empty).
    const fromStr = tag(ev, 'from_height')
    const toStr = tag(ev, 'B')
    if (fromStr === undefined || !/^\d+$/.test(fromStr)) return null
    if (toStr === undefined || !/^\d+$/.test(toStr)) return null
    if (tag(ev, 'mp') === undefined) return null
    const asOfStr = tag(ev, 'as_of')
    if (asOfStr !== undefined && !/^\d+$/.test(asOfStr)) return null
    return {
      ...base,
      type,
      ...links,
      proofHash,
      fromHeight: Number.parseInt(fromStr, 10),
      toHeight: Number.parseInt(toStr, 10),
      asOf: asOfStr !== undefined ? Number.parseInt(asOfStr, 10) : undefined,
      mp: tag(ev, 'mp'),
      ...(mn !== undefined ? { mn } : {}),
    }
  }
  if (type === 'sidestep' && mn !== undefined) return { ...base, type, ...links, proofHash, mn }
  return { ...base, type, ...links, proofHash }
}

/** The links of any kind:3333 event that can sit on a chain, whatever its action. */
export interface ActionLink {
  id: string
  pubkey: string
  createdAt: number
  /** The `A` tag as written. */
  name: string
  genesisId: string
  previousId: string
}

/**
 * The links of an event, recognized or not: what buildChain needs to follow
 * a chain through an action it cannot read (spec §8.9 rule 1). Null for
 * another kind, a spawn (which names no previous event, wherever it is
 * published), an event with no `A` tag, and one without both `e` links.
 */
export function actionLink(ev: NostrEvent): ActionLink | null {
  if (ev.kind !== ACTION_KIND) return null
  const name = tag(ev, 'A')
  if (!name || name === 'spawn') return null
  const genesisId = marked(ev, 'genesis')
  const previousId = marked(ev, 'previous')
  if (!genesisId || !HEX_64.test(genesisId)) return null
  if (!previousId || !HEX_64.test(previousId)) return null
  return { id: ev.id, pubkey: ev.pubkey, createdAt: ev.created_at, name, genesisId, previousId }
}

/** Newest first, ties broken by id, the NIP-01 ordering. */
function newer(a: { createdAt: number; id: string }, b: { createdAt: number; id: string }): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/**
 * The newest spawn among `events` (§8.7.3 rule 1), valid or not: every
 * kind:3333 event whose `A` tag says spawn, newest first, ties to the
 * larger id (NIP-01). An invalid newest spawn still wins, and there is no
 * fallback to an older one (arkinox, 2026-10-07, Q7): its chain is dead from
 * the spawn, and buildChain says so rather than quietly reading an older
 * chain the identity has already left.
 */
export function newestSpawn(events: NostrEvent[]): NostrEvent | null {
  let best: NostrEvent | null = null
  for (const e of events) {
    if (e.kind !== ACTION_KIND || tag(e, 'A') !== 'spawn') continue
    if (!best || newer({ createdAt: e.created_at, id: e.id }, { createdAt: best.created_at, id: best.id }) < 0) best = e
  }
  return best
}

/**
 * A spawn as the first entry of its chain: as parsed when it is a valid
 * spawn, and otherwise BROKEN, standing at the identity's spawn coordinate,
 * the place its public key decodes to, because no event of the chain is
 * valid (Q7). Null only for an author that is not a 32-byte key, which has
 * no coordinate to stand at.
 */
function spawnEntry(ev: NostrEvent | null): ActionEvent | null {
  if (!ev) return null
  const parsed = parseAction(ev)
  if (parsed && parsed.type === 'spawn') return parsed
  const home = placeOf(ev.pubkey)
  if (!home) return null
  const C = tag(ev, 'C')
  const claimed = placeOf(C, tag(ev, 'S'))
  const breaks = claimed && C !== ev.pubkey
    ? `a spawn whose C (${tail(C!)}) is not the coordinate your public key decodes to (${tail(ev.pubkey)}). A spawn always places you at your own key's coordinate, never anywhere else (spec §8.3)`
    : 'a spawn that is missing a tag the chain rules read (its C or its S tag), or has one malformed (spec §8.3)'
  return {
    id: ev.id,
    pubkey: ev.pubkey,
    createdAt: ev.created_at,
    type: 'other',
    name: 'spawn',
    role: 'broken',
    ...home,
    ...(claimed && claimed.coordHex !== home.coordHex ? { declared: claimed } : {}),
    prevCoordHex: null,
    genesisId: null,
    previousId: null,
    proofHash: null,
    breaks,
  }
}

/**
 * Reassemble one pubkey's active chain from whatever the relay handed back.
 *
 * Spec §8.7.3: the newest spawn wins, and only events whose genesis names it
 * can be part of the chain; events that name another spawn are history, even
 * if their `previous` link would fit. From that spawn the chain is followed
 * forward through `previous` links, and at a fork (two events naming the
 * same predecessor) the older branch continues, a tie going to the smaller
 * id, so a later attempt to rewrite cannot displace what was there first.
 *
 * The links are followed through every event, recognized or not (§8.9 rule
 * 1): an action this client does not recognize is skipped, never a place
 * where the chain stops, and a game's actions inside a bracket are followed
 * like any other (§8.11). What each event means for the identity's position
 * is decided on the way (ChainRole): every entry's `coordHex`, `position`
 * and `plane` are where the identity is in cyberspace once it stands, so the
 * last entry's are the identity's position whatever the chain ends on (§8.9
 * rule 5, §8.11.4 rule 7), and the last entry's id is what the next action
 * names as its `previous`.
 *
 * From the first event that breaks a rule on, the position stops following
 * the events: every entry from there stands where the entry before the
 * first break left the identity, its last valid position, and what each one
 * claimed is in `declared` (arkinox, 2026-10-07, Q3). The links are still
 * followed to the end, so the rows and the head are what they are.
 *
 * Returns the spawn alone when nothing follows it, and nothing when there is
 * no spawn at all: a hop without a genesis is not a position.
 */
export function buildChain(events: NostrEvent[]): ActionEvent[] {
  // Only the spawns are read here; every other event is read once, in place.
  const spawn = spawnEntry(newestSpawn(events))
  if (!spawn) return []

  const byPrev = new Map<string, Array<{ link: ActionLink; ev: NostrEvent }>>()
  for (const ev of events) {
    const link = actionLink(ev)
    if (!link || link.genesisId !== spawn.id) continue
    const list = byPrev.get(link.previousId) ?? []
    list.push({ link, ev })
    byPrev.set(link.previousId, list)
  }

  const chain: ActionEvent[] = [spawn]
  const seen = new Set([spawn.id])
  let head: ActionEvent = spawn
  /** The enter-virtual of the bracket open at the head, if one is. */
  let open: ActionEvent | null = null
  /** Where the identity stands once the chain has broken: its last valid position (Q3). */
  let frozenAt: Placed | null = spawn.breaks ? { coordHex: spawn.coordHex, position: spawn.position, plane: spawn.plane, sector: spawn.sector } : null
  for (;;) {
    const next = (byPrev.get(head.id) ?? [])
      .filter((c) => !seen.has(c.link.id))
      .sort((a, b) => -newer(a.link, b.link))[0]
    if (!next) break
    let entry = placeInChain(next.ev, next.link, head, open)
    // DECK-0001 §4.3, read through games and skipped actions (§8.9 rule 4,
    // §8.11.4 rule 8): a ride follows a boarding or another ride.
    if (entry.type === 'hyperjump' && !entry.breaks) {
      const stood = lookBack(chain, chain.length)
      if (stood?.type !== 'enter-hyperspace' && stood?.type !== 'hyperjump') {
        entry = { ...entry, breaks: 'a ride (hyperjump) that does not follow a boarding or another ride: a ride may only come straight after an enter-hyperspace or a hyperjump (DECK-0001 §4.3)' }
      }
    }
    if (entry.breaks && !frozenAt) frozenAt = { coordHex: head.coordHex, position: head.position, plane: head.plane, sector: head.sector }
    if (entry.role === 'enter') open = entry
    else if (entry.role === 'exit') open = null
    // The rules keep reading each event against what the one before it
    // claimed (`head`), so a row after the first break is marked only for
    // what it did itself; only where the identity stands is frozen.
    chain.push(frozenAt ? standingAt(entry, frozenAt) : entry)
    seen.add(entry.id)
    head = entry
  }
  return chain
}

/**
 * An entry at or after the first break, standing where the chain froze: its
 * position is the last valid one, and the place it claimed, if it claimed
 * one somewhere else, is kept in `declared`.
 */
function standingAt(entry: ActionEvent, at: Placed): ActionEvent {
  if (entry.coordHex === at.coordHex) return entry
  const claimed = entry.declared ?? { coordHex: entry.coordHex, position: entry.position, plane: entry.plane, sector: entry.sector }
  return { ...entry, ...at, declared: claimed }
}

/** The last six hex digits of a coordinate, where a plane bit or a small move shows. */
const tail = (hex: string): string => `…${hex.slice(-6)}`

/** The words for an action that starts somewhere other than where the chain stood. */
function startsElsewhere(name: string, c: string | null, stood: string): string {
  return `it starts from ${c ? tail(c) : 'nowhere'}, but the action before it left you at ${tail(stood)}. Every ${name} has to start exactly where the chain stood, or it would be a teleport (spec §8.9 rule 2, §8.11.5)`
}

/** Whether two coordinates name the same x, y and z in different planes. */
function planeBitOnly(a: string, b: string): boolean {
  const p = coordToXyz(hexToCoord(a))
  const q = coordToXyz(hexToCoord(b))
  return p.plane !== q.plane && p.x === q.x && p.y === q.y && p.z === q.z
}

/** A break of a rule introduced by this revision (CHAIN_RULES_REVISION): the chain may have been valid when it was made. */
const NEW_RULE = { breakSince: CHAIN_RULES_REVISION }

/**
 * One event's entry in the chain, given the entry before it and the bracket
 * open at that point: §8.9 for an action outside a bracket, §8.11.4 inside.
 */
function placeInChain(ev: NostrEvent, link: ActionLink, before: ActionEvent, open: ActionEvent | null): ActionEvent {
  const parsed = parseAction(ev)
  const carried: Placed = { coordHex: before.coordHex, position: before.position, plane: before.plane, sector: before.sector }
  const declared = placeOf(tag(ev, 'C'), tag(ev, 'S'))
  const prev = tag(ev, 'c')
  const prevCoordHex = prev && HEX_64.test(prev) ? prev : null
  const unread = (role: ChainRole, breaks?: string, bracketId?: string, since?: string): ActionEvent => ({
    id: link.id,
    pubkey: link.pubkey,
    createdAt: link.createdAt,
    type: 'other',
    name: link.name,
    role,
    ...carried,
    ...(declared ? { declared } : {}),
    prevCoordHex,
    genesisId: link.genesisId,
    previousId: link.previousId,
    proofHash: null,
    ...(bracketId ? { bracketId } : {}),
    ...(breaks ? { breaks } : {}),
    ...(breaks && since ? { breakSince: since } : {}),
  })

  if (open) {
    // Inside a bracket (§8.11.4), which is opaque to the base protocol
    // (arkinox, 2026-10-07, Q2): only the links and the names are read. An
    // exit closes it only when it names this bracket's entry (rule 6) and
    // puts the identity back where it entered (rule 2), whatever its `c`; a
    // base action is invalid here (rule 3); every other name is the game's
    // own move, which never moves the identity (rule 1) and whose `c` and
    // `C`, if it has them, are the game's to check. A broken exit leaves the
    // bracket open. Every bracket rule is new in this revision.
    if (link.name === 'exit-virtual') {
      if (parsed?.type === 'exit-virtual' && parsed.entryId === open.id && parsed.coordHex === open.coordHex) {
        return { ...parsed, role: 'exit', bracketId: open.id }
      }
      return unread('broken', parsed?.type === 'exit-virtual'
        ? 'an exit from a game that either names a different entry than the game you are in, or does not put you back exactly where you entered the game (spec §8.11.4 rules 2 and 6)'
        : 'an exit from a game that is missing a tag the chain rules read, or has one malformed', open.id, CHAIN_RULES_REVISION)
    }
    if (BASE_INSIDE_BRACKET.has(link.name)) {
      return unread('broken', `a ${link.name} signed while you were inside a game. Inside a game only the game's own actions may stand, never a move through cyberspace (spec §8.11.4 rule 3)`, open.id, CHAIN_RULES_REVISION)
    }
    return unread('virtual', undefined, open.id)
  }
  if (parsed && parsed.type === 'enter-virtual') {
    // Into a bracket: from where the chain stood, and without moving.
    const entry: ActionEvent = { ...parsed, bracketId: parsed.id }
    if (parsed.prevCoordHex !== before.coordHex) return { ...entry, breaks: startsElsewhere('entry into a game', parsed.prevCoordHex, before.coordHex), ...NEW_RULE }
    if (parsed.declared) {
      return { ...entry, breaks: `an entry into a game whose C (${tail(parsed.declared.coordHex)}) is not its own c (${tail(parsed.coordHex)}). Entering a game does not move you: you stay exactly where you were, and where you start inside the game is the game's own business, carried in a tag of its own (spec §8.11.1 as refined 2026-10-07)`, ...NEW_RULE }
    }
    return entry
  }
  if (parsed && parsed.type === 'exit-virtual') return unread('broken', 'an exit from a game when no game was open (spec §8.11.4 rule 6)', undefined, CHAIN_RULES_REVISION)
  if (parsed) {
    if (parsed.prevCoordHex !== before.coordHex) {
      // The 2026-10-06 boarding: ONOSENDAI rebuilt a boarding's coordinate
      // from the plane lined up for the next move, so it named the right x,
      // y and z in the other plane. Fixed in PR #225; said so on the break.
      const bug = parsed.type === 'enter-hyperspace' && planeBitOnly(parsed.prevCoordHex!, before.coordHex)
      return { ...parsed, breaks: startsElsewhere(parsed.type === 'enter-hyperspace' ? 'boarding' : parsed.type, parsed.prevCoordHex, before.coordHex), ...(bug ? { breakBug: 'plane-bit' as const } : {}) }
    }
    if (parsed.type === 'hyperjump' && parsed.fromHeight === parsed.toHeight) {
      return { ...parsed, breaks: `a zero-length ride: it rides from block ${parsed.fromHeight} to block ${parsed.toHeight}, the same block, so it goes nowhere. A ride must always go to a different block than the one it starts from (DECK-0001 §5.6 as amended 2026-10-07)`, ...NEW_RULE }
    }
    return parsed
  }
  // A recognized name that would not parse is a malformed action, not one
  // this client does not know; a name it does not recognize is skipped and
  // the position carried across it (§8.9 rules 2 and 5).
  return isRecognized(link.name)
    ? unread('broken', `a ${link.name} that is missing a tag the chain rules read, or has one malformed`, undefined,
      link.name === 'enter-virtual' || link.name === 'exit-virtual' ? CHAIN_RULES_REVISION : undefined)
    : unread('skipped')
}

/**
 * The first event of `chain` that breaks a rule this client can see, and
 * where it is: a verifier treats the chain as invalid from there. Null when
 * the chain shows no such event. `lastValid` is the event before it, whose
 * position is where the identity stands, frozen, until a respawn (Q3); null
 * when the spawn itself is invalid (Q7), and the identity stands at its
 * spawn coordinate, which is that broken spawn's position.
 */
export function firstBreak(chain: ActionEvent[]): { index: number; action: ActionEvent; lastValid: ActionEvent | null } | null {
  const index = chain.findIndex((a) => a.breaks !== undefined)
  return index < 0 ? null : { index, action: chain[index], lastValid: index > 0 ? chain[index - 1] : null }
}

/**
 * The hole nearest the head in the chain a spawn starts, as far as `events`
 * hold it: of the events naming that spawn as their genesis, the newest one
 * whose `previous` is neither the spawn nor in hand. Null when every link is
 * in hand. A relay returns the newest events first and stops at its own
 * limit, and two relays can each hold a different stretch, so a hole is
 * where the next page has to start: at that event's second (`until`,
 * inclusive), or, when that second alone holds more than a page, by asking
 * for the missing event itself (`missingId`).
 */
export function chainGap(events: NostrEvent[], spawnId: string): { until: number; missingId: string } | null {
  const ids = new Set(events.map((e) => e.id))
  let gap: ActionLink | null = null
  for (const ev of events) {
    const l = actionLink(ev)
    if (!l || l.genesisId !== spawnId || l.previousId === spawnId || ids.has(l.previousId)) continue
    if (!gap || l.createdAt > gap.createdAt || (l.createdAt === gap.createdAt && l.id > gap.id)) gap = l
  }
  return gap ? { until: gap.createdAt, missingId: gap.previousId } : null
}

/** Where a chain currently puts its avatar, and what the next action names as its `previous`. */
export function chainHead(chain: ActionEvent[]): ActionEvent | null {
  return chain.length ? chain[chain.length - 1] : null
}

/**
 * The enter-virtual of the bracket open at the end of `chain` (up to and
 * including index `at` when given), or null when the identity is not inside
 * a game there. A chain may end inside a bracket (§8.11.4 rule 7).
 */
export function openBracket(chain: ActionEvent[], at = chain.length - 1): ActionEvent | null {
  const a = chain[at]
  if (!a || (a.role !== 'enter' && a.role !== 'virtual' && !(a.role === 'broken' && a.bracketId))) return null
  return chain.find((e) => e.id === a.bracketId && e.role === 'enter') ?? null
}

/**
 * The action that rules looking back from index `at` see (spec §8.9 rule 4,
 * §8.11.4 rule 8): the nearest recognized action before it, with skipped
 * and broken events passed over and a closed bracket standing for the
 * action before its enter-virtual. Inside an open bracket it is that
 * bracket's enter-virtual. Null when nothing stands before it.
 *
 * Only for rules about which action came before. Work is still seeded by
 * the actual previous event, which is always `chain[at - 1]`.
 */
export function lookBack(chain: ActionEvent[], at: number): ActionEvent | null {
  let j = Math.min(at, chain.length) - 1
  while (j >= 0) {
    const a = chain[j]
    if (a.role === 'skipped' || (a.role === 'broken' && !a.bracketId)) { j--; continue }
    if (a.role === 'exit' || a.role === 'virtual' || a.role === 'broken') {
      const enter = chain.findIndex((e) => e.id === a.bracketId)
      if (enter < 0) return null
      if (a.role === 'exit') { j = enter - 1; continue }
      return chain[enter]
    }
    return a
  }
  return null
}

/**
 * The one word a row's styling keys on: the action for a base action, the
 * role otherwise, and `broken` for anything that breaks a rule.
 */
export function actionKind(a: Pick<ActionEvent, 'type' | 'role' | 'breaks'>): string {
  if (a.breaks !== undefined || a.role === 'broken') return 'broken'
  return a.role === 'base' ? a.type : a.role
}

/** The longest stretch of a name chosen by someone else that a label shows. */
const NAME_SHOWN = 20

/**
 * Short words for an action's row: the action for a recognized one, and what
 * it is to this client otherwise, with the name it was given. A game or an
 * extension chooses its own names, so they are shown cut to NAME_SHOWN; the
 * row's title carries the whole name.
 */
export function actionLabel(a: Pick<ActionEvent, 'type' | 'name' | 'role' | 'breaks'>): string {
  const name = a.name.length > NAME_SHOWN ? `${a.name.slice(0, NAME_SHOWN)}…` : a.name
  // An action that keeps its role but breaks a rule (its c is not where the
  // chain stood) still says what it is, after the word that matters.
  if (a.breaks !== undefined && a.role !== 'broken') return `BROKEN · ${actionLabel({ ...a, breaks: undefined })}`
  switch (a.role) {
    case 'enter': return 'ENTER GAME'
    case 'exit': return 'EXIT GAME'
    case 'virtual': return `GAME · ${name.toUpperCase()}`
    case 'skipped': return `SKIPPED · ${name.toUpperCase()}`
    case 'broken': return `BROKEN · ${name.toUpperCase()}`
    default: return a.type === 'enter-hyperspace' ? 'ENTER' : a.type.toUpperCase()
  }
}
