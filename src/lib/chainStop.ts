/**
 * chainStop.ts - where your chain stops, by every rule ONOSENDAI can check
 * without redoing proof work: the one answer the broken-chain chip, its
 * notice, RESPAWN, Derezz, the speakeasy line's RESPAWN and every move
 * (store whyNoMove) read (the owner's ruling of 2026-11-12: "make our chain
 * checks match the relay's, app-wide").
 *
 * Two kinds of stop, the first one on the chain counting:
 *
 * | Stop | Found by | What ONOSENDAI does |
 * |---|---|---|
 * | a structural break (links, sectors, brackets, rides, forks) | buildChain, `breaks` on the row (events.ts firstBreak) | as since 2026-10-07: frozen at the last valid position, every move refused, RESPAWN |
 * | a proof in a form the rules reject: a version 1 hop off the 5.13 list, a hop with one of mn and mp, a sidestep or a ride with no mn off its list | lib/relayPlacement.ts scanFormStops | every move refused (RELAY_STOPPED_MESSAGE), RESPAWN; the avatar is still drawn at the head |
 * | a hop above the relay's verify ceiling (h24) | the same | said, nothing refused: the relay leaves it unchecked, not rejected, and a respawn would not help |
 *
 * The 5.13 list is 97 KB gzipped and loads lazily (lib/v1HopList): until it
 * has, a chain with a version 1 hop reads as `undefined`, not known yet, so
 * nothing is said and nothing is refused on a guess. Loaded once, kept for
 * the whole app (ensureV1HopList).
 *
 * Kept per chain, not walked per render: the answer for a chain array is
 * remembered, and when the store's chain grows by appended rows (the same
 * row objects, store parsedChain's extendChain) only the new rows are read.
 * Two slots, your own chain and the one you spectate, so looking at someone
 * never throws your own answer away.
 */

import { firstBreak, type ActionEvent } from './events'
import { scanFormStops, type RelayStop } from './relayPlacement'
import { loadV1HopList } from './v1HopList'

/** The first stop on a chain: a structural break, or a form stop. */
export type ChainStop =
  | { source: 'rules'; broken: NonNullable<ReturnType<typeof firstBreak>> }
  | { source: 'relay'; stop: RelayStop }

// The 5.13 list, once loaded, for the whole app.
let listed: ReadonlySet<string> | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

/** The 5.13 list if it has loaded, else null. Never loads it. */
export function v1HopListNow(): ReadonlySet<string> | null {
  return listed
}

/** Load the 5.13 list if it is not loaded or loading. A failed load is forgotten, so the next call tries again. */
export function ensureV1HopList(): void {
  if (listed || loading) return
  loading = loadV1HopList().then(
    (l) => { listed = l; loading = null; for (const f of listeners) f() },
    () => { loading = null },
  )
}

/** Called once the 5.13 list loads. */
export function onV1HopList(f: () => void): () => void {
  listeners.add(f)
  return () => { listeners.delete(f) }
}

type Chain = ActionEvent[]
type Break = NonNullable<ReturnType<typeof firstBreak>>
interface Memo {
  chain: Chain
  list: ReadonlySet<string> | null
  /** The chain's first structural break (events.ts firstBreak), or null. */
  broken: Break | null
  /** Where the form scan ended (scanFormStops `scanned`). */
  scanned: number
  stop: RelayStop | null
  unknown: boolean
}
const memos = new Map<string, Memo>()

/** Whether `chain` is `prev` with rows appended: the same row objects up to prev's end. */
function extendsChain(chain: Chain, prev: Chain): boolean {
  const n = prev.length
  return n > 0 && chain.length >= n && chain[0] === prev[0] && chain[n - 1] === prev[n - 1]
}

/** firstBreak from row `from` on: the rows before it are known to hold. */
function breakFrom(chain: Chain, from: number): Break | null {
  for (let i = from; i < chain.length; i++) {
    if (chain[i].breaks !== undefined) return { index: i, action: chain[i], lastValid: i > 0 ? chain[i - 1] : null }
  }
  return null
}

/**
 * The structural break and the first form stop before it, remembered in
 * `slot`, and read again only where the chain changed: an appended row is
 * the only row read. `stop` undefined: only the unloaded 5.13 list can say.
 */
function stopsOf(chain: Chain, slot: string): { broken: Break | null; stop: RelayStop | null | undefined } {
  const list = listed
  const m = memos.get(slot)
  let memo: Memo
  if (m && m.chain === chain && m.list === list) {
    memo = m
  } else if (m && extendsChain(chain, m.chain) && (m.list === list || m.list === null)) {
    // A scan made without the list judged nothing the list could change (it
    // ended at the first hop that needed it), so it holds with the list too;
    // one made with a list holds with that list. Rows appended after a break
    // or a stop change neither.
    const broken = m.broken ?? breakFrom(chain, m.chain.length)
    if (m.stop) {
      memo = { ...m, chain, list, broken }
    } else {
      // Nothing found up to where the scan ended: go on from there, from the
      // hop it waited at when it waited for the list.
      memo = { chain, list, broken, ...scanFormStops(chain, list, m.scanned, broken ? broken.index : chain.length) }
    }
  } else {
    const broken = firstBreak(chain)
    memo = { chain, list, broken, ...scanFormStops(chain, list, 1, broken ? broken.index : chain.length) }
  }
  memos.set(slot, memo)
  return { broken: memo.broken, stop: memo.unknown ? undefined : memo.stop }
}

/**
 * The first form stop on `chain` before its first structural break (the
 * break itself is buildChain's to say): a RelayStop, null when there is
 * none, or undefined while only the unloaded 5.13 list could say. `slot`
 * keeps one chain's answer apart from another's. Reads the list only if
 * loaded; ensureV1HopList loads it.
 */
export function formStopOf(chain: Chain, slot = 'own'): RelayStop | null | undefined {
  return chain.length === 0 ? null : stopsOf(chain, slot).stop
}

/**
 * The first stop on `chain`, structural or form, or null when it has none,
 * or undefined while a form stop before any structural break can only be
 * known once the 5.13 list loads. A structural break already known is
 * returned at once, list or no list (it refuses moves either way); a form
 * stop the list finds before it takes its place once it loads.
 */
export function chainStopOf(chain: Chain, slot = 'own'): ChainStop | null | undefined {
  if (chain.length === 0) return null
  const { broken, stop: form } = stopsOf(chain, slot)
  // A form stop is only ever looked for before the structural break, so when
  // both exist the form stop is first. A tall hop gives way to a later
  // break, though: the break freezes the chain and asks for a respawn, the
  // tall hop does neither.
  if (form?.kind === 'broken') return { source: 'relay', stop: form }
  if (broken) return { source: 'rules', broken }
  return form ? { source: 'relay', stop: form } : form
}

/** Whether a stop refuses moves until a respawn: every structural break, and every form stop but a tall hop. */
export function needsRespawn(stop: ChainStop | null | undefined): stop is ChainStop {
  return !!stop && (stop.source === 'rules' || stop.stop.kind === 'broken')
}

/**
 * Where a respawn's End of Chain entry goes: the last valid action before
 * the stop that refuses moves (the stopped action itself when none is
 * valid), or null when nothing on the chain needs a respawn.
 */
export function respawnPointOf(chain: Chain): ActionEvent | null {
  const stop = chainStopOf(chain)
  if (!needsRespawn(stop)) return null
  const s = stop.source === 'rules' ? stop.broken : stop.stop
  return s.lastValid ?? s.action
}

/** For tests: forget the list and every remembered answer. */
export function resetChainStops(): void {
  listed = null
  loading = null
  memos.clear()
}

/** For tests: the list as if it had loaded. */
export function setV1HopListForTests(l: ReadonlySet<string> | null): void {
  listed = l
  for (const f of listeners) f()
}
