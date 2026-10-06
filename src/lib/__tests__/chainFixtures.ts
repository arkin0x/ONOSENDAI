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
import type { Plane } from 'cyberspace-core'

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

/** An enter-virtual (§8.11.1): held at `c`, appearing at `inGame`, in the region of `height` around it. */
export function enterVirtualEvent(i: Common & {
  c: string
  inGame: Position
  height: number
  game: string
  plane?: Plane
  regionBase?: Position
  pTags?: string[][]
}): NostrEvent {
  const plane = i.plane ?? 0
  const base = i.regionBase ?? regionAround(i.inGame, i.height)
  return actionEvent({
    ...i,
    name: 'enter-virtual',
    C: i.inGame,
    plane,
    tags: [
      ['region', positionHex(base, plane), String(i.height)],
      ...(i.pTags ?? [['p', i.game, '', 'game']]),
    ],
  })
}

/** A game's own move inside a bracket (§8.11.2). */
export function virtualEvent(i: Common & { name: string; c: string; inGame: Position; plane?: Plane }): NostrEvent {
  return actionEvent({ ...i, C: i.inGame })
}

/** An exit-virtual (§8.11.3): from the last place in the game, back to `restore`. */
export function exitVirtualEvent(i: Common & { entryId: string; c: string; restore: Position; plane?: Plane }): NostrEvent {
  return actionEvent({ ...i, name: 'exit-virtual', C: i.restore, tags: [['e', i.entryId, '', 'entry']] })
}
