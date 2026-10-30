/**
 * standby.ts: the 24/7 stream (lib/tv/broadcast) when the page cannot draw
 * (arkinox, 2026-10-26: "after the "advertise here" the tv feed went black
 * but music kept playing").
 *
 * What the stream did, every hour or two: the GPU lost the page's WebGL
 * contexts; the streamer reloaded the page; and the page came back black,
 * twice, a minute each, the music playing on, before it drew again. Chromium
 * counts each WebGL context a page loses to the GPU (a reset, out of memory)
 * against the page's domain, and a domain with two or more such losses in
 * two minutes is refused WebGL until they are two minutes old
 * (content/browser/gpu/gpu_data_manager_impl_private.cc,
 * Are3DAPIsBlockedAtTime; a context the page lets go of itself, as three's
 * forceContextLoss does, is not counted). TV holds three at once (the world,
 * the segment's turning shard, the labels' glyphs), so one reset was three
 * losses and two minutes with no WebGL. Refused, three throws "Error
 * creating WebGL context.", nothing caught it, and React took the whole page
 * down: black, while TV's music, outside React, played on.
 *
 * Now, in broadcast mode only (scene/TvStandby), a page that cannot draw
 * stands by: TV's own NO SIGNAL card in place of the picture, the music on
 * under it, and window.__tvStandby set for the streamer's watchdog. It asks
 * for WebGL again every STANDBY_PROBE_MS and reloads the moment it is given
 * (reloadBroadcast), rather than waiting for the streamer's next reload a
 * minute on. Any other crash stands by the same way and reloads at once
 * (with reloadBroadcast's backoff): a stream never shows a crash note
 * nobody can tap.
 */

import { reloadBroadcast } from './broadcast'

/** How often a page standing by asks for WebGL again, ms. */
export const STANDBY_PROBE_MS = 5_000

/** Why the page is standing by: WebGL refused, or something else crashed. */
export type StandbyReason = 'webgl' | 'crash'

/** What the encoder's watchdog can read, over CDP: set while the page stands by, with when it began (ms since the epoch). */
export interface Standby {
  reason: StandbyReason
  since: number
  /** The error's message, for the streamer's log. */
  message: string
}

/** Whether a render error is WebGL refused: three's words for a canvas that gave no context, or the browser's own. */
export function isWebglRefused(error: unknown): boolean {
  const m = error instanceof Error ? error.message : String(error)
  return /creating webgl context|webgl.*(not supported|unavailable|blocked)|context loss and was blocked/i.test(m)
}

/**
 * Whether this page can have a WebGL context now: one is asked for on a
 * canvas of its own and let go of at once. Letting go is the page's own
 * doing (WEBGL_lose_context), which Chromium does not count against the
 * domain, so asking never prolongs a refusal.
 */
export function webglAvailable(make: () => HTMLCanvasElement = () => document.createElement('canvas')): boolean {
  try {
    const c = make()
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

function heartbeat(): { __tvStandby?: Standby } | null {
  return typeof window === 'undefined' ? null : (window as unknown as { __tvStandby?: Standby })
}

/**
 * Stand by for `error`: say so to the watchdog, then reload, at once for a
 * crash, or the moment WebGL is given again for a refusal. The stop.
 */
export function standBy(
  error: unknown,
  reload: () => void = () => reloadBroadcast(),
  probe: () => boolean = webglAvailable,
  every: number = STANDBY_PROBE_MS,
  now: number = Date.now(),
): () => void {
  const reason: StandbyReason = isWebglRefused(error) ? 'webgl' : 'crash'
  const w = heartbeat()
  if (w) w.__tvStandby = { reason, since: now, message: error instanceof Error ? error.message : String(error) }
  if (reason === 'crash') {
    reload()
    return () => {}
  }
  const timer = setInterval(() => {
    if (!probe()) return
    clearInterval(timer)
    reload()
  }, every)
  return () => clearInterval(timer)
}
