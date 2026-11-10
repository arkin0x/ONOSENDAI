/**
 * seeds.worker.ts - Seeds (DECK-0008) off the main thread: blooms grown and
 * drawn, and header times read out of a header blob (lib/seeds/growJob.ts).
 *
 * Growing is the reader's compute, bounded by the DNA's caps (§7, §12), and
 * must never stop a frame: everything here runs in this one worker, a slice
 * at a time (bloomBudget SLICE_STEPS), and geometry goes back as transferred
 * buffers. A blob's bytes come from the same Cache API entry the header sync
 * fills (headers.worker.ts), checked against the manifest's sha256, else
 * from the network.
 */

import { GrowCache, handleBlobTimes, handleGrow, type SeedsRequest } from '../lib/seeds/growJob'
import { fetchBytes } from '../lib/hyperspace/download'

const cache = new GrowCache()
/** The header sync's cache (headers.worker.ts CACHE_NAME). */
const HEADERS_CACHE = 'onosendai:headers-v1'

async function digestHex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function loadBlob(url: string, sha256: string): Promise<Uint8Array> {
  const store = typeof caches === 'undefined' ? null : await caches.open(HEADERS_CACHE).catch(() => null)
  if (store) {
    const hit = await store.match(url).catch(() => undefined)
    if (hit) {
      const bytes = new Uint8Array(await hit.arrayBuffer())
      if ((await digestHex(bytes)) === sha256) return bytes
    }
  }
  const bytes = await fetchBytes(url, { deadlineMs: 5 * 60_000, stallMs: 30_000 })
  if ((await digestHex(bytes)) !== sha256) throw new Error('blob bytes do not match the manifest sha256')
  if (store) await store.put(url, new Response(bytes)).catch(() => undefined)
  return bytes
}

self.onmessage = async (event: MessageEvent<SeedsRequest>): Promise<void> => {
  const req = event.data
  if (req.type === 'forget') { cache.forget(req.keys); return }
  const { answer, transfer } = req.type === 'grow' ? handleGrow(req, cache) : await handleBlobTimes(req, loadBlob)
  self.postMessage(answer, { transfer })
}
