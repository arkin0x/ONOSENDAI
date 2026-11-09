/**
 * boughtFollowups.test.ts: follow-ups to the bought-key corner fix (review of #629).
 *
 * - h32 near 2^84 is exact (2^height equal to a double's unit).
 * - A stored corner is held to its height; recovery reads only what String()
 *   of a Number wrote; a deploy row is taken only where it fits the stored value.
 * - The repair runs again when deploy rows arrive after the keys, and one bad
 *   row does not stop the others.
 * - A bought key keeps its HOSAKA job, and an old one's corner can be read
 *   again from its job: never bought again, quietly left when HOSAKA no
 *   longer has it.
 * - A corrupt refused-key record never stops a later set-aside, and is kept.
 *
 * HOSAKA is a fake client (createHosaka mocked) answering with Python's text,
 * parsed the way the real client parses it. Nothing is paid; no relay is reached.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
}

/** HOSAKA, faked: what its job reads answer, as Python's text. Every buying call fails the test. */
const hosaka = vi.hoisted(() => ({
  jobText: null as string | null,
  listText: null as string | null,
  getJob: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
}))
vi.mock('../../hosaka', async (o) => {
  const real = await o<typeof import('../../hosaka')>()
  const never = (name: string) => vi.fn(async () => { throw new Error(`${name} must not be called: nothing is bought`) })
  const getJob = vi.fn(async () => {
    if (!hosaka.jobText) throw new real.HosakaError(404, 'not_found', 'Job not found')
    return real.parseJsonExactIntegers(hosaka.jobText)
  })
  hosaka.getJob = getJob
  const fake = {
    apiUrl: 'http://hosaka.invalid', getJob,
    listJobs: vi.fn(async () => {
      if (!hosaka.listText) throw new real.HosakaError(401, 'unauthorized', 'no')
      return real.parseJsonExactIntegers(hosaka.listText)
    }),
    submitRegionKey: never('submitRegionKey'), submitHop: never('submitHop'), submitSidestep: never('submitSidestep'), submitRide: never('submitRide'),
    deposit: never('deposit'), startJob: never('startJob'), claimDeposit: never('claimDeposit'),
    limits: vi.fn(async () => null), provider: vi.fn(async () => null), balance: vi.fn(async () => ({ balance_msats: 0 })),
  }
  return { ...real, createHosaka: () => fake }
})
vi.mock('../../relay', async (o) => {
  const a = await o<typeof import('../../relay')>()
  const { offlineRelay } = await import('../../../test/offlineRelay')
  return { ...a, ...offlineRelay, relaySet: () => ['wss://relay.test'] }
})

import { alignedBase, baseOf, cornerFromJob, exactInteger, fitsStored, repairBase } from '../base'
import { BOUGHT_KEY, REFUSED_KEY, readRefused, setAsideRefused } from '../backstop'
import type { HeldKey } from '../../../store/useSecrets'
import type { Position } from '../../space'

const AT: Position = { x: (1n << 84n) + (1n << 83n) + 12_345_678_901_234_567n, y: (1n << 84n) + 987_654_321_987_654_321n, z: (1n << 84n) + 55_555_555_555n }
const rounded = (v: string): string => String(Number(v))
const roundedBase = (b: { x: string; y: string; z: string }) => ({ x: rounded(b.x), y: rounded(b.y), z: rounded(b.z) })

describe('the corner helpers, tightened', () => {
  it('h32 near 2^84 is exact: 2^height equal to the unit leaves one corner (h31 does not)', () => {
    const b32 = alignedBase(AT, 32)
    expect(repairBase(roundedBase(b32), 32)).toEqual(b32)
    const b31 = alignedBase(AT, 31)
    // A corner of h31 is a multiple of 2^31; one that is not also a multiple of 2^32 is two-way ambiguous.
    if (BigInt(b31.x) % (1n << 32n) !== 0n) expect(repairBase(roundedBase(b31), 31)).toBeNull()
  })

  it('recovers only what String() of a Number wrote, and only past 2^53', () => {
    const b40 = alignedBase(AT, 40)
    const bad = roundedBase(b40)
    expect(repairBase(bad, 40)).toEqual(b40)
    // The same value typed another way is not String()'s: not recovered.
    expect(repairBase({ ...bad, x: bad.x.replace('e+', 'e') }, 40)).toBeNull()
    expect(repairBase({ x: '1e+3', y: '0', z: '0' }, 2)).toBeNull()
  })

  it('a decimal past 2^53 is held to its height: a multiple of 2^height, and not a double that would have rounded the corner', () => {
    // 2^60 + 2^20 at h20: a multiple of 2^20, and below 10^21 a double holds it exactly
    // where its unit (2^8) is under 2^20: it could be a corner, so it stands.
    const fine = ((1n << 60n) + (1n << 20n)).toString()
    expect(exactInteger(fine, 20)).toBe(BigInt(fine))
    // At h4 the unit 2^8 is wider than 2^4: a double-exact value there may be a rounded one.
    expect(exactInteger(fine, 4)).toBeNull()
    // Not a multiple of 2^height: not a corner.
    expect(exactInteger(((1n << 60n) + 1n).toString(), 20)).toBeNull()
    // Near 2^84 a decimal string is never String()'s (that writes an exponent): exact.
    const b20 = alignedBase(AT, 20)
    expect(exactInteger(b20.x, 20)).toBe(BigInt(b20.x))
    // Without a height, as before.
    expect(exactInteger(((1n << 60n) + 1n).toString())).toBe((1n << 60n) + 1n)
    expect(baseOf(b20, 20)).toEqual({ x: BigInt(b20.x), y: BigInt(b20.y), z: BigInt(b20.z) })
  })

  it('a deploy row is taken only where it fits what was stored', () => {
    const b20 = alignedBase(AT, 20)
    const bad = roundedBase(b20)
    expect(fitsStored(bad.x, BigInt(b20.x), 20)).toBe(true)
    expect(repairBase(bad, 20, AT)).toEqual(b20)
    // A row 2^40 away on x names the same lookup id from elsewhere: passed over.
    const elsewhere = { ...AT, x: AT.x + (1n << 40n) }
    expect(fitsStored(bad.x, BigInt(alignedBase(elsewhere, 20).x), 20)).toBe(false)
    expect(repairBase(bad, 20, elsewhere)).toBeNull()
  })

  it('cornerFromJob: the key\'s own job, every axis a multiple of 2^height that fits the stored value', () => {
    const b20 = alignedBase(AT, 20)
    const key = { lookupId: 'cd'.repeat(32), height: 20, base: roundedBase(b20) }
    const result = { lookup_id: 'CD'.repeat(32), height: 20, base: b20 }
    expect(cornerFromJob(result, key)).toEqual(b20)
    expect(cornerFromJob({ ...result, lookup_id: 'ee'.repeat(32) }, key)).toBeNull()
    expect(cornerFromJob({ ...result, height: 21 }, key)).toBeNull()
    expect(cornerFromJob({ ...result, base: { ...b20, y: (BigInt(b20.y) + 1n).toString() } }, key)).toBeNull()
    expect(cornerFromJob({ ...result, base: { ...b20, z: (BigInt(b20.z) + (1n << 40n)).toString() } }, key)).toBeNull()
    expect(cornerFromJob(null, key)).toBeNull()
  })
})

describe('the refused-key record', () => {
  beforeEach(() => mem.clear())

  it('passes over an entry missing its lookup id, and a later set-aside still lands, keeping it', () => {
    mem.set(REFUSED_KEY, JSON.stringify([{ keyHex: 'aa'.repeat(32) }, null, 7]))
    expect(readRefused()).toEqual([])
    const key = { lookupId: 'cd'.repeat(32), keyHex: 'ab'.repeat(32), height: 20, base: { x: '0', y: '0', z: '0' }, plane: 0, why: 'x', at: 1 }
    expect(setAsideRefused(key)).toBeNull()
    expect(readRefused()).toEqual([key])
    expect(JSON.parse(mem.get(REFUSED_KEY)!)).toHaveLength(4)
  })

  it('keeps a record that is not a list at all, as one entry', () => {
    mem.set(REFUSED_KEY, '{not json')
    const key = { lookupId: 'cd'.repeat(32), keyHex: 'ab'.repeat(32), height: 20, base: { x: '0', y: '0', z: '0' }, plane: 0, why: 'x', at: 1 }
    expect(setAsideRefused(key)).toBeNull()
    expect(JSON.parse(mem.get(REFUSED_KEY)!)).toEqual([{ unreadable: '{not json' }, key])
  })
})

const H = 20
const STORED_BAD = roundedBase(alignedBase(AT, H))
const boughtKey = (n: number, over: Partial<HeldKey> = {}): HeldKey => ({
  lookupId: n.toString(16).padStart(64, '0'), keyHex: (n + 7).toString(16).padStart(64, '0'), height: H, base: STORED_BAD, plane: 0, source: 'cloud', at: 1, ...over,
})
const row = (lookupId: string, at: { x: string; y: string; z: string }) => ({ lookupId, height: H, at }) as never
const atStrings = (p: Position) => ({ x: p.x.toString(), y: p.y.toString(), z: p.z.toString() })

describe('the store', () => {
  type Mods = { secrets: typeof import('../../../store/useSecrets'); shards: typeof import('../../../store/useShards'); cs: typeof import('../../../store/useCyberspace') }
  async function boot(before?: (m: Mods) => void): Promise<Mods> {
    vi.resetModules()
    const secrets = await import('../../../store/useSecrets')
    const shards = await import('../../../store/useShards')
    const cs = await import('../../../store/useCyberspace')
    before?.({ secrets, shards, cs })
    await secrets.useSecrets.getState().load()
    return { secrets, shards, cs }
  }
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50))
  const want = alignedBase(AT, H)

  beforeAll(async () => { await import('../../../store/useSecrets') }, 60_000)
  beforeEach(() => {
    mem.clear()
    ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
    hosaka.jobText = null
    hosaka.listText = null
  })

  it('repairs again when the deploy rows arrive after the keys', async () => {
    const k = boughtKey(1)
    mem.set(BOUGHT_KEY, JSON.stringify({ [k.lookupId]: k }))
    const { secrets, shards } = await boot()
    await settle()
    expect(secrets.useSecrets.getState().keys[k.lookupId].base).toEqual(STORED_BAD)
    shards.useShards.setState({ mine: [row(k.lookupId, atStrings(AT))] })
    await settle()
    expect(secrets.useSecrets.getState().keys[k.lookupId].base).toEqual(want)
    expect(JSON.parse(mem.get(BOUGHT_KEY)!)[k.lookupId].base).toEqual(want)
  })

  it('one bad row never stops the repair of another key', async () => {
    const a = boughtKey(2)
    const b = boughtKey(3)
    mem.set(BOUGHT_KEY, JSON.stringify({ [a.lookupId]: a, [b.lookupId]: b }))
    const { secrets } = await boot(({ shards }) => {
      shards.useShards.setState({ mine: [row(a.lookupId, { x: 'garbage', y: '1', z: '2' }), row(b.lookupId, atStrings(AT))] })
    })
    await settle()
    expect(secrets.useSecrets.getState().keys[a.lookupId].base).toEqual(STORED_BAD)
    expect(secrets.useSecrets.getState().keys[b.lookupId].base).toEqual(want)
  })

  it('a key bought now keeps its HOSAKA job and poll token', async () => {
    const { secrets, cs } = await boot()
    cs.useCyberspace.setState({
      buyRegionKey: async () => ({ ok: true as const, result: { secret_key: 'ab'.repeat(32), lookup_id: 'cd'.repeat(32), height: H, base: want }, job: { id: 'job7', pollToken: 'tok7' } }),
    })
    const held = await secrets.useSecrets.getState().buy(AT, 0, H)
    expect(held).toMatchObject({ jobId: 'job7', pollToken: 'tok7', base: want })
    expect(JSON.parse(mem.get(BOUGHT_KEY)!)['cd'.repeat(32)]).toMatchObject({ jobId: 'job7', pollToken: 'tok7' })
  })

  /** The job's answer as Python writes it: the corner as bare integers. */
  const pythonJob = (lookupId: string): string =>
    `{"id": "job1", "status": "completed", "job_type": "region_key", "cost_msats": 2000, "error": null, "result": {"secret_key": "${'ab'.repeat(32)}", "lookup_id": "${lookupId}", "height": ${H}, "base": {"x": ${want.x}, "y": ${want.y}, "z": ${want.z}}}}`

  it('an old key\'s corner, read again from its job with the poll token: exact, kept everywhere, nothing bought', async () => {
    const k = boughtKey(4, { jobId: 'job1', pollToken: 'tok1' })
    mem.set(BOUGHT_KEY, JSON.stringify({ [k.lookupId]: k }))
    const { secrets, cs } = await boot()
    cs.useCyberspace.setState({ cloudPrefs: { ...cs.useCyberspace.getState().cloudPrefs, mode: 'ask' } })
    hosaka.jobText = pythonJob(k.lookupId)
    expect(await secrets.useSecrets.getState().refetchCorner(k.lookupId)).toBe('fixed')
    expect(hosaka.getJob).toHaveBeenCalledWith('job1', 'tok1')
    expect(secrets.useSecrets.getState().keys[k.lookupId].base).toEqual(want)
    await settle()
    expect(JSON.parse(mem.get(BOUGHT_KEY)!)[k.lookupId].base).toEqual(want)
  })

  it('without a kept job: from the signed list of this pubkey\'s jobs, matched by lookup id', async () => {
    const k = boughtKey(5)
    mem.set(BOUGHT_KEY, JSON.stringify({ [k.lookupId]: k }))
    const { secrets, cs } = await boot()
    cs.useCyberspace.setState({ cloudPrefs: { ...cs.useCyberspace.getState().cloudPrefs, mode: 'ask' } })
    hosaka.listText = `{"jobs": [${pythonJob('ee'.repeat(32))}, ${pythonJob(k.lookupId)}], "count": 2}`
    expect(await secrets.useSecrets.getState().refetchCorner(k.lookupId)).toBe('fixed')
    expect(secrets.useSecrets.getState().keys[k.lookupId].base).toEqual(want)
  })

  it('a job HOSAKA no longer has, or cloud compute off: quietly left as it was', async () => {
    const k = boughtKey(6, { jobId: 'gone', pollToken: 'tok' })
    mem.set(BOUGHT_KEY, JSON.stringify({ [k.lookupId]: k }))
    const { secrets, cs } = await boot()
    cs.useCyberspace.setState({ cloudPrefs: { ...cs.useCyberspace.getState().cloudPrefs, mode: 'ask' } })
    expect(await secrets.useSecrets.getState().refetchCorner(k.lookupId)).toBe('gone')
    expect(secrets.useSecrets.getState().keys[k.lookupId].base).toEqual(STORED_BAD)
    cs.useCyberspace.setState({ cloudPrefs: { ...cs.useCyberspace.getState().cloudPrefs, mode: 'off' } })
    hosaka.jobText = pythonJob(k.lookupId)
    expect(await secrets.useSecrets.getState().refetchCorner(k.lookupId)).toBe('gone')
    expect(secrets.useSecrets.getState().keys[k.lookupId].base).toEqual(STORED_BAD)
  })
})
