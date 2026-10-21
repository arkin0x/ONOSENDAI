/**
 * broadcast.ts: Cyberspace TV as a 24/7 live stream (arkinox, 2026-10-21).
 *
 * The encoder on the Start9 box (the cyberspace-tv StartOS service) opens
 * /tv?broadcast=1 in a Chromium on a virtual 1280x720 display, captures the
 * screen and the sound, and pushes them to zap.stream, which forwards to
 * YouTube (@onosendaitv). Viewers on the site never pass the flag, so for
 * them nothing here changes anything.
 *
 * In broadcast mode (design note: onosendai/cyberspace-tv-broadcast-mode.md):
 *   - TV's close (X), RETRY, the mouse pointer and TAP FOR SOUND are hidden:
 *     nobody can tap a stream.
 *   - The music is always unmuted at full volume, whatever this browser has
 *     kept from a viewer (store/useTvMusic).
 *   - The set sends no "watching" ping and does not count itself
 *     (store/useTvWatching): stream viewers are counted by YouTube and
 *     zap.stream, not by us.
 *   - The HOSAKA spot plays every 15 minutes, not 5, and its end card says
 *     ONOSENDAI.TECH (lib/tv/hosakaAd; arkinox, 2026-10-21).
 *   - The pixel ratio is 1 (scene/Scene).
 *   - Each rendered TV frame adds one to window.__tvFrames, and each lost
 *     WebGL context to window.__tvCtxLost, for the encoder's watchdog.
 *   - A lost WebGL context not back within CONTEXT_WAIT_MS reloads the page,
 *     and so does TV going off (store/useTv): the stream is TV or nothing.
 *     Every reload goes to the address the page loaded on, so the flag
 *     stays, and reloads close together back off (reloadBroadcast).
 */

/** The query flag: /tv?broadcast=1. */
export const BROADCAST_PARAM = 'broadcast'

/** How long a lost WebGL context has to come back before the page reloads, ms. */
export const CONTEXT_WAIT_MS = 5_000

/** Whether an address asks for broadcast mode: /tv (or /tv/) with broadcast=1. */
export function parseBroadcast(pathname: string, search: string): boolean {
  if (!/^\/tv\/?$/i.test(pathname)) return false
  try {
    return new URLSearchParams(search).get(BROADCAST_PARAM) === '1'
  } catch {
    return false
  }
}

let mode: boolean | null = null
/** The address the broadcast loaded on, kept: TV's own history writes cannot take the flag away from a reload. */
let address = '/tv?broadcast=1'

/**
 * Whether this page is the broadcast. Read from the address the page was
 * loaded on, once: TV's own history writes cannot switch it on or off
 * halfway, and a reload of the same address keeps it.
 */
export function isBroadcast(): boolean {
  if (mode === null) {
    mode = typeof window !== 'undefined' && window.location !== undefined && parseBroadcast(window.location.pathname, window.location.search)
    if (mode) address = window.location.pathname + window.location.search
  }
  return mode
}

/** For tests: set broadcast mode, or (null) read it from the address again. */
export function setBroadcastForTest(on: boolean | null): void {
  mode = on
  reloading = false
  address = '/tv?broadcast=1'
}

/** Reloads remembered for the backoff, ms: those within this long ago count. */
export const RELOAD_WINDOW_MS = 10 * 60_000
/** Reloads within RELOAD_WINDOW_MS that go at once; each after waits twice as long as the last. */
export const RELOADS_FREE = 3
/** The longest a reload waits, ms. */
export const RELOAD_MAX_WAIT_MS = 5 * 60_000
const RELOADS_KEY = 'onosendai:tvBroadcastReloads'

/** How long the next reload waits, ms, after `recent` reloads within RELOAD_WINDOW_MS. */
export function reloadWait(recent: number): number {
  return recent < RELOADS_FREE ? 0 : Math.min(RELOAD_MAX_WAIT_MS, CONTEXT_WAIT_MS * 2 ** (recent - RELOADS_FREE))
}

let reloading = false

/**
 * Reload the broadcast on the address it loaded on. One that keeps failing
 * straight after its load does not reload every few seconds for good: past
 * RELOADS_FREE in RELOAD_WINDOW_MS it waits, longer each time (kept in
 * sessionStorage, which a reload keeps). Nothing outside broadcast mode.
 */
export function reloadBroadcast(go: (to: string) => void = (to) => window.location.replace(to), now: number = Date.now()): void {
  if (!isBroadcast() || reloading) return
  reloading = true
  let recent: number[] = []
  try {
    const kept = JSON.parse(sessionStorage.getItem(RELOADS_KEY) ?? '[]') as unknown
    if (Array.isArray(kept)) recent = kept.filter((t): t is number => typeof t === 'number' && now - t < RELOAD_WINDOW_MS)
  } catch { /* none kept: at once */ }
  const wait = reloadWait(recent.length)
  try { sessionStorage.setItem(RELOADS_KEY, JSON.stringify([...recent, now + wait])) } catch { /* the backoff is for this load only */ }
  setTimeout(() => go(address), wait)
}

/** What the encoder's watchdog reads, over CDP. */
interface Heartbeat {
  /** TV frames rendered since load. */
  __tvFrames?: number
  /** WebGL contexts lost since load. */
  __tvCtxLost?: number
}

function beat(): Heartbeat | null {
  return typeof window === 'undefined' ? null : (window as unknown as Heartbeat)
}

/** One TV frame rendered: the watchdog's heartbeat. Nothing outside broadcast mode. */
export function countTvFrame(): void {
  if (!isBroadcast()) return
  const w = beat()
  if (w) w.__tvFrames = (w.__tvFrames ?? 0) + 1
}

/** Mark the page, so the stylesheet can hide the pointer and keep the page to the window. */
export function markBroadcastPage(): void {
  if (!isBroadcast() || typeof document === 'undefined') return
  document.documentElement.classList.add('tv-broadcast')
}

/**
 * In broadcast mode, a lost WebGL context that has not come back within
 * `waitMs` reloads the page (reloadBroadcast: the same address): a frozen
 * picture with the music playing on is what the 30 minute freeze looked like
 * (2026-10-19). Each loss is also counted for the watchdog. Outside
 * broadcast mode it does nothing: a reload there could throw away what a
 * viewer was doing, so lib/glContext only says so in the console.
 *
 * Three's renderer already asks for the context back (it cancels the lost
 * event's default), so a restore within the wait is the usual end.
 */
export function recoverLostContext(
  canvas: HTMLCanvasElement,
  waitMs: number = CONTEXT_WAIT_MS,
  reload: () => void = () => reloadBroadcast(),
): () => void {
  if (!isBroadcast()) return () => {}
  let timer: ReturnType<typeof setTimeout> | null = null
  const lost = (): void => {
    const w = beat()
    if (w) w.__tvCtxLost = (w.__tvCtxLost ?? 0) + 1
    if (timer !== null) return
    timer = setTimeout(() => { timer = null; reload() }, waitMs)
  }
  const back = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  canvas.addEventListener('webglcontextlost', lost)
  canvas.addEventListener('webglcontextrestored', back)
  return () => {
    back()
    canvas.removeEventListener('webglcontextlost', lost)
    canvas.removeEventListener('webglcontextrestored', back)
  }
}
