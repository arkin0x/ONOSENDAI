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
import { CLIENT_NAME } from './client'

/** §8.1: every movement action, spawn included, is this one kind. */
export const ACTION_KIND = 3333

/**
 * The chain rules this client implements (spec §8.12), as the spec states
 * them at commit 1bf5694 (spec PR #48, merged 2026-10-08T09:52:23Z). Spec PR
 * #46 (912f3d7, merged 2026-10-08T04:04:00Z, which is 23:04 on 2026-10-07 at
 * UTC-5, the time zone this file names days in) wrote arkinox's rulings of
 * 2026-10-07 and his first clarifications into this revision: no zero-length
 * ride, a virtual bracket opaque to the base protocol, exactly one A tag on
 * every event, and sector tags that must agree with the coordinate, each
 * carried exactly once. Spec PR #48 wrote his second round of 2026-10-08: a
 * fork is fatal, any A tag equal to spawn makes a spawn and a spawn is never
 * a link, every tag a chain rule reads appears exactly once with a value,
 * and the network is Bitcoin mainnet, so a net tag is never read. Every spec
 * section cited in this file is numbered as of 1bf5694. A rule this revision
 * introduced is marked on the break (`breakSince`), because a chain made
 * before the rule took effect was valid when it was made, and the person
 * whose chain it is deserves to be told so.
 */
export const CHAIN_RULES_REVISION = '2026-09-28-virtual-brackets'

/**
 * When a chain rule took effect, and how a break of it is told. An event
 * signed before `effectiveAt` was valid when it was signed, and is owed an
 * apology; one signed after it is not (lib/chainBreak.ts).
 */
export interface RuleChange {
  /** The revision the rule is folded into (CHAIN_RULES_REVISION). */
  revision: string
  /** The day it took effect, as the notice says it: the spec merge or arkinox's ruling. */
  since: string
  /**
   * How it took effect. `spec-44`: spec PR #44 merging. `ruling`: arkinox's
   * ruling of that day, in effect from the ruling (`spec` says when the spec
   * caught up, if it has). `spec-46`: spec PR #46 merging, for the
   * clarifications arkinox gave while it was open (the evening of
   * 2026-10-07 at UTC-5; the spec dates them 2026-10-08, in UTC).
   */
  by: 'spec-44' | 'ruling' | 'spec-46'
  /** For a ruling the spec has since carried: how it got there, in words ("written into the spec by PR #46 later that day"). */
  spec?: string
  /** Unix seconds when it took effect. */
  effectiveAt: number
  /** `rule`: a new chain rule. `validation`: a check the rules gained on what was already there. */
  kind: 'rule' | 'validation'
}

/** The virtual bracket rules, which took effect when spec PR #44 merged (2026-10-06T21:38:51Z). */
export const BRACKET_RULES: RuleChange = {
  revision: CHAIN_RULES_REVISION, since: '2026-10-06', by: 'spec-44', effectiveAt: Date.parse('2026-10-06T21:38:51Z') / 1000, kind: 'rule',
}

/**
 * arkinox's rulings of 2026-10-07: no zero-length ride (Q1, DECK-0001 §5.6)
 * and an enter-virtual that does not move (Q2, spec §8.11.1). They took
 * effect when he made them, from the start of that day in his time zone
 * (00:00 at UTC-5), so nothing signed on the day a rule was made is told it
 * was valid when signed. Spec PR #46 wrote them into the spec late that day
 * without moving that date: the spec's own revision table says they were
 * folded in on 2026-10-07 (spec §8.12).
 */
export const RULINGS_2026_10_07: RuleChange = {
  revision: CHAIN_RULES_REVISION, since: '2026-10-07', by: 'ruling', spec: 'written into the spec by PR #46 later that day', effectiveAt: Date.parse('2026-10-07T05:00:00Z') / 1000, kind: 'rule',
}

/** Sector tags must be present and agree with the coordinate (Q9, spec §10): validation the rules gained by the 2026-10-07 ruling. */
export const SECTOR_TAG_RULE: RuleChange = { ...RULINGS_2026_10_07, kind: 'validation' }

/** Exactly one A tag on every event of a chain (Q5, spec §8.8): validation the rules gained by the 2026-10-07 ruling. */
export const ONE_A_TAG_RULE: RuleChange = { ...RULINGS_2026_10_07, kind: 'validation' }

/**
 * Each sector tag exactly once (spec §10): one of the clarifications arkinox
 * gave while spec PR #46 was open, which took effect when it merged at
 * 2026-10-08T04:04:00Z. Before that nothing said a second copy of a sector
 * tag broke anything, so an event signed earlier is owed the apology. The
 * day is named in arkinox's time zone, as RULINGS_2026_10_07 names its day:
 * at UTC-5 the merge was 23:04 on 2026-10-07. (The spec's revision table
 * calls it 2026-10-08, the UTC date.)
 */
export const DUPLICATE_SECTOR_RULE: RuleChange = {
  revision: CHAIN_RULES_REVISION, since: '2026-10-07', by: 'spec-46', effectiveAt: Date.parse('2026-10-08T04:04:00Z') / 1000, kind: 'validation',
}

/**
 * arkinox's rulings of 2026-10-08, on the points the reference verifiers
 * left open: a fork ends the whole chain, every tag a chain rule reads
 * appears exactly once with a value (an empty A tag included), and every
 * chain event carries exactly one e genesis and one e previous (an exit one
 * e entry). In effect from the start of that day at UTC-5, like the rulings
 * of 2026-10-07. Spec PR #48 wrote them into the spec at 09:52 UTC that day
 * (1bf5694), without moving the date.
 */
export const RULINGS_2026_10_08: RuleChange = {
  revision: CHAIN_RULES_REVISION, since: '2026-10-08', by: 'ruling', spec: 'written into the spec by PR #48 that day', effectiveAt: Date.parse('2026-10-08T05:00:00Z') / 1000, kind: 'rule',
}

/** A fork ends the whole chain (spec §8.7.3 rule 4, 2026-10-08 ruling): a new rule, replacing the earlier rule that one branch of a fork continued it. */
export const FORK_RULE: RuleChange = RULINGS_2026_10_08

/** Every tag a chain rule reads exactly once, with a value (spec §8.8, 2026-10-08 ruling): validation the rules gained. */
export const TAGS_ONCE_RULE: RuleChange = { ...RULINGS_2026_10_08, kind: 'validation' }

/**
 * When ONOSENDAI stopped signing the plane-bit boarding: PR #225 merged,
 * and the site deployed it, at 2026-10-07T02:18:58Z. A plane-bit boarding
 * signed after that is not this bug.
 */
export const PLANE_BIT_FIX_AT = Date.parse('2026-10-07T02:18:58Z') / 1000

/**
 * Until when a plane-bit boarding is apologized for as ONOSENDAI's: a day
 * past the fix, because a tab opened before the deploy keeps running the old
 * bundle until it is reloaded (final review of #227).
 */
export const PLANE_BIT_APOLOGY_UNTIL = PLANE_BIT_FIX_AT + 24 * 60 * 60

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
 * | broken | a recognized name out of place or malformed: a base action inside a bracket (rule 3), an exit with no bracket or the wrong entry (rule 6); or any event with no `A` tag (§8.8) | no |
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
 * a zero-length ride, whose destination block is the block it started
 * from (abolished, arkinox 2026-10-07, Q1), an event with two or more `A`
 * tags (§8.8), wherever it stands, and a base action whose sector tags are
 * missing, doubled or wrong (§10).
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
   * Set with `breaks` when the rule broken was introduced by a spec change or
   * a ruling: when it took effect and how (RuleChange). An event signed
   * before then was valid when it was signed. Absent for a rule every
   * revision has had.
   */
  breakSince?: RuleChange
  /**
   * Set with `breaks` when the break may be ONOSENDAI's doing rather than
   * anything the identity did. `plane-bit`: a boarding whose `c` differs from
   * where the chain stood only in the plane bit, which ONOSENDAI signed until
   * PR #225 fixed it. `zero-length-offered`: a zero-length ride carrying
   * ONOSENDAI's client tag, which ONOSENDAI offered until the 2026-10-07
   * ruling reached it. lib/chainBreak.ts decides which of them is owed an
   * apology, by when each was signed.
   */
  breakBug?: 'plane-bit' | 'zero-length-offered'
  /**
   * Set on the spawn, with `breaks`, when the chain forks (2026-10-08
   * ruling): the event that two or more actions name as their previous, and
   * those actions, oldest first. A fork ends the whole chain, so the spawn
   * carries it and the identity stands at its spawn coordinate.
   */
  fork?: { previousId: string; branchIds: string[] }
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

/**
 * The names a bracket may not contain (spec §8.11.4 rule 3): every action of
 * the base protocol and of a mandatory DECK that this client implements
 * (Q8: rule 3 names a category, not a list), which at this revision are
 * hop, sidestep, enter-hyperspace, hyperjump and enter-virtual. Spawn is
 * left out because it is a respawn wherever it appears, and exit-virtual
 * because it closes the bracket (rule 6). Drawn from RECOGNIZED_ACTIONS, so
 * a mandatory DECK added there is reserved inside games at once.
 */
const BASE_INSIDE_BRACKET: ReadonlySet<string> = new Set(RECOGNIZED_ACTIONS.filter((n) => n !== 'spawn' && n !== 'exit-virtual'))

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

/** The first tag of that name's value. A rule that needs a tag exactly once also asks tagCount. */
function tag(ev: NostrEvent, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1]
}

/** How many tags of that name an event carries. */
function tagCount(ev: NostrEvent, name: string): number {
  let n = 0
  for (const t of ev.tags) if (t[0] === name) n++
  return n
}

/** Whether an event carries `["A", "spawn"]`, which makes it a spawn (spec §8.7.3 rule 1), whatever else it carries. */
function carriesSpawn(ev: NostrEvent): boolean {
  return ev.tags.some((t) => t[0] === 'A' && t[1] === 'spawn')
}

/** The fork rule, as a fork's break and the broken-chain notice say it (spec §8.7.3 rule 4). */
export const FORK_RULE_WORDS = 'A chain may only ever have one next action after each event, so a fork ends the whole chain, whichever branch came first or is valid, and you stand at your spawn coordinate (spec §8.7.3 rule 4, per the 2026-10-08 ruling)'

/** "two", "three": how many, in words, up to five. */
const countWord = (n: number): string => ['no', 'one', 'two', 'three', 'four', 'five'][n] ?? String(n)

/**
 * Why an event breaks the one-A-tag rule, or null when it carries exactly one
 * (Q5, spec §8.8). Asked of every event on a chain: base actions, skipped
 * actions (§8.9), and every event inside a bracket (§8.11.4 rule 4).
 */
function aTagsWrong(ev: NostrEvent): { breaks: string; since: RuleChange } | null {
  const names = ev.tags.filter((t) => t[0] === 'A').map((t) => t[1] ?? '')
  if (names.length === 1) {
    if (names[0] !== '') return null
    // A bare ["A"] or ["A", ""] is an A tag, and names nothing (2026-10-08 ruling).
    return { since: TAGS_ONCE_RULE, breaks: 'an event whose A tag is empty, so it names no action at all. The A tag has to say what the event does, and an empty one counts as an A tag that says nothing (spec §8.8, per the 2026-10-08 ruling)' }
  }
  if (names.length === 0) return { since: ONE_A_TAG_RULE, breaks: 'an event on your chain with no A tag, so it names no action at all. Every event on a chain has to carry exactly one A tag, the name of what it does (spec §8.8)' }
  const said = names.map((n) => (n.length > 20 ? `${n.slice(0, 20)}…` : n)).join(', ')
  return { since: ONE_A_TAG_RULE, breaks: `an event carrying ${countWord(names.length)} A tags (${said}). Every event on a chain has to carry exactly one A tag, even when the copies agree, so that every reader agrees on what it does (spec §8.8)` }
}

/** The links every chain event but a spawn is read for: one e genesis and one e previous. */
const LINK_TAGS = ['e:genesis', 'e:previous'] as const

/**
 * The tags the chain rules read on each recognized action, beyond the A tag
 * and the sector tags, which have rules of their own: `e:<marker>` for an e
 * tag with that marker. Each may appear at most once (2026-10-08 ruling);
 * whether a required one is there, with a well-formed value, is parseAction's
 * to say. Inside a bracket and on a skipped action only the links are read
 * (`links`), and an exit's c is never read, so it is not here.
 */
const READ_TAGS: Record<RecognizedAction | 'links', readonly string[]> = {
  links: LINK_TAGS,
  spawn: ['C'],
  hop: [...LINK_TAGS, 'c', 'C', 'proof'],
  sidestep: [...LINK_TAGS, 'c', 'C', 'proof', 'mr', 'mp', 'mn', 'hx', 'hy', 'hz'],
  'enter-hyperspace': [...LINK_TAGS, 'c', 'C', 'proof'],
  hyperjump: [...LINK_TAGS, 'c', 'C', 'from_height', 'B', 'proof', 'mp', 'mn'],
  'enter-virtual': [...LINK_TAGS, 'c', 'C', 'region'],
  'exit-virtual': [...LINK_TAGS, 'C', 'e:entry'],
}

/** How many tags an event carries under a READ_TAGS name. */
function readCount(ev: NostrEvent, key: string): number {
  if (!key.startsWith('e:')) return tagCount(ev, key)
  const marker = key.slice(2)
  let n = 0
  for (const t of ev.tags) if (t[0] === 'e' && t[3] === marker) n++
  return n
}

/**
 * Why an event carries a tag the chain rules read more than once, or null
 * (2026-10-08 ruling): every such tag appears exactly once, and a second
 * copy is invalid even when it agrees with the first. Resolution still
 * follows the first copy of each link, so the event is on the chain, and
 * breaks it there. Tags the rules do not read are free.
 */
function readTagsWrong(ev: NostrEvent, read: RecognizedAction | 'links', label: string): string | null {
  const doubled = READ_TAGS[read].map((k) => [k, readCount(ev, k)] as const).filter(([, n]) => n > 1)
  if (doubled.length === 0) return null
  const said = doubled.map(([k, n]) => `${countWord(n)} ${k.startsWith('e:') ? `e tags marked ${k.slice(2)}` : `${k} tags`}`).join(' and ')
  return `${an(label)} carrying ${said}. Every tag the chain rules read has to appear exactly once, even when the copies agree, so that every reader reads the same thing (spec §8.8, per the 2026-10-08 ruling)`
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

  const { x, y, z, plane } = coordToXyz(hexToCoord(coordHex))
  // The sector tags are read by buildChain, which breaks an event whose tags
  // are missing or disagree with its C (Q9); here only what they say is
  // kept, computed when the tag is not there.
  const sector = tag(ev, 'S') ?? sectorTag(xyzToSectorId(x, y, z))
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
    // §8.5 as spec PR #48 reads it: three colon-joined roots, openings that
    // are there, and base-10 heights.
    if (!/^[0-9a-f]{64}(:[0-9a-f]{64}){2}$/.test(tag(ev, 'mr') ?? '')) return null
    if (!tag(ev, 'mp')) return null
    for (const t of ['hx', 'hy', 'hz']) if (!/^\d+$/.test(tag(ev, t) ?? '')) return null
  }
  if (type === 'enter-hyperspace') {
    // §3.1: an enter does not move; c must equal C.
    if (prevCoordHex !== coordHex) return null
  }
  if (type === 'hyperjump') {
    // §5.2: boarding and destination heights. The openings are required
    // and must not be empty, but buildChain says so only after the
    // zero-length check (spec PR #48 orders a ride's checks: from_height and
    // B, then zero-length, then the rest), so a zero-length ride is told as
    // one. as_of is read only on the first ride after boarding (rideBreak).
    const fromStr = tag(ev, 'from_height')
    const toStr = tag(ev, 'B')
    if (fromStr === undefined || !/^\d+$/.test(fromStr)) return null
    if (toStr === undefined || !/^\d+$/.test(toStr)) return null
    if (tag(ev, 'mp') === undefined) return null
    const asOfStr = tag(ev, 'as_of')
    return {
      ...base,
      type,
      ...links,
      proofHash,
      fromHeight: Number.parseInt(fromStr, 10),
      toHeight: Number.parseInt(toStr, 10),
      asOf: asOfStr !== undefined && /^\d+$/.test(asOfStr) ? Number.parseInt(asOfStr, 10) : undefined,
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
  /** The `A` tag as written: the first when there are several, and empty when there is none (both break the chain, §8.8). */
  name: string
  genesisId: string
  previousId: string
}

/**
 * The links of an event, recognized or not: what buildChain needs to follow
 * a chain through an action it cannot read (spec §8.9 rule 1). Null for
 * another kind, a spawn (which names no previous event, wherever it is
 * published), and one without both `e` links.
 *
 * An event with no `A` tag, or with several, still has its links read:
 * resolution follows the chain by links alone, before any tag is checked
 * (spec §8.7.3, Validity and position), so such an event can continue a
 * chain, or make a fork beside another event, and it is then where the
 * chain stops being valid (§8.8), not a gap the chain quietly ends at.
 */
export function actionLink(ev: NostrEvent): ActionLink | null {
  if (ev.kind !== ACTION_KIND) return null
  if (carriesSpawn(ev)) return null
  const name = tag(ev, 'A') ?? ''
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
 * kind:3333 event carrying `["A", "spawn"]`, even beside another `A` tag
 * (which then makes it invalid, §8.8), newest first, ties to the larger id
 * (NIP-01). An invalid newest spawn still wins, and there is no
 * fallback to an older one (arkinox, 2026-10-07, Q7): its chain is dead from
 * the spawn, and buildChain says so rather than quietly reading an older
 * chain the identity has already left. `pubkey`, when given, is whose
 * spawns count; any other author's are passed over.
 */
export function newestSpawn(events: NostrEvent[], pubkey?: string): NostrEvent | null {
  let best: NostrEvent | null = null
  for (const e of events) {
    if (e.kind !== ACTION_KIND || !carriesSpawn(e)) continue
    // Only the identity's own: a relay that hands back another key's newer
    // spawn, however validly signed, does not get to end this chain.
    if (pubkey !== undefined && e.pubkey !== pubkey) continue
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
  const home = placeOf(ev.pubkey)
  const aWrong = aTagsWrong(ev)
  const tagsWrong = readTagsWrong(ev, 'spawn', 'spawn')
  if (parsed && parsed.type === 'spawn' && !aWrong && !tagsWrong) {
    const sectors = sectorTagsWrong(ev, 'spawn', parsed.position)
    if (!sectors || !home) return parsed
    return { ...parsed, ...home, type: 'other', role: 'broken', breaks: sectors.breaks, breakSince: sectors.since }
  }
  if (!home) return null
  const C = tag(ev, 'C')
  const claimed = placeOf(C, tag(ev, 'S'))
  let breaks: string
  let since: RuleChange | undefined
  if (aWrong) {
    breaks = aWrong.breaks
    since = aWrong.since
  } else if (tagsWrong) {
    breaks = tagsWrong
    since = TAGS_ONCE_RULE
  } else if (claimed && C !== ev.pubkey) {
    const [said, own] = shownApart(C!, ev.pubkey)
    breaks = `a spawn whose C (${said}) is not the coordinate your public key decodes to (${own}). A spawn always places you at your own key's coordinate, never anywhere else (spec §8.3)`
  } else {
    breaks = 'a spawn that is missing its C tag, or has it malformed, so it places you nowhere (spec §8.3)'
  }
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
    ...(since ? { breakSince: since } : {}),
  }
}

/**
 * Reassemble one pubkey's active chain from whatever the relay handed back.
 *
 * Spec §8.7.3: the newest spawn wins, and only events whose genesis names it
 * can be part of the chain; events that name another spawn are history, even
 * if their `previous` link would fit. From that spawn the chain is followed
 * forward through `previous` links. At a fork (two events naming the
 * current event as previous) the walk ends, and the whole chain is dead from
 * its spawn (spec §8.7.3 rule 4, arkinox 2026-10-08).
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
 * Only events by the spawn's own author are followed: a chain is one key's,
 * and an event another key signed is never part of it, whatever it names.
 * `pubkey`, when given, is whose chain to build.
 *
 * Every event handed in must already be authentic, a valid NIP-01 id and
 * signature (spec §8.2, §8.7.3, Q4), because resolution never checks one:
 * a forged event handed in would take part. The inauthentic ones are
 * discarded where events come in, so here they never existed, and a branch
 * through one simply ends at the event before it, which is the head:
 * relay events by the pool on receipt (relay.ts), a stored chain when it is
 * loaded, and a remote signer's answer when it comes back (both in
 * store/useCyberspace.ts). Test fixtures carry no real signatures, which is
 * why the check is not made here.
 *
 * Returns the spawn alone when nothing follows it, and nothing when there is
 * no spawn at all: a hop without a genesis is not a position.
 */
export function buildChain(events: NostrEvent[], pubkey?: string): ActionEvent[] {
  // Only the spawns are read here; every other event is read once, in place.
  const spawn = spawnEntry(newestSpawn(events, pubkey))
  if (!spawn) return []

  const byPrev = new Map<string, Array<{ link: ActionLink; ev: NostrEvent }>>()
  for (const ev of events) {
    const link = actionLink(ev)
    if (!link || link.genesisId !== spawn.id || link.pubkey !== spawn.pubkey) continue
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
  /** The fork the walk reached, if it reached one: the head two or more events name, and those events. */
  let fork: { previousId: string; branches: ActionLink[] } | null = null
  for (;;) {
    // A fork ends the whole chain (2026-10-08 ruling; spec PR #48): two or
    // more events naming the head as previous, by each one's first e
    // previous, whichever is valid or earlier. It is found here, on the walk
    // from the spawn, and only here: events that name an event the walk
    // never reaches (a discarded one, an unknown id) make no fork. The chain
    // has no next event at a fork, so the walk ends at its head.
    const children = [...new Map((byPrev.get(head.id) ?? []).map((c) => [c.link.id, c])).values()]
    if (children.length > 1) {
      fork = { previousId: head.id, branches: children.map((c) => c.link).sort((a, b) => -newer(a, b)) }
      break
    }
    const next = children.filter((c) => !seen.has(c.link.id))[0]
    if (!next) break
    let entry = placeInChain(next.ev, next.link, head, open)
    // DECK-0001 §4.3, read through games and skipped actions (§8.9 rule 4,
    // §8.11.4 rule 8): a ride follows a boarding or another ride.
    if (entry.type === 'hyperjump' && !entry.breaks) {
      const ride = rideBreak(entry, lookBack(chain, chain.length), next.ev)
      if (ride) entry = { ...entry, breaks: ride }
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
  if (fork && !spawn.breaks) {
    // Dead from the spawn: every row stands at the spawn coordinate, and
    // the spawn row says why, naming the branches.
    const home: Placed = { coordHex: spawn.coordHex, position: spawn.position, plane: spawn.plane, sector: spawn.sector }
    const ids = fork.branches.map((b) => `${b.id.slice(0, 8)}…`)
    const listed = ids.length === 2 ? `${ids[0]} and ${ids[1]}` : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`
    const shared = chain.length - 1
    for (let i = 1; i < chain.length; i++) chain[i] = standingAt(chain[i], home)
    chain[0] = {
      ...chain[0],
      breaks: `a fork: ${countWord(ids.length)} events (${listed}) ${ids.length === 2 ? 'both name' : 'all name'} row ${shared} (event ${fork.previousId.slice(0, 8)}…) as the action before them. ${FORK_RULE_WORDS}`,
      breakSince: FORK_RULE,
      fork: { previousId: fork.previousId, branchIds: fork.branches.map((b) => b.id) },
    }
  }
  return chain
}

/**
 * Why a ride breaks the rules about where it may start, or null (DECK-0001
 * §4.2, §4.3), given the action it looks back to (§8.9 rule 4, §8.11.4 rule
 * 8). Checked without any block data: a ride follows a boarding or a ride; a
 * first ride after boarding names its as_of bound, and the bound is not
 * below the block it rides to; a later ride leaves from the block the ride
 * before it reached.
 */
function rideBreak(ride: ActionEvent, stood: ActionEvent | null, ev: NostrEvent): string | null {
  if (stood?.type === 'enter-hyperspace') {
    // Read here and only here (spec PR #48): exactly once, base-10.
    const asOfTags = tagCount(ev, 'as_of')
    if (asOfTags > 1) return `a first ride after boarding carrying ${countWord(asOfTags)} as_of tags. Every tag the chain rules read has to appear exactly once (DECK-0001 §8, per the 2026-10-08 ruling)`
    if (asOfTags === 1 && ride.asOf === undefined) return 'a first ride after boarding whose as_of tag is not a block height (DECK-0001 §4.2)'
    if (ride.asOf === undefined) return 'a first ride after boarding with no as_of tag. The first ride from a station has to say up to which block it looked when it found that station, in its as_of tag (DECK-0001 §4.2, §4.3)'
    if (ride.asOf < ride.toHeight!) return `a first ride whose as_of (${ride.asOf}) is below the block it rides to (${ride.toHeight}). Its station is found among the blocks up to as_of, so as_of can never be lower than the destination (DECK-0001 §4.2)`
    return null
  }
  if (stood?.type === 'hyperjump') {
    if (ride.fromHeight !== stood.toHeight) return `a ride that leaves from block ${ride.fromHeight}, but the ride before it stopped at block ${stood.toHeight}. A ride always leaves from the block the last ride reached (DECK-0001 §4.3)`
    return null
  }
  return 'a ride (hyperjump) that does not follow a boarding or another ride: a ride may only come straight after an enter-hyperspace or a hyperjump (DECK-0001 §4.3)'
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

/**
 * Two different coordinates, each cut to the stretch where they differ, so
 * the two never print the same: eight hex digits from the first one that
 * differs, with ellipses for what is cut. Coordinates interleave the axes
 * bit by bit, so the first differing digit is the largest part of the move.
 * Two that differ only in the plane bit say so, since their digits then
 * differ only in the last place.
 */
export function shownApart(a: string, b: string): [string, string] {
  let d = 0
  while (d < a.length && a[d] === b[d]) d++
  const start = Math.min(d, Math.max(0, a.length - 8))
  const cut = (h: string): string => `${start > 0 ? '…' : ''}${h.slice(start, start + 8)}${start + 8 < h.length ? '…' : ''}`
  const plane = HEX_64.test(a) && HEX_64.test(b) && planeBitOnly(a, b)
  return plane ? [`${cut(a)}, the same x, y and z in the other plane`, cut(b)] : [cut(a), cut(b)]
}

/** "a hop", "an enter-virtual": the article an action's name takes. */
const an = (name: string): string => `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`

/** The words for an action that starts somewhere other than where the chain stood. */
function startsElsewhere(name: string, c: string | null, stood: string): string {
  if (!c) return `it names no c, no place it starts from, but every ${name} has to start exactly where the chain stood, ${tailOf(stood)} (spec §8.9 rule 2, §8.11.5)`
  const [from, at] = shownApart(c, stood)
  return `it starts from ${from}, but the action before it left you at ${at}. Every ${name} has to start exactly where the chain stood, or it would be a teleport (spec §8.9 rule 2, §8.11.5)`
}

/** The last eight hex digits of a coordinate. */
const tailOf = (hex: string): string => `…${hex.slice(-8)}`

/**
 * Why an event's sector tags break the rules, and since when, or null when
 * they do not (spec §10, §8.3 to §8.5, §8.11.1, §8.11.3, DECK-0001 §1.3):
 * X, Y, Z and S are required on every recognized base action (Q9, ruled
 * 2026-10-07), each exactly once (clarified by spec PR #46), and must be exactly
 * what sectorTags computes from the place its C names, the real position P
 * for an entry into a game and an exit from one. Never asked of a game's own
 * actions (§8.11.4 rule 4) or of an action this client does not recognize
 * (§8.9).
 */
function sectorTagsWrong(ev: NostrEvent, name: string, at: Position): { breaks: string; since: RuleChange } | null {
  const want = sectorTags(at)
  const missing = want.filter(([k]) => tag(ev, k) === undefined).map(([k]) => k)
  if (missing.length > 0) {
    return { since: SECTOR_TAG_RULE, breaks: `${an(name)} without its sector tag${missing.length === 1 ? '' : 's'} ${missing.join(', ')}. Every move has to carry its X, Y, Z and S sector tags, so that relays can find it by where it is (spec §10, per the 2026-10-07 ruling)` }
  }
  const doubled = want.map(([k]) => [k, tagCount(ev, k)] as const).filter(([, n]) => n > 1)
  if (doubled.length > 0) {
    const said = doubled.map(([k, n]) => `${countWord(n)} ${k} tags`).join(' and ')
    return { since: DUPLICATE_SECTOR_RULE, breaks: `${an(name)} carrying ${said}. Each sector tag has to appear exactly once, like the A tag, so that a relay asked for a sector finds the move there and nowhere else (spec §10, as clarified by spec PR #46)` }
  }
  const wrong = want.filter(([k, v]) => tag(ev, k) !== v)
  if (wrong.length === 0) return null
  const said = wrong.map(([k, v]) => `${k} says ${tag(ev, k)} where its coordinate is in ${v}`).join('; ')
  return { since: SECTOR_TAG_RULE, breaks: `${an(name)} whose sector tags do not agree with its own coordinate: ${said}. A sector tag has to name the sector the action's C is in, so that relays can find it by where it is (spec §10, per the 2026-10-07 ruling)` }
}

/** Whether two coordinates name the same x, y and z in different planes. */
function planeBitOnly(a: string, b: string): boolean {
  const p = coordToXyz(hexToCoord(a))
  const q = coordToXyz(hexToCoord(b))
  return p.plane !== q.plane && p.x === q.x && p.y === q.y && p.z === q.z
}

/** Breaks of the bracket rules (spec #44) and of the 2026-10-07 rulings, for spreading onto an entry. */
const BRACKET_RULE = { breakSince: BRACKET_RULES }
const RULED_2026_10_07 = { breakSince: RULINGS_2026_10_07 }

/** A recognized action as placed, broken instead when its sector tags are missing, doubled or wrong (§10). */
function withSectorCheck(ev: NostrEvent, a: ActionEvent, name: string): ActionEvent {
  const at = placeOf(tag(ev, 'C'))
  const wrong = at ? sectorTagsWrong(ev, name, at.position) : null
  return wrong ? { ...a, breaks: wrong.breaks, breakSince: wrong.since } : a
}

/**
 * One event's entry in the chain, given the entry before it and the bracket
 * open at that point: §8.9 for an action outside a bracket, §8.11.4 inside.
 *
 * The one-A-tag rule (§8.8) comes first, because it holds for every event
 * wherever it stands: a base action, a skipped action (§8.9), a game's own
 * move or an exit inside a bracket (§8.11.4 rule 4, §8.11.5). An event with
 * no A tag names no action, and is broken. One with several is read by its
 * first, so its row still says what it was trying to be and a bracket it
 * opens still opens, and is broken for carrying the others: the reason a
 * reader is told is the A tags, before anything else the event got wrong.
 */
function placeInChain(ev: NostrEvent, link: ActionLink, before: ActionEvent, open: ActionEvent | null): ActionEvent {
  const placed = placeByName(ev, link, before, open)
  const aWrong = aTagsWrong(ev)
  // What the rules read on it: inside a bracket only the links, and an
  // exit's entry and C (§8.11.4 rule 4); outside, the action's own tags, or
  // only the links on an action this client skips (§8.9).
  const read: RecognizedAction | 'links' = open
    ? (link.name === 'exit-virtual' ? 'exit-virtual' : 'links')
    : (isRecognized(link.name) ? link.name : 'links')
  const tagsWrong = aWrong ? null : readTagsWrong(ev, read, read === 'links' ? 'event' : read === 'enter-hyperspace' ? 'boarding' : link.name)
  const wrong = aWrong ?? (tagsWrong ? { breaks: tagsWrong, since: TAGS_ONCE_RULE } : null)
  if (!wrong) return placed
  const { breakBug: _bug, ...rest } = placed
  return { ...rest, role: placed.role === 'skipped' || link.name === '' ? 'broken' : placed.role, breaks: wrong.breaks, breakSince: wrong.since }
}

/** placeInChain for an event read by its (first) A tag. */
function placeByName(ev: NostrEvent, link: ActionLink, before: ActionEvent, open: ActionEvent | null): ActionEvent {
  const parsed = parseAction(ev)
  const carried: Placed = { coordHex: before.coordHex, position: before.position, plane: before.plane, sector: before.sector }
  const declared = placeOf(tag(ev, 'C'), tag(ev, 'S'))
  const prev = tag(ev, 'c')
  const prevCoordHex = prev && HEX_64.test(prev) ? prev : null
  const unread = (role: ChainRole, breaks?: string, bracketId?: string, since?: RuleChange): ActionEvent => ({
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
        return withSectorCheck(ev, { ...parsed, role: 'exit', bracketId: open.id }, 'exit from a game')
      }
      return unread('broken', parsed?.type === 'exit-virtual'
        ? 'an exit from a game that either names a different entry than the game you are in, or does not put you back exactly where you entered the game (spec §8.11.4 rules 2 and 6)'
        : 'an exit from a game that is missing a tag the chain rules read, or has one malformed', open.id, BRACKET_RULES)
    }
    if (BASE_INSIDE_BRACKET.has(link.name)) {
      return unread('broken', `${an(link.name)} signed while you were inside a game. Inside a game only the game's own actions may stand, never a move through cyberspace (spec §8.11.4 rule 3)`, open.id, BRACKET_RULES)
    }
    return unread('virtual', undefined, open.id)
  }
  if (parsed && parsed.type === 'enter-virtual') {
    // Into a bracket: from where the chain stood, and without moving.
    const entry: ActionEvent = { ...parsed, bracketId: parsed.id }
    if (parsed.prevCoordHex !== before.coordHex) return { ...entry, breaks: startsElsewhere('entry into a game', parsed.prevCoordHex, before.coordHex), ...BRACKET_RULE }
    if (parsed.declared) {
      const [C, c] = shownApart(parsed.declared.coordHex, parsed.coordHex)
      return { ...entry, breaks: `an entry into a game whose C (${C}) is not its own c (${c}). Entering a game does not move you: you stay exactly where you were, and where you start inside the game is the game's own business, carried in a tag of its own (spec §8.11.1, per the 2026-10-07 ruling)`, ...RULED_2026_10_07 }
    }
    return withSectorCheck(ev, entry, 'entry into a game')
  }
  if (parsed && parsed.type === 'exit-virtual') return unread('broken', 'an exit from a game when no game was open (spec §8.11.4 rule 6)', undefined, BRACKET_RULES)
  if (parsed) {
    if (parsed.prevCoordHex !== before.coordHex) {
      // The 2026-10-06 boarding: ONOSENDAI rebuilt a boarding's coordinate
      // from the plane lined up for the next move, so it named the right x,
      // y and z in the other plane. Fixed in PR #225; said so on the break.
      const bug = parsed.type === 'enter-hyperspace' && planeBitOnly(parsed.prevCoordHex!, before.coordHex)
      return { ...parsed, breaks: startsElsewhere(parsed.type === 'enter-hyperspace' ? 'boarding' : parsed.type, parsed.prevCoordHex, before.coordHex), ...(bug ? { breakBug: 'plane-bit' as const } : {}) }
    }
    if (parsed.type === 'hyperjump' && parsed.fromHeight === parsed.toHeight) {
      const offered = tag(ev, 'client') === CLIENT_NAME ? { breakBug: 'zero-length-offered' as const } : {}
      return { ...parsed, breaks: `a zero-length ride: it rides from block ${parsed.fromHeight} to block ${parsed.toHeight}, the same block, so it goes nowhere. A ride must always go to a different block than the one it starts from (DECK-0001 §5.6, per the 2026-10-07 ruling)`, ...RULED_2026_10_07, ...offered }
    }
    if (parsed.type === 'hyperjump' && !parsed.mp) {
      return { ...parsed, breaks: 'a ride whose mp tag is empty, so it carries none of the openings its proof needs (DECK-0001 §5.2, §5.5)' }
    }
    return withSectorCheck(ev, parsed, parsed.type === 'enter-hyperspace' ? 'boarding' : parsed.type)
  }
  // A recognized name that would not parse is a malformed action, not one
  // this client does not know; a name it does not recognize is skipped and
  // the position carried across it (§8.9 rules 2 and 5).
  return isRecognized(link.name)
    ? unread('broken', `${an(link.name)} that is missing a tag the chain rules read, or has one malformed`, undefined,
      link.name === 'enter-virtual' || link.name === 'exit-virtual' ? BRACKET_RULES : undefined)
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
    // An event with no A tag has no name to show (§8.8).
    case 'broken': return name ? `BROKEN · ${name.toUpperCase()}` : 'BROKEN'
    default: return a.type === 'enter-hyperspace' ? 'ENTER' : a.type.toUpperCase()
  }
}
