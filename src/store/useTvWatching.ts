/**
 * useTvWatching.ts: the count beside the CYBERSPACE TV bug (lib/tv/watching.ts).
 *
 * While the set is on: one live subscription to the pings, a ping now and
 * every PING_EVERY_MS while the tab is in front (a hidden tab is not
 * watching), and the count read again every COUNT_EVERY_MS. The ping's key is
 * made when the set comes on and forgotten when it goes off; it signs nothing
 * else, and the viewer's own signer is never asked. A ping goes by
 * publishLight, one try that never disturbs the feeds; one refused or lost is
 * let go, and the count then says only this set.
 */
import { create } from 'zustand'
import { publishLight, subscribe } from '../lib/relay'
import { randomSigner, type Signer } from '../lib/signers'
import { PING_EVERY_MS, WATCHING_KIND, WATCHING_TAG, SKEW_S, Watchers, pingTemplate } from '../lib/tv/watching'

/** How often the count is read again, ms. */
const COUNT_EVERY_MS = 5_000
/** Back in front sooner than this after the last ping, ms, and it does not ping again: an alt-tab is not a new viewer. */
const PING_AGAIN_MS = PING_EVERY_MS / 2

export const useTvWatching = create<{ count: number }>(() => ({ count: 0 }))

interface Running {
  signer: Signer
  watchers: Watchers
  unsubscribe: () => void
  timers: number[]
  onVisible: () => void
  /** When this set last sent a ping (performance.now()), or -Infinity. */
  pinged: number
}
let running: Running | null = null

function visible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

function recount(r: Running): void {
  useTvWatching.setState({ count: r.watchers.count(performance.now(), r.signer.pubkey) })
}

async function ping(r: Running): Promise<void> {
  if (!visible() || running !== r) return
  r.pinged = performance.now()
  try {
    const ev = await r.signer.signEvent(pingTemplate(Math.floor(Date.now() / 1000)))
    if (running === r) await publishLight(ev)
  } catch { /* lost: the count says this set alone */ }
}

/** The set came on: listen, say so, and count. */
export function startWatching(): void {
  if (running) return
  const r: Running = {
    signer: randomSigner(),
    watchers: new Watchers(),
    unsubscribe: () => {},
    timers: [],
    onVisible: () => { if (visible() && performance.now() - r.pinged >= PING_AGAIN_MS) void ping(r) },
    pinged: -Infinity,
  }
  running = r
  r.unsubscribe = subscribe({ kinds: [WATCHING_KIND], '#t': [WATCHING_TAG], since: Math.floor(Date.now() / 1000) - SKEW_S }, (ev) => {
    if (running === r && r.watchers.hear(ev, performance.now(), Date.now() / 1000)) recount(r)
  })
  r.timers.push(setInterval(() => void ping(r), PING_EVERY_MS) as unknown as number)
  r.timers.push(setInterval(() => recount(r), COUNT_EVERY_MS) as unknown as number)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', r.onVisible)
  recount(r)
  void ping(r)
}

/** The set went off: stop listening and saying so, and forget the key. */
export function stopWatching(): void {
  const r = running
  if (!r) return
  running = null
  r.unsubscribe()
  for (const t of r.timers) clearInterval(t)
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', r.onVisible)
  r.watchers.clear()
  useTvWatching.setState({ count: 0 })
}
