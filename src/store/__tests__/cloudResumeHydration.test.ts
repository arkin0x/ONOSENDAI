/**
 * cloudResumeHydration.test.ts - a paid HOSAKA job kept across a reload of a
 * chain localStorage outgrew is never thrown away for the old head in hand
 * (perf review 2026-11-04; the reviewer's probe made a test).
 *
 * When the chain grows past what localStorage holds, saves there fail and
 * only IndexedDB keeps the whole chain (lib/chainDb.ts). A load first draws
 * the old stretch localStorage kept, then takes in IndexedDB's copy
 * (hydrateChain). App.tsx calls resumeCloudJob at mount, at once, so its
 * head check compared the job's bound head against that old stretch's head
 * and dropped a paid record whose head was in fact the chain's. Now the
 * check waits for the saved chain; and when IndexedDB does not answer, the
 * record is kept and the words say so, since nothing proves the head moved.
 * Hops and rides alike. A record whose head the whole chain has moved past
 * is still dropped. While the resume waits, the record is in hand as
 * CHECKING, and every flow that starts a paid job refuses while a kept
 * record is on disk: a ride tapped in that wait was submitted and its record
 * replaced the paid one (review of #598; the reviewer's probe made a test).
 * Nothing reaches the network (HOSAKA faked, relays mocked).
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The chain key's largest value, in characters, before setItem throws as a full browser does. */
const quota = vi.hoisted(() => ({ chainChars: Infinity }))
const { storage, fake } = vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage: Storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => {
      if (k.startsWith('onosendai:chain:') && String(v).length > quota.chainChars) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      m.set(k, String(v))
    },
  }
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
  // HOSAKA, still computing: a job that got past the head check is followed and never ends here.
  const pending = (): Promise<never> => new Promise(() => {})
  const fake = {
    apiUrl: 'http://fake', limits: vi.fn(async () => null), quote: vi.fn(), submitHop: vi.fn(), submitSidestep: vi.fn(), submitRide: vi.fn(),
    getJob: vi.fn(pending), startJob: vi.fn(), claimDeposit: vi.fn(pending), balance: vi.fn(pending), deposit: vi.fn(), waitForDeposit: vi.fn(pending),
    waitForJob: vi.fn(pending), provider: vi.fn(async () => null), rideQuote: vi.fn(),
  }
  return { storage, fake }
})

vi.mock('../../lib/hosaka', async (o) => ({ ...(await o<typeof import('../../lib/hosaka')>()), createHosaka: () => fake }))
vi.mock('../../lib/workers', async (o) => ({ ...(await o<typeof import('../../lib/workers')>()), postProof: vi.fn(), cancelProof: vi.fn() }))
vi.mock('../../lib/chains', async (o) => ({ ...(await o<typeof import('../../lib/chains')>()), fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async () => []), askChainEvents: vi.fn(async () => []) }))
vi.mock('../../lib/relay', async (o) => {
  const a = await o<typeof import('../../lib/relay')>()
  const { offlineRelay } = await import('../../test/offlineRelay')
  return { ...a, ...offlineRelay, publish: async () => ({ ok: true as const, accepted: [a.CYBERSPACE_RELAY] }), publishMany: async () => ({ ok: true as const, accepted: [a.CYBERSPACE_RELAY] }) }
})

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { hopTemplate, positionHex, spawnTemplate, type NostrEvent } from '../../lib/events'
import type { PendingCloudJob } from '../../lib/cloud'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const home = coordToXyz(hexToCoord(pk))
const at = (dx: bigint): { x: bigint; y: bigint; z: bigint } => ({ x: home.x + dx, y: home.y, z: home.z })
const sign = (t: Parameters<typeof finalizeEvent>[0]): NostrEvent => ({ ...finalizeEvent(t, sk) }) as NostrEvent

/** Where each action of the chain stands. */
const placeOf = new Map<string, { x: bigint; y: bigint; z: bigint }>()

/** A spawn and n - 1 hops, the k-th to x + k. */
function chainOf(n: number): NostrEvent[] {
  const out = [sign(spawnTemplate(pk, 1_000))]
  for (let k = 1; k < n; k++) {
    const prev = out[k - 1]
    const to = at(BigInt(k))
    const e = sign(hopTemplate({
      createdAt: 1_000 + k * 10, genesisId: out[0].id, previousId: prev.id,
      prevCoordHex: k === 1 ? pk : positionHex(placeOf.get(prev.id)!, home.plane),
      to, plane: home.plane, proofHash: '0'.repeat(64), mn: '0'.repeat(16), mp: '00',
    }))
    placeOf.set(e.id, to)
    out.push(e)
  }
  return out
}

const FULL = 40
/** What localStorage kept before it filled up: the owner's 1,133 of 1,308, scaled down. */
const KEPT = 25
const chain = chainOf(FULL)
const head = chain[FULL - 1]
const ids = (events: NostrEvent[]): string[] => events.map((e) => e.id)
const storedJson = (n: number): string => JSON.stringify({ version: 2, events: chain.slice(0, n), published: ids(chain.slice(0, n)), stats: {} })

/** An IndexedDB whose open never answers. */
function silentDb(real: IDBFactory): IDBFactory {
  return {
    open(name: string, version?: number) {
      const req = real.open(name, version)
      Object.defineProperty(req, 'onsuccess', { configurable: true, get: () => null, set: () => {} })
      return req
    },
    deleteDatabase: real.deleteDatabase.bind(real),
    cmp: real.cmp.bind(real),
    databases: real.databases.bind(real),
  } as unknown as IDBFactory
}

/** IndexedDB as an earlier visit left it: the whole chain. */
async function keepWholeInDb(): Promise<void> {
  vi.resetModules()
  const db = await import('../../lib/chainDb')
  db.writeStoredChain(pk, { events: chain, published: ids(chain), stats: {}, held: false, savedAt: Date.now() })
  await db.chainWritesSettled()
  db.closeChainDb()
}

/** The paid job record for `action`, bound to `prev`. */
async function keepJob(action: 'hop' | 'ride', prev: NostrEvent): Promise<PendingCloudJob> {
  const cloud = await import('../../lib/cloud')
  const rec: PendingCloudJob = {
    version: 1, jobId: `paid${action}1`, pollToken: 'tok', action, pubkey: pk,
    from: cloud.wirePosition(placeOf.get(prev.id)!), to: cloud.wirePosition(at(BigInt(FULL) << 20n)), plane: home.plane,
    prevEventId: prev.id, costMsats: 21_000, createdAt: Date.now(), stage: 'computing', deposit: null,
    ...(action === 'ride' ? { ride: { fromHeight: 100, toHeight: 105, toCoordHex: 'cd'.repeat(32) } } : {}),
  }
  cloud.saveCloudJob(rec)
  expect(cloud.loadCloudJob(pk)?.jobId).toBe(rec.jobId)
  return rec
}

/** A page load over the same storage, reads waiting at most `patienceMs`. */
async function pageLoad(patienceMs = 3_000): Promise<typeof import('../useCyberspace')> {
  vi.resetModules()
  ;(await import('../../lib/chainDb')).setChainReadPatience(patienceMs)
  return import('../useCyberspace')
}

const settle = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms))
const recordNow = async (): Promise<PendingCloudJob | null> => (await import('../../lib/cloud')).loadCloudJob(pk)

beforeEach(() => {
  storage.clear()
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
  storage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
  storage.setItem('onosendai:live', '0')
  // Room for the KEPT actions and no more, as on the owner's phone.
  quota.chainChars = storedJson(KEPT).length + 2_000
  storage.setItem(`onosendai:chain:${pk}`, storedJson(KEPT))
})

describe('a paid cloud job across a reload of a chain localStorage outgrew', () => {
  for (const action of ['hop', 'ride'] as const) {
    it(`a ${action} resumed at mount, before IndexedDB answers, is checked against the whole chain and followed`, async () => {
      await keepWholeInDb()
      const rec = await keepJob(action, head)
      const m = await pageLoad()
      const S = m.useCyberspace.getState
      // The old stretch is what is in hand at mount: the head the bug compared against.
      expect(S().events).toHaveLength(KEPT)
      expect(S().prevEventId).not.toBe(head.id)
      // As App.tsx's mount effect does, at once.
      void S().resumeCloudJob()
      await m.savedChainLoaded()
      await settle()
      expect(S().prevEventId).toBe(head.id)
      expect((await recordNow())?.jobId).toBe(rec.jobId)
      expect(S().cloud.message ?? '').not.toMatch(/dropped/)
      expect(S().cloud.job?.jobId).toBe(rec.jobId)
      expect(S().proof.status).toBe('computing')
      expect(fake.waitForJob).toHaveBeenCalledWith(rec.jobId, 'tok', expect.anything())
    }, 20_000)
  }

  it('when IndexedDB never answers, the record is kept and the words say so: nothing proves the head moved', async () => {
    await keepWholeInDb()
    const rec = await keepJob('hop', head)
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = silentDb(new IDBFactory())
    const m = await pageLoad(150)
    const S = m.useCyberspace.getState
    await S().resumeCloudJob()
    expect(S().prevEventId).not.toBe(head.id)
    expect((await recordNow())?.jobId).toBe(rec.jobId)
    expect(S().cloud.job?.jobId).toBe(rec.jobId)
    expect(S().cloud.message).toMatch(/kept/)
    expect(S().cloud.message).not.toMatch(/dropped/)
    expect(S().proof.status).not.toBe('computing')
  }, 20_000)

  it('a record whose head the whole chain has moved past is still dropped', async () => {
    await keepWholeInDb()
    await keepJob('hop', chain[30])
    const m = await pageLoad()
    const S = m.useCyberspace.getState
    await S().resumeCloudJob()
    await m.savedChainLoaded()
    expect(S().prevEventId).toBe(head.id)
    expect(await recordNow()).toBeNull()
    expect(S().cloud.message).toMatch(/dropped: the chain head moved/)
  }, 20_000)

  it('a ride tapped while the resume waits for the saved chain is refused, and the paid record stays', async () => {
    await keepWholeInDb()
    const rec = await keepJob('hop', head)
    // A slow IndexedDB: the read takes its full patience, as on a busy phone.
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = silentDb(new IDBFactory())
    const m = await pageLoad(2_000)
    const S = m.useCyberspace.getState
    fake.submitRide.mockClear()
    const resumed = S().resumeCloudJob()
    await settle(100)
    // In hand while it is checked: the guards that protect a kept job apply.
    expect(S().cloud.status).toBe('checking')
    expect(S().cloud.job?.jobId).toBe(rec.jobId)
    fake.submitRide.mockResolvedValue({ id: 'newride', status: 'computing', cost_msats: 6_000, poll_token: 'tok2', result: null, error: null, balance_debited: true })
    const started = await S().rideViaHosaka({ previousId: S().prevEventId!, fromHeight: 200, toHeight: 210, toCoordHex: 'ab'.repeat(32), estSeconds: null })
    expect(started).toBe(false)
    expect(fake.submitRide).not.toHaveBeenCalled()
    expect((await recordNow())?.jobId).toBe(rec.jobId)
    await resumed
    expect((await recordNow())?.jobId).toBe(rec.jobId)
    expect(S().cloud.job?.jobId).toBe(rec.jobId)
    expect(S().cloud.status).toBe('idle')
    expect(S().cloud.message).toMatch(/kept/)
  }, 20_000)

  it('a kept record on disk alone bars a new ride and a region key buy, before anything is asked of HOSAKA', async () => {
    storage.setItem(`onosendai:chain:${pk}`, storedJson(KEPT))
    quota.chainChars = Infinity
    const m = await pageLoad()
    await m.savedChainLoaded()
    const rec = await keepJob('hop', chain[KEPT - 1])
    const S = m.useCyberspace.getState
    expect(S().cloud.job).toBeNull()
    fake.submitRide.mockClear()
    expect(await S().rideViaHosaka({ previousId: S().prevEventId!, fromHeight: 200, toHeight: 210, toCoordHex: 'ab'.repeat(32), estSeconds: null })).toBe(false)
    expect(S().cloud.rideError).toMatch(/kept in the Cloud compute panel/)
    expect(fake.submitRide).not.toHaveBeenCalled()
    m.useCyberspace.setState({ cloudPrefs: { ...S().cloudPrefs, mode: 'auto' } })
    const key = await S().buyRegionKey(S().position, S().plane, 10)
    expect(key).toEqual({ ok: false, error: expect.stringMatching(/kept in the Cloud compute panel/) })
    expect((await recordNow())?.jobId).toBe(rec.jobId)
  }, 20_000)

  it('a record whose head the chain has moved past bars nothing: it is spent or worthless', async () => {
    storage.setItem(`onosendai:chain:${pk}`, storedJson(KEPT))
    quota.chainChars = Infinity
    const m = await pageLoad()
    await m.savedChainLoaded()
    await keepJob('hop', chain[10])
    const S = m.useCyberspace.getState
    fake.submitRide.mockClear()
    fake.submitRide.mockResolvedValue({ id: 'newride', status: 'computing', cost_msats: 6_000, poll_token: 'tok2', result: null, error: null, balance_debited: true })
    void S().rideViaHosaka({ previousId: S().prevEventId!, fromHeight: 200, toHeight: 210, toCoordHex: 'ab'.repeat(32), estSeconds: null })
    await settle(200)
    expect(S().cloud.rideError ?? '').not.toMatch(/kept/)
    expect(fake.submitRide).toHaveBeenCalledTimes(1)
  }, 20_000)
})
