/**
 * terrainShareLive.ts - what store/terrainShare.ts talks to in the app: the
 * canonical relay alone (wss://relay.onosendai.tech, never another) for
 * layers, for the actions that name builder keys and for the chains that
 * prove reach (it checks every hop's proof before it accepts it, and this
 * client does not verify hop work itself), the Bitcoin headers the seeds
 * clock already trusts (NTH's anchors and the header blobs,
 * lib/seeds/seedSources.ts), the blocks worker for the ground, the mute
 * list, the follow list, presence, and the witness's HTTP query on the same
 * relay (lib/terrain/witness.ts). Kept apart so tests hand terrainShare a
 * mock relay and never load any of this.
 */

import { setDefaultShareDeps, NEAR_GIBSONS, type ShareDeps } from './terrainShare'
import { useCyberspace } from './useCyberspace'
import { useMutes } from './useMutes'
import { usePresence } from './usePresence'
import { CYBERSPACE_RELAY, publishOnceTo, queryAny } from '../lib/relay'
import { MAX_CHAIN_PAGES, chainFilter, mergeEvents } from '../lib/chains'
import { actionLink, chainGap, type NostrEvent } from '../lib/events'
import { v1HopListNow } from '../lib/chainStop'
import { followsOf } from '../lib/contacts'
import { verifyOnce } from '../lib/verifiedSigs'
import { generateChunk } from '../lib/terrain/blocksClient'
import { SETTLE_DEPTH } from '../lib/terrain/blockLayer'
import { fetchSeedHeaders, headerBook, headersReady, refreshTrustedTip, trustedTip } from '../lib/seeds/seedSources'
import { WitnessBook } from '../lib/terrain/witness'
import { getMeta, putMeta } from '../lib/idb'
import { openTerrainDb } from '../lib/terrain/terrainDb'

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
 * height 6 or more deep whose header cannot be had is pending too, until it
 * can be (§6.1 says so), never counted on a guess.
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

const ACTION = 3333

/**
 * The chain holding `actionId`, from the canonical relay alone: the action,
 * its spawn (its genesis), and every action naming that genesis, with the
 * holes filled as lib/chains.ts fills them. A respawn ends a chain, and a
 * layer's reach event may stand on an ended one (DECK-0009 §6.2).
 */
async function authorChain(pubkey: string, actionId: string): Promise<NostrEvent[]> {
  const ask = async (f: Parameters<typeof queryAny>[1]): Promise<NostrEvent[]> => (await queryAny([CYBERSPACE_RELAY], f)).filter((e) => e.pubkey === pubkey && e.kind === ACTION)
  const [ev] = await ask({ kinds: [ACTION], authors: [pubkey], ids: [actionId] })
  if (!ev) return []
  const genesis = actionLink(ev)?.genesisId ?? ev.id
  let events = genesis === ev.id ? [ev] : mergeEvents([ev], await ask({ kinds: [ACTION], authors: [pubkey], ids: [genesis] }))
  events = mergeEvents(events, await ask(chainFilter(pubkey, genesis)))
  for (let i = 0; i < MAX_CHAIN_PAGES; i++) {
    const gap = chainGap(events, genesis)
    if (!gap) break
    const before = events.length
    events = mergeEvents(events, await ask(chainFilter(pubkey, genesis, gap.until)))
    if (events.length > before) continue
    events = mergeEvents(events, await ask({ kinds: [ACTION], authors: [pubkey], ids: [gap.missingId] }))
    if (events.length === before) break
  }
  return events
}

/** A URL's status and text, or null for no answer in 6 seconds or a network failure. */
async function fetchText(url: string, init?: { headers?: Record<string, string> }): Promise<{ status: number; text: string } | null> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(6000) })
    return { status: r.status, text: r.status === 200 ? await r.text() : '' }
  } catch { return null }
}

/** The witness key, pinned on this device once learned (DECK-0009 §7.4: taken from NIP-11 `self` and pinned from then on). */
const WITNESS_PIN = 'onosendai:witness-key'
let pinDb: Promise<IDBDatabase> | null = null
const pinStore = (): Promise<IDBDatabase> => (pinDb ??= openTerrainDb())
const pin = {
  // Kept in the terrain database's meta store (IndexedDB, never localStorage); not per identity, it is the relay's.
  get: async (): Promise<string | null> => {
    const v = await getMeta(await pinStore(), WITNESS_PIN).catch(() => null)
    return typeof v === 'string' ? v : null
  },
  set: (k: string): void => { void pinStore().then((db) => putMeta(db, WITNESS_PIN, k)).catch(() => { /* pinned for this visit */ }) },
}

/** The witness, one for the visit: what it said is kept (lib/terrain/witness.ts). */
const witness = new WitnessBook(fetchText, () => Date.now(), pin)

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
    authorChain,
    v1List: () => v1HopListNow(),
    commitBlock,
    header,
    ground: (base) => generateChunk(base).then((g) => g.blocks),
    muted: () => useMutes.getState().muted.pubkeys,
    follows: (me) => followsOf(me),
    othersNear,
    witness: { learn: (a) => witness.learn(a), status: (id) => witness.status(id), settle: (id, sid) => witness.settle(id, sid), lied: () => witness.lied },
    verify: (ev) => verifyOnce(ev),
    now: () => Date.now(),
  }
}

setDefaultShareDeps(liveShareDeps)
