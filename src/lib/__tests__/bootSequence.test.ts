/**
 * bootSequence.test.ts: what runs before the app's code loads, and that none
 * of it holds the first paint (arkinox, 2026-11-22: "its like 8 seconds til
 * something is painted besides a black screen").
 *
 * - index.html paints the wordmark inside #root with no script at all, so the
 *   first paint never waits on a script, a database, a relay or a signer.
 * - main.tsx awaits nothing at the top: it hands the steps to runBoot.
 * - runBoot starts the kv read and the signer pref repair together, loads the
 *   app once both are done, and never waits on a repair past its cap.
 * - a repair's write waits for the kv step, and a repair that ends after the
 *   app loaded writes nothing (the #888 lock never shows wrongly, and a late
 *   write never lands under a store that has already read the pref).
 * - boot.tsx's first draw does not wait on the workshop (except on /workshop).
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { runBoot } from '../bootSequence'

const ROOT = path.resolve(__dirname, '../../..')
const SRC = path.join(ROOT, 'src')

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve() }

describe('the first paint', () => {
  it('index.html paints the wordmark in #root before any script runs', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    const root = html.match(/<div id="root">([\s\S]*?)<\/div><\/div>/)
    expect(root).not.toBeNull()
    expect(root![1]).toMatch(/class="boot-shell"/)
    expect(root![1]).toMatch(/<img src="\/logo.png"/)
    expect(root![1]).not.toMatch(/<script/)
    // Its style is inline, before the shell, never a stylesheet that would have to load first.
    expect(html.indexOf('.boot-shell {')).toBeGreaterThan(0)
    expect(html.indexOf('.boot-shell {')).toBeLessThan(html.indexOf('<div id="root">'))
    // The app's module is the only script after it, and it is a module (deferred: never holds the parser).
    expect(html).toMatch(/<script type="module" src="\/src\/main.tsx"><\/script>/)
  })

  it('main.tsx awaits nothing at the top level and loads the app through runBoot', () => {
    const main = fs.readFileSync(path.join(SRC, 'main.tsx'), 'utf8')
    const code = main.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/^\s*await\b/m)
    expect(code).toMatch(/void runBoot\(\{/)
    expect(code).toMatch(/loadApp: \(\) => import\('\.\/boot'\)/)
  })

  it("boot.tsx's first draw waits on the chain and the hidden record, and on the workshop only at /workshop", () => {
    const boot = fs.readFileSync(path.join(SRC, 'boot.tsx'), 'utf8')
    const gate = boot.match(/void Promise\.allSettled\(\[([\s\S]*?)\]\)\.then\(draw, draw\)/)
    expect(gate).not.toBeNull()
    expect(gate![1]).toMatch(/hydrateHidden\(\)/)
    expect(gate![1]).toMatch(/chainReadyToDraw\(\)/)
    expect(gate![1]).not.toMatch(/hydrateWorkshop\(\)/)
    expect(gate![1]).toMatch(/isWorkshopPath\(location\.pathname\) \? \[readWorkshop\(\)\] : \[\]/)
    // The cap on every wait stays.
    expect(boot).toMatch(/setTimeout\(draw, HYDRATE_WAIT_MS\)/)
  })
})

describe('runBoot', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('starts the kv read and the repair together, and loads the app once both are done', async () => {
    const kv = deferred(), rep = deferred()
    const order: string[] = []
    const loadApp = vi.fn(async () => { order.push('app') })
    void runBoot({
      hydrate: () => { order.push('kv'); return kv.promise },
      repair: () => { order.push('repair'); return rep.promise },
      loadApp,
    })
    await flush()
    expect(order).toEqual(['kv', 'repair'])
    kv.resolve()
    await flush()
    expect(loadApp).not.toHaveBeenCalled()
    rep.resolve()
    await flush()
    expect(order).toEqual(['kv', 'repair', 'app'])
  })

  it('a repair that never ends holds the app only its cap past the kv step, then is told it is late', async () => {
    const kv = deferred()
    let late: () => boolean = () => false
    const loadApp = vi.fn(async () => undefined)
    void runBoot({ hydrate: () => kv.promise, repair: (l) => { late = l; return new Promise(() => undefined) }, loadApp }, 2_000)
    await flush()
    // The cap counts from the kv step: a slow kv read leaves the repair its whole time after it.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(loadApp).not.toHaveBeenCalled()
    expect(late()).toBe(false)
    kv.resolve()
    await flush()
    await vi.advanceTimersByTimeAsync(1_999)
    expect(loadApp).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await flush()
    expect(loadApp).toHaveBeenCalledTimes(1)
    expect(late()).toBe(true)
  })

  it('a failed step never stops the app from loading', async () => {
    const loadApp = vi.fn(async () => undefined)
    await runBoot({ hydrate: () => Promise.reject(new Error('no db')), repair: () => Promise.reject(new Error('no chunk')), loadApp })
    expect(loadApp).toHaveBeenCalledTimes(1)
  })

  it('hands the repair the kv step, so its writes can wait for room', async () => {
    const kv = deferred()
    let writable: Promise<unknown> | null = null
    void runBoot({ hydrate: () => kv.promise, repair: (_l, w) => { writable = w; return Promise.resolve() }, loadApp: async () => undefined })
    await flush()
    let settled = false
    void writable!.then(() => { settled = true })
    await flush()
    expect(settled).toBe(false)
    kv.resolve()
    await flush()
    expect(settled).toBe(true)
  })
})

describe('the repair beside the kv read (lib/signerPrefRepair.ts)', () => {
  const mem = new Map<string, string>()
  beforeEach(() => {
    mem.clear()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, String(v)) },
      removeItem: (k: string) => { mem.delete(k) },
      clear: () => mem.clear(),
      key: (i: number) => [...mem.keys()][i] ?? null,
      get length() { return mem.size },
    }
    ;(globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory()
    vi.resetModules()
  })

  /** The owner's case: a pref naming his key with nothing beside it, and his bunker session in the identities store. */
  async function bunkerCase(): Promise<string> {
    const pubkey = getPublicKey(generateSecretKey())
    const row = { pubkey, kind: 'nip46', bunker: { bunkerUri: `bunker://${'b'.repeat(64)}?relay=wss://relay.test` }, firstHeld: 1, lastUsed: 2 }
    const { openDatabase } = await import('../idb')
    const { IDENTITIES_DB, DB_VERSION, IDENTITIES_STORE } = await import('../identitiesDb')
    const d = await openDatabase(IDENTITIES_DB, DB_VERSION, [[IDENTITIES_STORE, 'pubkey']])
    await new Promise<void>((resolve, reject) => { const tx = d.transaction(IDENTITIES_STORE, 'readwrite'); tx.objectStore(IDENTITIES_STORE).put(row); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
    d.close()
    mem.set('onosendai:signer', JSON.stringify({ kind: 'local', pubkey }))
    return pubkey
  }

  it('reads at once but writes the bunker pref only once the kv step is done', async () => {
    vi.useRealTimers()
    const pubkey = await bunkerCase()
    const { repairSignerPref } = await import('../signerPrefRepair')
    const kv = deferred()
    const done = repairSignerPref(1500, () => false, kv.promise)
    await new Promise((r) => setTimeout(r, 50))
    expect(JSON.parse(mem.get('onosendai:signer')!).kind).toBe('local')
    kv.resolve()
    expect(await done).toBe('bunker')
    expect(JSON.parse(mem.get('onosendai:signer')!)).toMatchObject({ kind: 'nip46', pubkey })
  })

  it('writes nothing once the app has loaded without it', async () => {
    vi.useRealTimers()
    await bunkerCase()
    const before = mem.get('onosendai:signer')
    const { repairSignerPref } = await import('../signerPrefRepair')
    expect(await repairSignerPref(1500, () => true)).toBe('kept')
    expect(mem.get('onosendai:signer')).toBe(before)
  })

  it('leaves a pref that changed while it waited', async () => {
    vi.useRealTimers()
    await bunkerCase()
    const { repairSignerPref } = await import('../signerPrefRepair')
    const kv = deferred()
    const done = repairSignerPref(1500, () => false, kv.promise)
    await new Promise((r) => setTimeout(r, 50))
    const other = JSON.stringify({ kind: 'extension', pubkey: getPublicKey(generateSecretKey()) })
    mem.set('onosendai:signer', other)
    kv.resolve()
    expect(await done).toBe('kept')
    expect(mem.get('onosendai:signer')).toBe(other)
  })
})
