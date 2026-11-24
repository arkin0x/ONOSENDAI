/**
 * terrainShareLive.ts - what store/terrainShare.ts talks to in the app: the
 * canonical relay alone (wss://relay.onosendai.tech, never another) for
 * layers and for the movement actions that name and retire builder keys, the
 * blocks worker for the ground, the mute list, the follow list and presence.
 * Kept apart so tests hand terrainShare a mock relay and never load any of
 * this.
 */

import { setDefaultShareDeps, NEAR_GIBSONS, type ShareDeps } from './terrainShare'
import { useCyberspace } from './useCyberspace'
import { useMutes } from './useMutes'
import { usePresence } from './usePresence'
import { CYBERSPACE_RELAY, publishOnceTo, queryAnyChecked } from '../lib/relay'
import { followsOf } from '../lib/contacts'
import { verifyOnce } from '../lib/verifiedSigs'
import { generateChunk } from '../lib/terrain/blocksClient'
import { builderKeyValid } from '../lib/terrain/blockLayer'
import type { KeyStatus } from '../lib/terrain/layerReader'
import type { NostrEvent } from '../lib/events'

const ACTION = 3333
/** Pages of an author's movement actions read to find where a key is named. */
const NAMING_PAGES = 20
const PAGE = 500

/**
 * Whether some of an author's builder keys are valid (DECK-0009 §4.4).
 * Retirements first, with one `#R` filter for the keys and `all` (any
 * chain); then the author's movement actions, newest first, until each key's
 * newest naming is found or there are none left. A key never named is void;
 * a read that fails, or a history longer than the pages read, leaves it
 * unknown (asked again later).
 */
async function keyStatus(author: string, keys: string[]): Promise<Map<string, KeyStatus>> {
  const out = new Map<string, KeyStatus>()
  const own = (es: NostrEvent[]): NostrEvent[] => es.filter((e) => e.pubkey === author && e.kind === ACTION && verifyOnce(e))
  const r = await queryAnyChecked([CYBERSPACE_RELAY], { kinds: [ACTION], authors: [author], '#R': [...keys, 'all'] })
  if (r.trouble) return out
  const retirements = own(r.events)
  const seen: NostrEvent[] = [...retirements]
  let left = keys.filter((k) => {
    if (retirements.some((e) => e.tags.some((t) => t[0] === 'builder-retire' && t[1] === k))) { out.set(k, 'void'); return false }
    return true
  })
  let until: number | undefined
  for (let page = 0; page < NAMING_PAGES && left.length; page++) {
    const got = await queryAnyChecked([CYBERSPACE_RELAY], { kinds: [ACTION], authors: [author], limit: PAGE, ...(until !== undefined ? { until } : {}) })
    if (got.trouble) return out
    seen.push(...own(got.events))
    // Newest first: the first naming found is a key's newest.
    left = left.filter((k) => {
      if (!seen.some((e) => e.tags.some((t) => t[0] === 'builder' && t[1] === k))) return true
      out.set(k, builderKeyValid(k, seen) ? 'valid' : 'void')
      return false
    })
    if (got.events.length < PAGE) { for (const k of left) out.set(k, 'void'); return out }
    until = Math.min(...got.events.map((e) => e.created_at)) - 1
  }
  return out
}

/** The canonical relay's answer; it throws when the relay could not be heard, so nothing is taken as "none" on a failure. */
async function query(filter: Parameters<typeof queryAnyChecked>[1]): Promise<NostrEvent[]> {
  const r = await queryAnyChecked([CYBERSPACE_RELAY], filter)
  if (r.trouble) throw new Error(`canonical relay: ${r.trouble}`)
  return r.events
}

function othersNear(): boolean {
  const cs = useCyberspace.getState()
  const me = cs.identity.pubkey
  const at = cs.walking ? cs.cursor : cs.position
  const now = Math.floor(Date.now() / 1000)
  const far = BigInt(NEAR_GIBSONS)
  const abs = (v: bigint): bigint => (v < 0n ? -v : v)
  return usePresence.getState().others().some((p) => p.pubkey !== me && p.plane === cs.plane && now - p.lastActive < 600
    && abs(p.position.x - at.x) <= far && abs(p.position.y - at.y) <= far && abs(p.position.z - at.z) <= far)
}

export function liveShareDeps(): ShareDeps {
  return {
    live: () => useCyberspace.getState().live,
    me: () => useCyberspace.getState().identity.pubkey,
    publish: async (ev) => {
      const r = await publishOnceTo(CYBERSPACE_RELAY, ev)
      return r.ok ? { ok: true } : { ok: false, reason: r.reason }
    },
    query,
    keyStatus,
    ground: (base) => generateChunk(base).then((g) => g.blocks),
    muted: () => useMutes.getState().muted.pubkeys,
    follows: (me) => followsOf(me),
    othersNear,
    verify: (ev) => verifyOnce(ev),
    now: () => Date.now(),
  }
}

setDefaultShareDeps(liveShareDeps)
