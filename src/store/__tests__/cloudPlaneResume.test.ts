/**
 * cloudPlaneResume.test.ts - a paid cloud hop resumed after a reload, or
 * after the plane was flipped between a declined signature and RESUME, is
 * signed for its job's own move in the job's own plane (last-look review of
 * #539; the reviewer's repro made a test).
 *
 * The job record keeps the plane the move was bought in. A plane-change job
 * (0 to 1, 1 to 0) resumed while the lined-up plane is the head's used to
 * sign C in the wrong plane, which the cloud move check then refused, so the
 * paid job could only finish if the player flipped the plane back. Every
 * combination of head plane and job plane, resumed with either plane lined
 * up, now signs C equal to the job's destination, and the signed hop passes
 * core's Level 1 under its own id. Nothing is submitted or started again,
 * and nothing reaches the network (HOSAKA faked, lib/relay mocked).
 */
import { describe, expect, it, vi } from 'vitest'

const { fake } = vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage: Storage = {
    get length() { return m.size }, clear: () => m.clear(), getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null, removeItem: (k: string) => { m.delete(k) }, setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
  const fake = {
    apiUrl: 'http://fake', limits: vi.fn(), quote: vi.fn(), submitHop: vi.fn(), submitSidestep: vi.fn(), getJob: vi.fn(), startJob: vi.fn(),
    claimDeposit: vi.fn(), balance: vi.fn(), deposit: vi.fn(), waitForDeposit: vi.fn(), waitForJob: vi.fn(), provider: vi.fn(),
  }
  return { fake }
})
vi.mock('../../lib/hosaka', async (o) => ({ ...(await o<typeof import('../../lib/hosaka')>()), createHosaka: () => fake }))
vi.mock('../../lib/workers', async (o) => ({ ...(await o<typeof import('../../lib/workers')>()), postProof: vi.fn(), cancelProof: vi.fn() }))
vi.mock('../../lib/chains', async (o) => ({ ...(await o<typeof import('../../lib/chains')>()), fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async () => []), askChainEvents: vi.fn(async () => []) }))
vi.mock('../../lib/relay', async (o) => {
  const a = await o<typeof import('../../lib/relay')>()
  // Offline under the overrides (src/test/offlineRelay.ts): no socket is ever opened.
  const { offlineRelay } = await import('../../test/offlineRelay')
  return { ...a, ...offlineRelay, publish: async () => ({ ok: true as const, accepted: [a.CYBERSPACE_RELAY] }), publishMany: async () => ({ ok: true as const, accepted: [a.CYBERSPACE_RELAY] }) }
})

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { bytesToHex, computeHopProofV2, coordToXyz, deriveRegionKeys, hexToCoord, verifyHopLevel1 } from 'cyberspace-core'
import { hopTemplate, positionHex, spawnTemplate, type NostrEvent } from '../../lib/events'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const home = coordToXyz(hexToCoord(pk))
const sign = (t: Parameters<typeof finalizeEvent>[0]): NostrEvent => ({ ...finalizeEvent(t, sk) }) as NostrEvent
const spawn = sign(spawnTemplate(pk, 1_000))
const tag = (e: NostrEvent, n: string) => e.tags.find((t) => t[0] === n)?.[1]

async function load(events: NostrEvent[], published: string[], extra: Record<string, string> = {}) {
  localStorage.clear()
  localStorage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
  localStorage.setItem('onosendai:live', '0')
  for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v)
  localStorage.setItem(`onosendai:chain:${pk}`, JSON.stringify({ version: 2, events, published, stats: {} }))
  vi.resetModules()
  const store = await import('../useCyberspace')
  store.useCyberspace.setState({ selfCheck: { pubkey: pk, status: 'none' } })
  return store
}


async function cloudCase(headPlane: 0 | 1, jobPlane: 0 | 1, planeAtResume: 0 | 1) {
  fake.waitForJob.mockReset(); fake.submitHop.mockReset(); fake.startJob.mockReset()
  const at1 = { x: home.x ^ 4n, y: home.y, z: home.z }
  const h1 = sign(hopTemplate({ createdAt: 1_010, genesisId: spawn.id, previousId: spawn.id, prevCoordHex: pk, to: at1, plane: headPlane, proofHash: '2'.repeat(64), mn: '0'.repeat(16), mp: '00' }))
  const target = { ...at1, x: at1.x ^ (1n << 12n) }
  const record = { version: 1, jobId: 'job-p', pollToken: 'tok', action: 'hop', pubkey: pk, from: { x: String(at1.x), y: String(at1.y), z: String(at1.z) }, to: { x: String(target.x), y: String(target.y), z: String(target.z) }, plane: jobPlane, prevEventId: h1.id, costMsats: 1000, createdAt: Date.now(), stage: 'computing', deposit: null }
  const p = computeHopProofV2(at1.x, at1.y, at1.z, target.x, target.y, target.z, jobPlane, h1.id)
  const keys = deriveRegionKeys(p.regionN)
  const result = { seal: p.tags.proof, mn: p.tags.mn, mp: p.tags.mp, K: p.terrainK, region_n: { public_proof: keys.lookupIdHex, secret_key: bytesToHex(keys.locationDecryptionKey) }, max_height: 13, compute_msats: 1000 }
  fake.limits.mockResolvedValue({ max_hop_height: 25, max_sidestep_height: 29, hop_min_msats: 1000, deposit_min_msats: 1000, deposit_max_msats: 5e9, invoice_ttl_seconds: 3600, hop_proof_version: 2 })
  fake.waitForJob.mockResolvedValue({ id: 'job-p', status: 'completed', cost_msats: 1000, result, error: null })
  const store = await load([spawn, h1], [spawn.id, h1.id], { 'onosendai:cloudJob': JSON.stringify(record) })
  const S = store.useCyberspace.getState
  const loadedPlane = S().plane
  store.useCyberspace.setState({ plane: planeAtResume })
  await S().resumeCloudJob()
  await vi.waitFor(() => expect(S().events.length === 3 || S().cloud.status === 'error').toBe(true))
  const head = S().events[S().events.length - 1]
  const cloudLib = await import('../../lib/cloud')
  return { plane: S().plane, loadedPlane, signed: S().events.length === 3, C: head.tags.find((t) => t[0] === 'C')?.[1], want: positionHex(target, jobPlane), msg: S().proof.message ?? S().cloud.message, kept: !!cloudLib.loadCloudJob(), submits: fake.submitHop.mock.calls.length, starts: fake.startJob.mock.calls.length, level1: S().events.length === 3 ? verifyHopLevel1({ from: { ...at1, plane: headPlane }, to: { ...target, plane: jobPlane }, previousEventIdHex: h1.id, proof: tag(head, 'proof'), nonce: tag(head, 'mn'), openings: tag(head, 'mp'), eventId: head.id }) : null }
}

describe('a paid cloud hop resumed signs its own move, in its own plane', () => {
  for (const [hp, jp] of [[0, 0], [1, 1], [0, 1], [1, 0]] as Array<[0 | 1, 0 | 1]>) {
    for (const [label, resumePlane] of [['the plane lined up at the commit', jp], ['the head\'s plane, as after a reload', hp]] as Array<[string, 0 | 1]>) {
      it(`head plane ${hp}, job plane ${jp}, resumed with ${label}`, async () => {
        const r = await cloudCase(hp, jp, resumePlane)
        expect(r.signed).toBe(true)
        expect(r.C).toBe(r.want)
        expect(r.level1).toEqual([])
        expect(r.plane).toBe(jp)
        expect(r.kept).toBe(false)
        expect(r.submits + r.starts).toBe(0)
      }, 60_000)
    }
  }
})
