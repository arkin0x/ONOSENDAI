/**
 * terrainShareLive.ts - what store/terrainShare.ts talks to in the app: the
 * canonical relay alone (wss://relay.onosendai.tech, never another), the
 * Bitcoin headers the seeds clock already trusts (NTH's anchors and the
 * header blobs, lib/seeds/seedSources.ts), the blocks worker for the
 * ground, the mute list, the follow list and presence. Kept apart so tests
 * hand terrainShare a mock relay and never load any of this.
 */

import { setDefaultShareDeps, NEAR_GIBSONS, type ShareDeps } from './terrainShare'
import { useCyberspace } from './useCyberspace'
import { useMutes } from './useMutes'
import { usePresence } from './usePresence'
import { CYBERSPACE_RELAY, publishOnceTo, queryAny } from '../lib/relay'
import { fetchChainEvents } from '../lib/chains'
import { v1HopListNow } from '../lib/chainStop'
import { followsOf } from '../lib/contacts'
import { verifyOnce } from '../lib/verifiedSigs'
import { generateChunk } from '../lib/terrain/blocksClient'
import { SETTLE_DEPTH } from '../lib/terrain/blockLayer'
import { fetchSeedHeaders, headerBook, headersReady, refreshTrustedTip, trustedTip } from '../lib/seeds/seedSources'

/** A block SETTLE_DEPTH below the trusted tip, with its verified hash (DECK-0009 §5.3). */
async function commitBlock(): Promise<{ height: number; hash: string } | null> {
  await headersReady()
  const tip = (await refreshTrustedTip().catch(() => null)) ?? trustedTip()
  if (tip === null) return null
  const height = tip - SETTLE_DEPTH
  if (headerBook.hash(height) === undefined) await fetchSeedHeaders([height]).catch(() => undefined)
  const hash = headerBook.hash(height)
  return hash ? { height, hash } : null
}

/**
 * A settle's block against our headers (DECK-0009 §6.1): pending while it is
 * not 6 below the trusted tip; then the verified header's hash decides. A
 * height whose header cannot be had is pending too (asked again on a later
 * read), never counted on a guess: recorded as a gap for the DECK.
 */
async function header(height: number, hash: string): Promise<'ok' | 'pending' | 'bad'> {
  await headersReady()
  const tip = trustedTip() ?? (await refreshTrustedTip().catch(() => null))
  if (tip === null || height > tip - SETTLE_DEPTH) return 'pending'
  if (headerBook.hash(height) === undefined) await fetchSeedHeaders([height]).catch(() => undefined)
  const known = headerBook.hash(height)
  if (known === undefined) return 'pending'
  return known === hash ? 'ok' : 'bad'
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
    ownEvents: () => useCyberspace.getState().events,
    publish: async (ev) => {
      const r = await publishOnceTo(CYBERSPACE_RELAY, ev)
      return r.ok ? { ok: true } : { ok: false, reason: r.reason }
    },
    query: (filter) => queryAny([CYBERSPACE_RELAY], filter),
    authorEvents: (pubkey) => fetchChainEvents(pubkey),
    v1List: () => v1HopListNow(),
    commitBlock,
    header,
    ground: (base) => generateChunk(base).then((g) => g.blocks),
    muted: () => useMutes.getState().muted.pubkeys,
    follows: (me) => followsOf(me),
    othersNear,
    verify: (ev) => verifyOnce(ev),
    now: () => Date.now(),
  }
}

setDefaultShareDeps(liveShareDeps)
