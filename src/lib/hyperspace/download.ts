/**
 * download.ts: a fetch that cannot hang.
 *
 * fetch has no timeout of its own. A request the network silently drops (a
 * mobile link that went away mid-transfer, a captive portal, a stalled CDN
 * edge) leaves its promise pending forever, and the header sync awaited it:
 * the hyperspace chip sat at LOADING or SYNCING near 100% until a reload.
 *
 * Two guards, both of which end in an ordinary rejection the callers already
 * turn into their fallback (the relay sync):
 *
 * | Guard | Fires when | Catches |
 * |---|---|---|
 * | deadline | the whole transfer, headers and body, is not done in time | a link too slow to ever finish |
 * | stall | no response, or no next chunk of the body, for a while | a dead transfer, long before a deadline sized for slow links |
 *
 * Bytes are only returned once the body has ended, so an aborted transfer
 * never hands anyone a partial buffer to verify or cache. Worker-safe: no
 * DOM, only fetch, AbortController, streams and timers.
 */

export class DownloadTimeoutError extends Error {
  override name = 'DownloadTimeoutError'
}

export interface DownloadLimits {
  /** The whole transfer, headers and body, in milliseconds. */
  deadlineMs: number
  /** The longest wait for the response, or for the next chunk of its body. */
  stallMs: number
}

const seconds = (ms: number): string => `${Math.round(ms / 1000)} s`

/** The bytes at `url`, or a rejection: HTTP error, network error, deadline or stall. */
export async function fetchBytes(url: string, limits: DownloadLimits, fetchImpl: typeof fetch = fetch): Promise<Uint8Array<ArrayBuffer>> {
  const controller = new AbortController()
  let timedOut: DownloadTimeoutError | null = null
  const abort = (why: string): void => {
    if (timedOut) return
    timedOut = new DownloadTimeoutError(`${why} (${url})`)
    controller.abort(timedOut)
  }
  // The signal ends the request on any conforming fetch; racing it as well
  // settles the wait even where a fetch or a body read ignores the signal.
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(timedOut), { once: true })
  })
  aborted.catch(() => { /* observed by the races below */ })
  const deadline = setTimeout(() => abort(`no complete response after ${seconds(limits.deadlineMs)}`), limits.deadlineMs)
  let stall: ReturnType<typeof setTimeout> | undefined
  const armStall = (): void => {
    clearTimeout(stall)
    stall = setTimeout(() => abort(`stalled, nothing received for ${seconds(limits.stallMs)}`), limits.stallMs)
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  try {
    armStall()
    const res = await Promise.race([fetchImpl(url, { signal: controller.signal }), aborted])
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
    if (!res.body) {
      // No stream to watch for progress: the deadline alone bounds it.
      clearTimeout(stall)
      return new Uint8Array(await Promise.race([res.arrayBuffer(), aborted]))
    }
    reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    for (;;) {
      armStall()
      const { done, value } = await Promise.race([reader.read(), aborted])
      if (done) break
      chunks.push(value)
      length += value.byteLength
    }
    const bytes = new Uint8Array(length)
    let at = 0
    for (const chunk of chunks) {
      bytes.set(chunk, at)
      at += chunk.byteLength
    }
    return bytes
  } catch (err) {
    // Release the connection; the abort already does on a conforming fetch.
    reader?.cancel().catch(() => { /* already errored */ })
    throw timedOut ?? err
  } finally {
    clearTimeout(deadline)
    clearTimeout(stall)
  }
}
