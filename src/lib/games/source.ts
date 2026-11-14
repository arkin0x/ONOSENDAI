/**
 * source.ts - where a game's events come from: its world bag, the bag its key
 * item is sealed in, the room behind its door, and the objects they name
 * (DECK-0002 §5.1, DECK-0004).
 *
 * For a live game, the relays: this player's own, and the game's relay hint
 * on its own when it is not one of them already (review of #697). For the
 * DEV game, the bundled fixture, asked exactly as a relay is asked (one
 * filter, the events that match it), so every reading below runs the same
 * code either way and nothing of the DEV world is ever on any relay.
 */

import { matchFilter, type Filter } from 'nostr-tools/filter'
// lib/references before lib/relay, as world.ts always had them: a test that mocks lib/relay builds its mock from the
// real module, whose imports reach lib/references, which must find the mock, not the module being mocked.
import { resolveReference } from '../references'
import { query, queryAny, relaySet } from '../relay'
import type { ResolveReference } from '../hidden'
import type { NostrEvent } from '../events'
import type { GameDef } from './types'

type Source = Pick<GameDef, 'world' | 'relayHint'>

/** The game's events that match `filter`, from where its world comes from. Every caller still checks what came back. */
export async function askGame(game: Source, filter: Filter): Promise<NostrEvent[]> {
  if (game.world.kind === 'fixture') return (await game.world.load()).filter((e) => matchFilter(filter, e))
  const [ours, hinted] = await Promise.all([
    query(filter),
    game.relayHint && !relaySet().includes(game.relayHint) ? queryAny([game.relayHint], filter).catch(() => []) : Promise.resolve([]),
  ])
  return [...ours, ...hinted]
}

/** The newest event at an address (`kind:pubkey:d`) among `events`, or null. */
export function newestAt(events: readonly NostrEvent[], address: string): NostrEvent | null {
  const [kind, pubkey, ...rest] = address.split(':')
  const d = rest.join(':')
  let best: NostrEvent | null = null
  for (const e of events) {
    if (String(e.kind) !== kind || e.pubkey !== pubkey || (e.tags.find((t) => t[0] === 'd')?.[1] ?? '') !== d) continue
    if (!best || e.created_at > best.created_at || (e.created_at === best.created_at && e.id < best.id)) best = e
  }
  return best
}

/**
 * How the game's bags follow their references (spec §7.6 References): the
 * app's own resolver for a live game; for the DEV game, the fixture's events,
 * by address or by id. The bag reader verifies whatever comes back.
 */
export function resolverOf(game: Source): ResolveReference {
  const world = game.world
  if (world.kind !== 'fixture') return resolveReference
  return async (ref) => {
    const events = await world.load()
    if (ref[0] === 'a') return newestAt(events, ref[1])
    return events.find((e) => e.id === ref[1]) ?? null
  }
}
