/**
 * chainFixtures.ts - kind:3333 events for chain resolution tests, by hand.
 *
 * Resolution reads tags and links and never checks a signature, an id hash
 * or a proof, so these are built directly: ids are counters, and a hop's
 * proof is zeros. Every builder writes the tags the spec requires of that
 * action and nothing else, so a test that changes one tag is testing that
 * tag (spec §8.4, §8.9, §8.11).
 */

import { ACTION_KIND, positionHex, sectorTags, type NostrEvent } from '../events'
import type { Position } from '../space'
import { coordToXyz, hexToCoord, type Plane } from 'cyberspace-core'

let counter = 0
/** A fresh 64-hex id, distinct from every other one in the file that asks. */
export function nextId(): string {
  counter += 1
  return (0xc0de0000 + counter).toString(16).padStart(64, '0')
}

export const ZERO = '0'.repeat(64)

interface Common {
  pubkey: string
  createdAt: number
  genesisId: string
  previousId: string
  id?: string
}

/** Any action, by name: the links, the coordinates when given, and any extra tags. */
export function actionEvent(i: Common & { name: string; c?: string; C?: Position; plane?: Plane; tags?: string[][] }): NostrEvent {
  const plane = i.plane ?? 0
  return {
    id: i.id ?? nextId(),
    pubkey: i.pubkey,
    created_at: i.createdAt,
    kind: ACTION_KIND,
    content: '',
    sig: '0'.repeat(128),
    tags: [
      ['A', i.name],
      ['e', i.genesisId, '', 'genesis'],
      ['e', i.previousId, '', 'previous'],
      ...(i.c ? [['c', i.c]] : []),
      ...(i.C ? [['C', positionHex(i.C, plane)], ...sectorTags(i.C)] : []),
      ...(i.tags ?? []),
    ],
  }
}

/** A hop from `c` to `to`, with a zero proof (§8.4). */
export function hopEvent(i: Common & { c: string; to: Position; plane?: Plane }): NostrEvent {
  return actionEvent({ ...i, name: 'hop', C: i.to, tags: [['proof', ZERO]] })
}

/** The aligned cube of height `height` that contains `p`. */
export function regionAround(p: Position, height: number): Position {
  const h = BigInt(height)
  return { x: (p.x >> h) << h, y: (p.y >> h) << h, z: (p.z >> h) << h }
}

/**
 * An enter-virtual (§8.11.1 as refined 2026-10-07): held at `c`, with its `C`
 * equal to its `c` because entering does not move you, in the region of
 * `height` around `inGame`, the game's place, which only sizes the region
 * here. `C` overrides the `C` tag, for an entry that names somewhere else.
 */
export function enterVirtualEvent(i: Common & {
  c: string
  inGame: Position
  height: number
  game: string
  plane?: Plane
  regionBase?: Position
  pTags?: string[][]
  C?: Position
}): NostrEvent {
  const plane = i.plane ?? 0
  const base = i.regionBase ?? regionAround(i.inGame, i.height)
  const held = coordToXyz(hexToCoord(i.c))
  return actionEvent({
    ...i,
    name: 'enter-virtual',
    C: i.C ?? { x: held.x, y: held.y, z: held.z },
    plane: i.C ? plane : held.plane,
    tags: [
      ['region', positionHex(base, plane), String(i.height)],
      ...(i.pTags ?? [['p', i.game, '', 'game']]),
    ],
  })
}

/** A game's own move inside a bracket (§8.11.2), with a c and a C, or without either when they are left out. */
export function virtualEvent(i: Common & { name: string; c?: string; inGame?: Position; plane?: Plane }): NostrEvent {
  return actionEvent({ ...i, C: i.inGame })
}

/** An exit-virtual (§8.11.3): back to `restore`, from `c`, which nothing checks and may be left out. */
export function exitVirtualEvent(i: Common & { entryId: string; c?: string; restore: Position; plane?: Plane }): NostrEvent {
  return actionEvent({ ...i, name: 'exit-virtual', C: i.restore, tags: [['e', i.entryId, '', 'entry']] })
}
