/**
 * starredChunksLive.ts: store/starredChunks.ts wired to the app: the relays,
 * the signer, the tutorial and the page going hidden, and the watch on where
 * you stand. Started once from App.
 *
 * WHERE YOU STAND. Each time your head (WALK's cursor while walking, else your
 * chain's position) crosses into another chunk:
 *   - arriving in the chunk being guided to ends the guide, with a toast
 *     ("You're in your starred chunk"): the beacon and the marker have done
 *     their job;
 *   - a saved chunk you enter or leave has its card counted again (one count,
 *     kept per version: lib/terrain/assay.ts), so the list's finds are fresh
 *     from your last visit. Only a crossing does this, never a frame or a step.
 *
 * OTHER TABS. A star, rename or removal in another tab of this device lands in
 * the stored list (store/starredChunks.ts commit); kvStore tells this tab with
 * a `storage` event, and the list on screen follows (heardElsewhere).
 */

import { CYBERSPACE_RELAY, publishMany, queryChecked, relaySet } from '../lib/relay'
import { useCyberspace } from './useCyberspace'
import { tutorialRunFor } from './useTutorial'
import { useToast } from './useToast'
import { terrainSession } from './useTerrain'
import { cardFor } from '../terrain/surveyCard'
import { chunkName, snapshotOf } from '../lib/terrain/starredChunk'
import { chunkKey } from '../lib/terrain/coords'
import {
  endGuide, heardElsewhere, identityChanged, nudgeStarred, refreshSnapshot, schedule, setStarredDeps, starredEntry, useStarredChunks, type StarredDeps,
} from './starredChunks'

const sameRelay = (a: string, b: string): boolean => a.trim().toLowerCase().replace(/\/+$/, '') === b.trim().toLowerCase().replace(/\/+$/, '')
/** A person may be reading the signer's prompt. */
const SIGN_PATIENCE_MS = 120_000
/** How long the arrival toast stays. */
export const ARRIVED_TOAST_MS = 6_000

let started = false

/** Count a saved chunk's card again, when it is loaded, and keep it with the star. */
export async function refreshFromField(key: string): Promise<void> {
  if (!terrainSession || !starredEntry(key)) return
  try {
    const got = await cardFor(key)
    if (got && starredEntry(key)) refreshSnapshot(key, snapshotOf(got.card, got.at))
  } catch { /* the field went away: the saved card stays as it was */ }
}

/** You crossed from chunk `from` into chunk `to` (keys, or null): the guide's arrival and the saved cards' refresh. */
export function crossed(from: string | null, to: string | null): void {
  const g = useStarredChunks.getState().guide
  if (to && g && g.key === to) {
    const e = starredEntry(to)
    endGuide()
    useToast.getState().show({ label: 'You\'re in your starred chunk', meta: e ? chunkName(e) : 'Guide ended.', mark: 'star', ms: ARRIVED_TOAST_MS })
  }
  if (from) void refreshFromField(from)
  if (to) void refreshFromField(to)
}

/** The chunk your head is in, compared by value so a step inside one chunk builds no text. */
const last = { x: -1n, y: -1n, z: -1n, plane: -1, key: null as string | null }
function headChunk(): string | null {
  const s = useCyberspace.getState()
  const p = s.walking ? s.cursor : s.position
  const x = p.x >> 5n, y = p.y >> 5n, z = p.z >> 5n
  if (x === last.x && y === last.y && z === last.z && s.headPlane === last.plane) return last.key
  last.x = x; last.y = y; last.z = z; last.plane = s.headPlane
  last.key = chunkKey({ x: x << 5n, y: y << 5n, z: z << 5n, plane: s.headPlane })
  return last.key
}

export function startStarredChunks(): void {
  if (started) return
  started = true
  const deps: Partial<StarredDeps> = {
    self: () => useCyberspace.getState().identity.pubkey,
    live: () => useCyberspace.getState().live,
    tutorial: (me) => tutorialRunFor(me),
    crypto: () => {
      const c = useCyberspace.getState().selfCrypto()
      return { nip44Encrypt: c.nip44Encrypt, nip44Decrypt: c.nip44Decrypt }
    },
    fetch: async (filter) => { const r = await queryChecked(filter); return { events: r.events, trouble: !!r.trouble } },
    sign: (template) => useCyberspace.getState().signEvent(template, SIGN_PATIENCE_MS),
    // Saved means the canonical relay took it, as for the hidden list.
    publish: async (event) => {
      const res = await publishMany(relaySet(), event)
      if (res.ok && res.accepted && !res.accepted.some((u) => sameRelay(u, CYBERSPACE_RELAY))) return { ok: false, reason: `${CYBERSPACE_RELAY.replace('wss://', '')} did not take it` }
      return res
    },
  }
  setStarredDeps(deps)

  let here = headChunk()
  useCyberspace.subscribe((s, prev) => {
    if (s.identity.pubkey !== prev.identity.pubkey) identityChanged()
    // LIVE again: what LOCAL held back.
    else if (s.live && !prev.live) schedule()
    if (s.position === prev.position && s.cursor === prev.cursor && s.walking === prev.walking && s.headPlane === prev.headPlane) return
    const now = headChunk()
    if (now === here) return
    const from = here
    here = now
    crossed(from, now)
  })

  // Another tab starred, renamed or removed (kvStore raises `storage` for a record another tab wrote): this tab's list follows.
  if (typeof window !== 'undefined') window.addEventListener('storage', (e: StorageEvent) => heardElsewhere(e.key))
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') nudgeStarred('hide') })
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => nudgeStarred('hide'))
  // Anything left from the last visit.
  schedule()
}
