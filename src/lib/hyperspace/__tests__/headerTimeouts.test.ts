/**
 * What would fail silently without these tests: a header download with no
 * timeout. A request the network drops without closing (a mobile link gone
 * mid-transfer, a stalled CDN edge) never settles, the sync waits on it
 * forever, and the hyperspace chip sits at LOADING or SYNCING near 100%
 * until a reload, with nothing in the console. Every case here uses a fake
 * fetch and fake timers; nothing touches the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256Hex } from 'cyberspace-core'
import { DownloadTimeoutError, fetchBytes, type DownloadLimits } from '../download'
import { MANIFEST_LIMITS, fetchManifest } from '../headerSync'
import { IDS, realBlob } from './mainnetHeaders'
import type { HeadersRequest, HeadersResponse } from '../../../workers/headers.worker'

const LIMITS: DownloadLimits = { deadlineMs: 60_000, stallMs: 10_000 }

/** A fetch that never answers, and gives up only when its signal aborts (as a real one does). */
function silentFetch(): typeof fetch {
  return ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })) as typeof fetch
}

/**
 * A response whose body delivers `chunks` and then, unless `end`, goes quiet
 * without closing: the transfer that stalls mid-stream. The stream errors
 * when the request's signal aborts, as a real fetch body does.
 */
function streamingFetch(chunks: Uint8Array[], end: boolean, onCall?: () => void): typeof fetch {
  return ((_url: string, init?: RequestInit) => {
    onCall?.()
    let i = 0
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason))
      },
      pull(controller) {
        if (i < chunks.length) controller.enqueue(chunks[i++])
        else if (end) controller.close()
        else return new Promise<void>(() => { /* stalled: never another byte */ })
      },
    })
    return Promise.resolve(new Response(body, { status: 200 }))
  }) as typeof fetch
}

/** A body that drips one chunk every `everyMs`, forever. */
function drippingFetch(everyMs: number): typeof fetch {
  return ((_url: string, init?: RequestInit) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          controller.error(init.signal?.reason)
        })
      },
      pull(controller) {
        return new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            controller.enqueue(new Uint8Array([1]))
            resolve()
          }, everyMs)
        })
      },
    })
    return Promise.resolve(new Response(body, { status: 200 }))
  }) as typeof fetch
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchBytes', () => {
  it('returns the whole body, chunks joined in order', async () => {
    const bytes = await fetchBytes('https://example.test/a', LIMITS, streamingFetch([new Uint8Array([1, 2]), new Uint8Array([3])], true))
    expect([...bytes]).toEqual([1, 2, 3])
  })

  it('gives up on a request that never answers once the stall window passes', async () => {
    const got = fetchBytes('https://example.test/a', LIMITS, silentFetch())
    const verdict = expect(got).rejects.toBeInstanceOf(DownloadTimeoutError)
    await vi.advanceTimersByTimeAsync(LIMITS.stallMs + 1)
    await verdict
  })

  it('gives up on a body that stops mid-stream, and not before the stall window', async () => {
    let settled = false
    const got = fetchBytes('https://example.test/a', LIMITS, streamingFetch([new Uint8Array(1000), new Uint8Array(1000)], false))
    got.then(() => { settled = true }, () => { settled = true })
    await vi.advanceTimersByTimeAsync(LIMITS.stallMs - 1)
    expect(settled).toBe(false)
    const verdict = expect(got).rejects.toThrow(/stalled/)
    await vi.advanceTimersByTimeAsync(2)
    await verdict
  })

  it('lets a slow but steady body run past the stall window, then stops it at the deadline', async () => {
    let settled = false
    const got = fetchBytes('https://example.test/a', LIMITS, drippingFetch(LIMITS.stallMs / 2))
    got.then(() => { settled = true }, () => { settled = true })
    await vi.advanceTimersByTimeAsync(LIMITS.stallMs * 3)
    expect(settled).toBe(false)
    const verdict = expect(got).rejects.toThrow(/no complete response/)
    await vi.advanceTimersByTimeAsync(LIMITS.deadlineMs)
    await verdict
  })

  it('settles even when the fetch ignores its signal', async () => {
    const deaf = (() => new Promise<Response>(() => { /* never */ })) as typeof fetch
    const got = fetchBytes('https://example.test/a', LIMITS, deaf)
    const verdict = expect(got).rejects.toBeInstanceOf(DownloadTimeoutError)
    await vi.advanceTimersByTimeAsync(LIMITS.stallMs + 1)
    await verdict
  })

  it('rejects an HTTP error as itself, not as a timeout', async () => {
    const notFound = (() => Promise.resolve(new Response('nope', { status: 404 }))) as typeof fetch
    await expect(fetchBytes('https://example.test/a', LIMITS, notFound)).rejects.toThrow(/HTTP 404/)
  })
})

const manifestJson = {
  formatVersion: 1,
  network: 'mainnet',
  blobSize: 50000,
  generatedAtHeight: 5,
  blobs: [{ ordinal: 0, startHeight: 0, count: 6, sha256: 'a'.repeat(64), file: 'headers-000.bin' }],
  checkpoints: [{ height: 5, blockHash: IDS[5] }],
}

describe('fetchManifest', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => { /* expected */ })
  })

  it('hands the sync to the relay (null) when the manifest request stalls, then recovers on the next try', async () => {
    vi.stubGlobal('fetch', silentFetch())
    const first = fetchManifest()
    await vi.advanceTimersByTimeAsync(MANIFEST_LIMITS.stallMs + 1)
    expect(await first).toBeNull()

    const body = new TextEncoder().encode(JSON.stringify(manifestJson))
    vi.stubGlobal('fetch', streamingFetch([body.subarray(0, 40), body.subarray(40)], true))
    const second = await fetchManifest()
    expect(second?.manifest.blobs[0].count).toBe(6)
  })

  it('returns null when the manifest body stalls halfway', async () => {
    const body = new TextEncoder().encode(JSON.stringify(manifestJson))
    vi.stubGlobal('fetch', streamingFetch([body.subarray(0, 40)], false))
    const got = fetchManifest()
    await vi.advanceTimersByTimeAsync(MANIFEST_LIMITS.stallMs + 1)
    expect(await got).toBeNull()
  })
})

describe('headers worker', () => {
  /** The worker module run in-process: its `self` is this stub. */
  async function loadWorker(): Promise<{ run: (req: HeadersRequest) => Promise<HeadersResponse[]> }> {
    const self = {
      onmessage: null as ((e: MessageEvent<HeadersRequest>) => Promise<void>) | null,
      posted: [] as HeadersResponse[],
      postMessage(msg: HeadersResponse) {
        this.posted.push(msg)
      },
    }
    vi.stubGlobal('self', self)
    vi.resetModules()
    await import('../../../workers/headers.worker')
    return {
      run: async (req) => {
        self.posted = []
        const done = self.onmessage!({ data: req } as MessageEvent<HeadersRequest>)
        // The stall timer only fires as fake time passes; walk it forward
        // until the worker reports done.
        for (let i = 0; i < 20 && !self.posted.some((m) => m.type === 'done'); i++) {
          await vi.advanceTimersByTimeAsync(10_000)
        }
        await done
        return self.posted
      },
    }
  }

  /** A Cache API stand-in that remembers what was put. */
  function fakeCaches(): Map<string, Uint8Array<ArrayBuffer>> {
    const store = new Map<string, Uint8Array<ArrayBuffer>>()
    const cache = {
      match: async (url: string) => (store.has(url) ? new Response(store.get(url)) : undefined),
      delete: async (url: string) => store.delete(url),
      put: async (url: string, res: Response) => {
        store.set(url, new Uint8Array(await res.arrayBuffer()))
      },
    }
    vi.stubGlobal('caches', { open: async () => cache })
    return store
  }

  it('discards a blob that stalls mid-download, caches none of it, and takes it whole on the retry', async () => {
    const blob = realBlob()
    const manifest = { ...manifestJson, blobs: [{ ...manifestJson.blobs[0], sha256: sha256Hex(blob) }] }
    const request: HeadersRequest = { type: 'sync', manifest: manifest as HeadersRequest['manifest'], manifestUrl: 'https://example.test/manifest.json' }
    const cached = fakeCaches()
    const worker = await loadWorker()

    // First sync: half the blob arrives, then nothing.
    vi.stubGlobal('fetch', streamingFetch([blob.subarray(0, 100)], false))
    const first = await worker.run(request)
    const failed = first.find((m) => m.type === 'blob-failed')
    expect(failed).toMatchObject({ type: 'blob-failed', startHeight: 0, count: 6 })
    expect(failed && 'reason' in failed ? failed.reason : '').toMatch(/stalled/)
    expect(first.some((m) => m.type === 'blob')).toBe(false)
    expect(first[first.length - 1]).toEqual({ type: 'done' })
    expect(cached.size).toBe(0)

    // The retry (the next sync): the whole blob, verified, delivered, cached.
    vi.stubGlobal('fetch', streamingFetch([blob.subarray(0, 100), blob.subarray(100)], true))
    const second = await worker.run(request)
    const delivered = second.find((m) => m.type === 'blob')
    expect(delivered && 'columns' in delivered ? delivered.columns.count : 0).toBe(6)
    expect(second.some((m) => m.type === 'blob-failed')).toBe(false)
    expect([...cached.values()][0]).toEqual(blob)
  })
})
