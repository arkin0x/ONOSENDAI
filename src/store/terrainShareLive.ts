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
import { keyStatusOn } from '../lib/terrain/builderStatus'
import type { KeyStatus } from '../lib/terrain/layerReader'
import type { NostrEvent } from '../lib/events'

/** Whether some of an author's builder keys are valid (DECK-0009 §4.4), asked of the canonical relay (lib/terrain/builderStatus.ts). */
async function keyStatus(author: string, keys: string[]): Promise<Map<string, KeyStatus>> {
  const out = await keyStatusOn((filter) => queryAnyChecked([CYBERSPACE_RELAY], filter), author, keys, verifyOnce, namedAt)
  while (namedAt.size > 2000) namedAt.delete(namedAt.keys().next().value as string)
  return out
}
/** When each builder key seen was last named, so a check after the first asks only for retirements. */
const namedAt = new Map<string, number>()

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
