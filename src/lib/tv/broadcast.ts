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
 *   - WWW.ONOSENDAI.TECH stands under the clock, top right, for good, so a
 *     viewer always knows where to go (BROADCAST_TAG; scene/tvPainter;
 *     arkinox, 2026-10-22), and over the HOSAKA spot too, top right in the
 *     band the spot keeps clear, across from ADVERTISEMENT.
 *   - The pixel ratio is the capture's, 1 to 1.5 (broadcastDpr; scene/Scene):
 *     1 for the 1280x720 and 720x720 captures, 1.5 for the 1080x1080 one,
 *     which is the 720x720 layout drawn sharp rather than stretched.
 *   - In a square frame, a segment's panel, as wide as the frame there,
 *     keeps under the minimap as it does under the address (scene/tvPainter).
 *   - Everything TV writes on the picture can be set larger for the
 *     stream (text=large or text=xl; BROADCAST_TEXT, broadcastText): a 16:9
 *     stream on a phone held upright is about 400 px wide, a fifth of the
 *     1920 px frame, and the normal sizes are unreadable there (arkinox,
 *     2026-10-23). Laid out again for it in scene/tvPainter. Off the stream
 *     the flag is ignored.
 *   - Each rendered TV frame adds one to window.__tvFrames, and each lost
 *     WebGL context to window.__tvCtxLost, for the encoder's watchdog.
 *   - A lost WebGL context not back within CONTEXT_WAIT_MS reloads the page,
 *     and so does TV going off (store/useTv): the stream is TV or nothing.
 *     Every reload goes to the address the page loaded on, so the flag
 *     stays, and reloads close together back off (reloadBroadcast).
 *   - A page that cannot draw (WebGL refused after the GPU lost the page's
 *     contexts, or any render error) stands by: NO SIGNAL in place of a
 *     black page, window.__tvStandby set for the watchdog, and a reload as
 *     soon as WebGL is given again (lib/tv/standby, hud/TvStandby;
 *     arkinox, 2026-10-26).
 *   - A second, upright stream (layout=portrait; BROADCAST_LAYOUT,
 *     isPortraitBroadcast): the same TV laid out for a 720 x 1280 frame
 *     (PORTRAIT_FRAME), for YouTube's vertical live, which a phone shows
 *     full screen (arkinox, 2026-10-30). The streamer opens it in a window
 *     of its own, beside the 16:9 one. Everything it changes is behind the
 *     flag: the 16:9 stream and the site are as they were.
 *     scene/tvPainter stacks NOW PLAYING over the chiron, puts LATER and a
 *     segment's panel in the tall middle, and an explainer's captions in
 *     the band under its video; scene/Scene widens the camera's angle so
 *     the world fills the tall frame (portraitFov). The sizes are the 16:9
 *     stream's for the same share of the frame's width (broadcastScale),
 *     so a phone showing the upright frame full width reads them as it
 *     reads the 16:9 one held upright; hud/TvStandby's NO SIGNAL, sized to
 *     the frame's width, already does.
 */

/** The query flag: /tv?broadcast=1. */
export const BROADCAST_PARAM = 'broadcast'

/** The stream's address, on the picture for good (arkinox, 2026-10-22: exactly this). */
export const BROADCAST_TAG = 'WWW.ONOSENDAI.TECH'

/** The most pixels per CSS pixel the stream draws at: the 1080x1080 capture's (arkinox, 2026-10-22). */
export const BROADCAST_MAX_DPR = 1.5

/** The stream's pixel ratio: the capture's own, from 1 to BROADCAST_MAX_DPR, so its cost stays known. */
export function broadcastDpr(device: number = typeof window === 'undefined' ? 1 : window.devicePixelRatio): number {
  return Number.isFinite(device) && device > 1 ? Math.min(BROADCAST_MAX_DPR, device) : 1
}

/** The query naming the stream's text size: /tv?broadcast=1&text=large. */
export const BROADCAST_TEXT_PARAM = 'text'

/**
 * Each text size the stream can ask for, as a factor on every size TV paints
 * its words and panels at in the 1920 x 1080 frame (TEXT_FRAME_PX). Large is
 * the smallest that reads on a phone held upright: a comment's words 9 px
 * tall to the top of a capital with that frame shown 400 px wide.
 */
export const BROADCAST_TEXT = { normal: 1, large: 2.25, xl: 2.6 } as const
export type BroadcastTextSize = keyof typeof BROADCAST_TEXT

/** The text size an address asks for; normal for none or one not known. */
export function parseBroadcastText(search: string): BroadcastTextSize {
  try {
    const v = new URLSearchParams(search).get(BROADCAST_TEXT_PARAM)
    return v !== null && Object.prototype.hasOwnProperty.call(BROADCAST_TEXT, v) ? (v as BroadcastTextSize) : 'normal'
  } catch {
    return 'normal'
  }
}

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

/** The query naming the stream's frame: /tv?broadcast=1&layout=portrait. */
export const BROADCAST_LAYOUT_PARAM = 'layout'

/**
 * The frames the stream can be laid out for: the 16:9 one, which is the
 * default and what every address without the query gets, and the upright
 * 9:16 one (arkinox, 2026-10-30).
 */
export const BROADCAST_LAYOUT = ['landscape', 'portrait'] as const
export type BroadcastLayout = (typeof BROADCAST_LAYOUT)[number]

/** The upright stream's frame, CSS px at a pixel ratio of 1: what the streamer's window for it is. */
export const PORTRAIT_FRAME = { width: 720, height: 1280 } as const

/** The frame an address asks for; landscape for none or one not known. */
export function parseBroadcastLayout(search: string): BroadcastLayout {
  try {
    return new URLSearchParams(search).get(BROADCAST_LAYOUT_PARAM) === 'portrait' ? 'portrait' : 'landscape'
  } catch {
    return 'landscape'
  }
}

let mode: boolean | null = null
let text: BroadcastTextSize = 'normal'
let layout: BroadcastLayout = 'landscape'
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
    if (mode) {
      address = window.location.pathname + window.location.search
      text = parseBroadcastText(window.location.search)
      layout = parseBroadcastLayout(window.location.search)
    }
  }
  return mode
}

/**
 * The factor on TV's sizes the stream asked for (BROADCAST_TEXT), read with
 * the flag from the address the page loaded on; 1 off the stream, whatever
 * the address says.
 */
export function broadcastText(): number {
  return isBroadcast() ? BROADCAST_TEXT[text] : 1
}

/**
 * Whether this page is the upright stream (layout=portrait), read with the
 * flag from the address the page loaded on: false off the stream, whatever
 * the address says, and false for the 16:9 stream.
 */
export function isPortraitBroadcast(): boolean {
  return isBroadcast() && layout === 'portrait'
}

/**
 * The camera's vertical angle, degrees, on the upright stream: wide enough
 * that its angle across is `fov`, the angle the 16:9 stream has from top to
 * bottom, so a shot's subject spans the narrow frame's width as it spans the
 * wide frame's height, and the tall frame shows more of the world above and
 * below it rather than cropping it at the sides. `aspect` is width over
 * height; at 1 or wider, `fov` as it is.
 */
export function portraitFov(fov: number, aspect: number): number {
  if (!(aspect > 0) || aspect >= 1 || !(fov > 0)) return fov
  const half = (fov * Math.PI) / 360
  return (Math.atan(Math.tan(half) / aspect) * 360) / Math.PI
}

/** The frame width, CSS px, BROADCAST_TEXT's factors are set for: the Wide 1080p capture's. */
export const TEXT_FRAME_PX = 1920

/**
 * The factor on something TV draws `px` CSS px big in a frame `frameW` CSS px
 * wide, and `refPx` in a TEXT_FRAME_PX frame, for the text size the stream
 * asked for: it takes the share of the frame's width there that the factor
 * gives it at 1080p, so a size reads the same on a phone whatever the
 * capture (a square frame's words are already a larger share of it). Never
 * below 1: the stream's words are never smaller than the site's. 1 off the
 * stream.
 */
export function broadcastScale(px: number, frameW: number, refPx: number = px): number {
  const k = broadcastText()
  if (k === 1 || !(px > 0) || !(frameW > 0)) return 1
  return Math.max(1, (k * refPx) / TEXT_FRAME_PX / (px / frameW))
}

/** For tests: set broadcast mode, or (null) read it from the address again. */
export function setBroadcastForTest(on: boolean | null, size: BroadcastTextSize = 'normal', frame: BroadcastLayout = 'landscape'): void {
  mode = on
  text = size
  layout = frame
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
