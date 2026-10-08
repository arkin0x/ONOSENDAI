/**
 * signerChecks.test.ts - a remote signer's answer is checked on every path
 * that signs, a refusal is never silent, and a stored chain's signatures are
 * checked once a session (review of #236).
 *
 * What would go wrong silently: a respawn through a NIP-07 extension that
 * answers with a bad signature shown and saved, then dropped by loadChain on
 * the next load, so the respawn quietly undoes itself; a boarding or a ride
 * the signer refused that just stops, with nothing said; and every boot
 * checking each stored signature twice (once to pick the signer, once to
 * load the chain), at about 2 ms each on the main thread, and again on every
 * switch back to the same identity.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { storage, checked } = vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage: Storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
  /** The pubkey of every event whose signature went through a full check. */
  const checked: { pubkeys: string[] } = { pubkeys: [] }
  return { storage, checked }
})

// Every full signature check is counted, whichever module asks for it.
vi.mock('nostr-tools/pure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools/pure')>()
  return {
    ...actual,
    verifyEvent: (e: Parameters<typeof actual.verifyEvent>[0]) => {
      checked.pubkeys.push(e.pubkey)
      return actual.verifyEvent(e)
    },
  }
})

vi.mock('../../lib/workers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/workers')>()
  return { ...actual, postProof: vi.fn(), cancelProof: vi.fn() }
})

vi.mock('../../lib/chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/chains')>()
  return { ...actual, fetchChainEvents: vi.fn(async () => []) }
})

// The boarding's entry proof does terrain work at a random coordinate; what
// is tested here is what happens to the signature, so it is a fixed hash.
vi.mock('../../lib/hyperspace/enter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/hyperspace/enter')>()
  return { ...actual, computeEnterProof: () => '0'.repeat(64) }
})

/**
 * The extension: signs with its own key, fixed so it survives the module
 * resets each boot does, and can be told to spoil its signatures.
 */
const ext = vi.hoisted(() => ({ spoil: false, key: Uint8Array.from({ length: 32 }, (_, i) => i + 1) }))

vi.mock('../../lib/signers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/signers')>()
  const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure')
  const extKey = ext.key
  const fake = {
    kind: 'nip07' as const,
    pubkey: getPublicKey(extKey),
    // A real extension answers with plain JSON: nothing on it says it was checked.
    signEvent: async (t: Parameters<typeof finalizeEvent>[0]) => {
      const e = JSON.parse(JSON.stringify(finalizeEvent(t, extKey))) as ReturnType<typeof finalizeEvent>
      return ext.spoil ? { ...e, sig: e.sig.replace(/^./, (c) => (c === '0' ? '1' : '0')) } : e
    },
  }
  return {
    ...actual,
    nip07Signer: async () => fake,
    signerFromPref: async () => fake,
    deferredReconnect: (pref: { kind: 'nip07'; pubkey: string }) => ({ ...fake, kind: pref.kind, pubkey: pref.pubkey, reconnect: async () => fake }),
  }
})

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { hopTemplate, positionHex, spawnTemplate, type NostrEvent } from '../../lib/events'

const extKey = ext.key
const pk = getPublicKey(extKey)
const home = coordToXyz(hexToCoord(pk))
const step = (dx: bigint): { x: bigint; y: bigint; z: bigint } => ({ x: home.x + dx, y: home.y, z: home.z })
const sign = (t: Parameters<typeof finalizeEvent>[0]): NostrEvent => JSON.parse(JSON.stringify(finalizeEvent(t, extKey))) as NostrEvent

/** A stored chain for the extension's identity: a spawn and `hops` hops, each signed. */
function chainOf(hops: number): NostrEvent[] {
  const spawn = sign(spawnTemplate(pk, 1_000))
  const out = [spawn]
  for (let n = 1; n <= hops; n++) {
    out.push(sign(hopTemplate({
      createdAt: 1_000 + n * 10,
      genesisId: spawn.id,
      previousId: out[n - 1].id,
      prevCoordHex: n === 1 ? pk : positionHex(step(BigInt(n - 1)), home.plane),
      to: step(BigInt(n)),
      plane: home.plane,
      proofHash: '0'.repeat(64),
    })))
  }
  return out
}

const stored = chainOf(11)
const mine = (): number => checked.pubkeys.filter((p) => p === pk).length

/** A page load with the extension remembered as the signer and its chain saved. */
async function boot(): Promise<typeof import('../useCyberspace')['useCyberspace']['getState']> {
  storage.clear()
  storage.setItem('onosendai:signer', JSON.stringify({ kind: 'nip07', pubkey: pk }))
  storage.setItem(`onosendai:chain:${pk}`, JSON.stringify({ version: 2, events: stored, published: stored.map((e) => e.id), stats: {} }))
  checked.pubkeys = []
  vi.resetModules()
  const { useCyberspace } = await import('../useCyberspace')
  return useCyberspace.getState
}

describe('a stored chain is checked once a session (review of #236, item 2)', () => {
  beforeEach(() => { ext.spoil = false })

  it('a boot checks each stored signature once, though the chain is read twice', async () => {
    const S = await boot()
    expect(S().identity.pubkey).toBe(pk)
    expect(S().events).toHaveLength(stored.length)
    expect(mine()).toBe(stored.length)
  })

  it('switching back to the same identity reads the chain again and checks no signature again', async () => {
    const S = await boot()
    checked.pubkeys = []
    await S().useExtension()
    expect(S().loginError).toBeNull()
    expect(S().events).toHaveLength(stored.length)
    expect(mine()).toBe(0)
  })
})

describe("a remote signer's answer is checked on every path, and a refusal is said (review of #236, items 1 and 3)", () => {
  beforeEach(() => { ext.spoil = false })

  it('a respawn whose spawn comes back with a bad signature is refused, not shown or saved, and says Signing failed', async () => {
    const S = await boot()
    ext.spoil = true
    await expect(S().respawn()).rejects.toThrow(/^signing failed: the signer returned an event whose signature does not verify, so it was not used$/)
    expect(S().events.map((e) => e.id)).toEqual(stored.map((e) => e.id))
    expect(S().proof.message).toBe('Signing failed: the signer returned an event whose signature does not verify, so it was not used')
    const saved = JSON.parse(storage.getItem(`onosendai:chain:${pk}`) ?? 'null') as { events: NostrEvent[] }
    expect(saved.events.map((e) => e.id)).toEqual(stored.map((e) => e.id))
  })

  it('a respawn whose spawn verifies goes through', async () => {
    const S = await boot()
    await S().respawn()
    expect(S().events).toHaveLength(1)
    expect(S().events[0].pubkey).toBe(pk)
  })

  it('a boarding the signer spoils is not silent: it says Signing failed, and nothing is signed onto the chain', async () => {
    const S = await boot()
    ext.spoil = true
    await S().boardHyperspace()
    expect(S().proof.message).toMatch(/^Signing failed: the signer returned an event whose signature does not verify/)
    expect(S().events).toHaveLength(stored.length)
    expect(S().transit).toBeNull()
  })

  it('a ride the signer spoils is not silent: it throws Signing failed for the Hyperspace panel to show', async () => {
    const S = await boot()
    const head = stored[stored.length - 1]
    const { useCyberspace } = await import('../useCyberspace')
    useCyberspace.setState({ transit: { stage: 'boarded', enterEventId: head.id, enterCoordHex: positionHex(step(11n), home.plane) } })
    ext.spoil = true
    await expect(S().completeRide({
      previousId: head.id,
      asOf: 2,
      toCoordHex: positionHex(step(12n), home.plane),
      fromHeight: 1,
      toHeight: 2,
      rootHex: '0'.repeat(64),
      mp: '',
      mnHex: '0'.repeat(16),
    })).rejects.toThrow(/^Signing failed: the signer returned an event whose signature does not verify/)
    expect(S().events).toHaveLength(stored.length)
  })
})
