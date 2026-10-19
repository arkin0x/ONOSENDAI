/**
 * useTvWatching.ts: the count beside the CYBERSPACE TV bug (lib/tv/watching.ts).
 *
 * While the set is on: one live subscription to the pings, a ping now and
 * every PING_EVERY_MS while the tab is in front (a hidden tab is not
 * watching), and the count read again every COUNT_EVERY_MS. The ping's key is
 * made when the set comes on and forgotten when it goes off; it signs nothing
 * else. A ping the relay refuses is let go: the count then says only this set.
 */
import { create } from 'zustand'
import { publish, subscribe } from '../lib/relay'
import { randomSigner, type Signer } from '../lib/signers'
import { PING_EVERY_MS, WATCHING_KIND, SKEW_S, Watchers, pingTemplate } from '../lib/tv/watching'

/** How often the count is read again, ms. */
const COUNT_EVERY_MS = 5_000

export const useTvWatching = create<{ count: number }>(() => ({ count: 0 }))

interface Running {
  signer: Signer
  watchers: Watchers
  unsubscribe: () => void
  timers: number[]
  onVisible: () => void
}
let running: Running | null = null

function visible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

function recount(r: Running): void {
  useTvWatching.setState({ count: r.watchers.count(Date.now(), r.signer.pubkey) })
}

async function ping(r: Running): Promise<void> {
  if (!visible() || running !== r) return
  try {
    const ev = await r.signer.signEvent(pingTemplate(Math.floor(Date.now() / 1000)))
    if (running === r) await publish(ev)
  } catch { /* refused or offline: the count says this set alone */ }
}

/** The set came on: listen, say so, and count. */
export function startWatching(): void {
  if (running) return
  const r: Running = {
    signer: randomSigner(),
    watchers: new Watchers(),
    unsubscribe: () => {},
    timers: [],
    onVisible: () => { if (visible()) void ping(r) },
  }
  running = r
  r.unsubscribe = subscribe({ kinds: [WATCHING_KIND], since: Math.floor(Date.now() / 1000) - SKEW_S }, (ev) => {
    if (running === r && r.watchers.hear(ev, Date.now())) recount(r)
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
