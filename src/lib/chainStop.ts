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
  // Settled only by the load it started (a reset in the tests may have dropped it).
  const load: Promise<void> = loadV1HopList().then(
    (l) => { if (loading !== load) return; listed = l; loading = null; for (const f of listeners) f() },
    () => { if (loading === load) loading = null },
  )
  loading = load
}

/** Called once the 5.13 list loads. */
export function onV1HopList(f: () => void): () => void {
  listeners.add(f)
  return () => { listeners.delete(f) }
}

/** The 5.13 list loaded, or failed: resolves either way, never rejects. */
export function whenV1HopList(): Promise<void> {
  ensureV1HopList()
  return loading ?? Promise.resolve()
}

type Chain = ActionEvent[]
type Break = NonNullable<ReturnType<typeof firstBreak>>
interface Memo {
  chain: Chain
  list: ReadonlySet<string> | null
  /** The chain's first structural break (events.ts firstBreak), or null. */
  broken: Break | null
  /** The first hop above the relay's ceiling before the break, or null: said, never refused. */
  tall: RelayStop | null
  /** The first rejected proof before the break (a form stop of kind `broken`), looked for past any tall hop. */
  stop: RelayStop | null
  /** Where the form scan ended (scanFormStops `scanned`). */
  scanned: number
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
 * The form scan from `start` to `end`, past every tall hop: the relay stops
 * at a tall hop (relayPlacement), but every other verifier reads on, so a
 * rejected proof after one still asks for a respawn here.
 */
function scanOn(chain: Chain, list: ReadonlySet<string> | null, start: number, end: number, tall: RelayStop | null): Omit<Memo, 'chain' | 'list' | 'broken'> {
  let from = start
  for (;;) {
    const s = scanFormStops(chain, list, from, end)
    if (s.stop?.kind === 'tall') { tall ??= s.stop; from = s.stop.index + 1; continue }
    return { tall, stop: s.stop, scanned: s.scanned, unknown: s.unknown }
  }
}

/**
 * The structural break, the first tall hop and the first rejected proof
 * before it, remembered in `slot`, and read again only where the chain
 * changed: an appended row is the only row read.
 */
function stopsOf(chain: Chain, slot: string): Memo {
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
    memo = m.stop
      ? { ...m, chain, list, broken }
      // Nothing refused up to where the scan ended: go on from there, from
      // the hop it waited at when it waited for the list.
      : { chain, list, broken, ...scanOn(chain, list, m.scanned, broken ? broken.index : chain.length, m.tall) }
  } else {
    const broken = firstBreak(chain)
    memo = { chain, list, broken, ...scanOn(chain, list, 1, broken ? broken.index : chain.length, null) }
  }
  memos.set(slot, memo)
  return memo
}

/**
 * The first stop on `chain` that asks for a respawn (a rejected proof, or
 * else a structural break), else a hop above the relay's ceiling, else null.
 * Undefined while only the unloaded 5.13 list can say, and then it starts
 * loading it: nothing is said, even about a structural break later on the
 * chain, until the list cannot take it back (store whyNoMove still refuses
 * moves on a known break meanwhile). `slot` keeps one chain's answer apart
 * from another's.
 */
export function chainStopOf(chain: Chain, slot = 'own'): ChainStop | null | undefined {
  if (chain.length === 0) return null
  const { broken, tall, stop, unknown } = stopsOf(chain, slot)
  if (unknown) { ensureV1HopList(); return undefined }
  // A form stop is only ever looked for before the structural break, so a
  // rejected proof is first. A tall hop gives way to both: they ask for a
  // respawn, the tall hop does not.
  if (stop) return { source: 'relay', stop }
  if (broken) return { source: 'rules', broken }
  return tall ? { source: 'relay', stop: tall } : null
}

/** Whether a stop refuses moves until a respawn: every structural break, and every form stop but a tall hop. */
export function needsRespawn(stop: ChainStop | null | undefined): stop is ChainStop {
  return !!stop && (stop.source === 'rules' || stop.stop.kind === 'broken')
}

/**
 * Where a respawn's End of Chain entry goes: the last valid action before
 * the stop that refuses moves (the stopped action itself when none is
 * valid), or null when nothing on the chain needs a respawn. Waits for the
 * 5.13 list when only it can say; if it fails to load, the structural break,
 * if any, decides.
 */
export async function respawnPointOf(chain: Chain): Promise<ActionEvent | null> {
  let stop = chainStopOf(chain)
  if (stop === undefined) { await whenV1HopList(); stop = chainStopOf(chain) }
  if (stop === undefined) { const b = firstBreak(chain); stop = b ? { source: 'rules', broken: b } : null }
  if (!needsRespawn(stop)) return null
  const s = stop.source === 'rules' ? stop.broken : stop.stop
  return s.lastValid ?? s.action
}

/** Whether `chain` is known now to need a respawn (no waiting): for a button that opens one. */
export function needsRespawnNow(chain: Chain): boolean {
  return needsRespawn(chainStopOf(chain)) || (chainStopOf(chain) === undefined && firstBreak(chain) !== null)
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
