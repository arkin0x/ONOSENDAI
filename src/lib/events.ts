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

export type ActionType = 'spawn' | 'hop' | 'sidestep' | 'enter-hyperspace' | 'hyperjump'

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
  /** The `C` tag: where this action put the avatar. */
  coordHex: string
  position: Position
  plane: Plane
  /** The `c` tag; null on a spawn, which comes from nowhere. */
  prevCoordHex: string | null
  /** `e` tags with the `genesis` and `previous` markers; null on a spawn. */
  genesisId: string | null
  previousId: string | null
  /** The `proof` tag; null on a spawn, which carries no work. */
  proofHash: string | null
  /** The `S` tag, as written. */
  sector: string
  /** Hyperjump only (DECK-0001 v3 §5.2): the boarding and destination heights. */
  fromHeight?: number
  toHeight?: number
  /** Hyperjump only: the sampled openings, as written in the `mp` tag. */
  mp?: string
}

const HEX_64 = /^[0-9a-f]{64}$/

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
  /** Per-axis inclusion proofs, sibling hashes concatenated leaf-first; an
   * axis that did not move contributes an empty string. */
  inclusionProofs: [string, string, string]
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
      ['mp', i.inclusionProofs.join(':')],
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
  /** Where the identity is standing; an enter does not move it (§3.3). */
  at: Position
  plane: Plane
  /** The §3.2 entry proof hash. */
  proofHash: string
}

/** DECK-0001 v3 §3.1: board the line from wherever you stand. c equals C. */
export function enterHyperspaceTemplate(i: EnterHyperspaceInput): EventTemplate {
  const here = positionHex(i.at, i.plane)
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
      ...sectorTags(i.at),
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
  /** The ride's Merkle root (64 hex; the zero root for a zero-length ride). */
  rootHex: string
  /** The sampled openings; empty string for a zero-length ride. */
  mp: string
}

/** DECK-0001 v3 §5.2: ride the line from the station (or current stop) to a stop. */
export function hyperjumpTemplate(i: HyperjumpInput): EventTemplate {
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
      ['proof', i.rootHex],
      ['mp', i.mp],
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
 * Read a kind:3333 event, or refuse it.
 *
 * Strict about shape and silent about everything else: a malformed event is
 * dropped rather than thrown, because relays return whatever they were given
 * and one bad event must not take down a chain. Proofs are not checked here;
 * that is a verifier's job, and this client is a viewer.
 */
export function parseAction(ev: NostrEvent): ActionEvent | null {
  if (ev.kind !== ACTION_KIND) return null
  const type = tag(ev, 'A')
  if (
    type !== 'spawn' &&
    type !== 'hop' &&
    type !== 'sidestep' &&
    type !== 'enter-hyperspace' &&
    type !== 'hyperjump'
  ) {
    return null
  }
  const coordHex = tag(ev, 'C')
  if (!coordHex || !HEX_64.test(coordHex)) return null
  const sector = tag(ev, 'S')
  if (!sector) return null

  const { x, y, z, plane } = coordToXyz(hexToCoord(coordHex))
  const base = {
    id: ev.id,
    pubkey: ev.pubkey,
    createdAt: ev.created_at,
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

  const prevCoordHex = tag(ev, 'c')
  const genesisId = marked(ev, 'genesis')
  const previousId = marked(ev, 'previous')
  const proofHash = tag(ev, 'proof')
  if (!prevCoordHex || !HEX_64.test(prevCoordHex)) return null
  if (!genesisId || !HEX_64.test(genesisId)) return null
  if (!previousId || !HEX_64.test(previousId)) return null
  if (!proofHash || !HEX_64.test(proofHash)) return null
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
    return {
      ...base,
      type,
      prevCoordHex,
      genesisId,
      previousId,
      proofHash,
      fromHeight: Number.parseInt(fromStr, 10),
      toHeight: Number.parseInt(toStr, 10),
      mp: tag(ev, 'mp'),
    }
  }
  return { ...base, type, prevCoordHex, genesisId, previousId, proofHash }
}

/** Newest first, ties broken by id, the NIP-01 ordering. */
function newer(a: { createdAt: number; id: string }, b: { createdAt: number; id: string }): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/**
 * Reassemble one pubkey's active chain from whatever the relay handed back.
 *
 * §3.2: the newest spawn wins, and everything that does not descend from it is
 * history. From that spawn the chain is followed forward through `previous`
 * links; a fork (two events naming the same predecessor, which a valid chain
 * never has) takes the older branch, so a later attempt to rewrite cannot
 * displace what was there first. Events whose `genesis` names another spawn
 * are ignored even if their `previous` link would fit.
 *
 * Returns the spawn alone when nothing follows it, and nothing when there is
 * no spawn at all: a hop without a genesis is not a position.
 */
export function buildChain(events: NostrEvent[]): ActionEvent[] {
  const parsed = events.map(parseAction).filter((e): e is ActionEvent => e !== null)
  const spawns = parsed.filter((e) => e.type === 'spawn').sort(newer)
  const spawn = spawns[0]
  if (!spawn) return []

  const byPrev = new Map<string, ActionEvent[]>()
  for (const e of parsed) {
    if (e.type === 'spawn' || e.genesisId !== spawn.id || !e.previousId) continue
    const list = byPrev.get(e.previousId) ?? []
    list.push(e)
    byPrev.set(e.previousId, list)
  }

  const chain = [spawn]
  const seen = new Set([spawn.id])
  let head = spawn
  for (;;) {
    const next = (byPrev.get(head.id) ?? [])
      .filter((e) => !seen.has(e.id))
      .sort((a, b) => -newer(a, b))[0]
    if (!next) break
    chain.push(next)
    seen.add(next.id)
    head = next
  }
  return chain
}

/** Where a chain currently puts its avatar. */
export function chainHead(chain: ActionEvent[]): ActionEvent | null {
  return chain.length ? chain[chain.length - 1] : null
}
