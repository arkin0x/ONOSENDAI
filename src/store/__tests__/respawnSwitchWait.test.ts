/**
 * respawnSwitchWait.test.ts - a respawn asked for one identity never respawns
 * another, however long its first look takes (identity-switch audit,
 * 2026-11-19).
 *
 * A respawn first asks whether a newer deploy requires newer chain rules
 * (lib/versionGate.ts), and that look can wait on the network. The respawn
 * used to read the identity and the signer only after it: a switch made
 * while the look was out respawned the identity switched to. The new one
 * signed a spawn nobody asked it for, its chain was replaced by it, and a
 * kept paid HOSAKA job of its own was forgotten. The look here is held open
 * by the test, and the identity switched under it. No network.
 */

import { describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    get length() { return mem.size },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

/** The version look, held open while `hold` is set; any other time it says go at once. */
const gate = vi.hoisted(() => ({ hold: null as Promise<boolean> | null }))
vi.mock('../../lib/versionGate', async (orig) => ({
  ...(await orig<typeof import('../../lib/versionGate')>()),
  lookBeforeMove: () => gate.hold ?? true,
}))
const cleared = vi.hoisted(() => [] as string[])
vi.mock('../../lib/cloud', async (orig) => {
  const real = await orig<typeof import('../../lib/cloud')>()
  return { ...real, clearCloudJob: (pubkey: string, jobId?: string) => { cleared.push(pubkey); real.clearCloudJob(pubkey, jobId) } }
})

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { useCyberspace } from '../useCyberspace'
import type { PendingCloudJob } from '../../lib/cloud'

const S = () => useCyberspace.getState()

/** Hold the version look open; the function returned lets it say go. */
function holdLook(): () => void {
  let release: (ok: boolean) => void = () => {}
  gate.hold = new Promise<boolean>((resolve) => { release = resolve })
  return () => { gate.hold = null; release(true) }
}

/** Switch to B, give B a kept HOSAKA job on screen, and say what B holds now. */
async function switchToB(): Promise<{ pubkey: string; spawnId: string | undefined; respawns: number }> {
  const b = generateSecretKey()
  await S().useNsec(nip19.nsecEncode(b))
  const pubkey = getPublicKey(b)
  expect(S().identity.pubkey).toBe(pubkey)
  useCyberspace.setState({ cloud: { ...S().cloud, job: { jobId: 'b-kept-job', pubkey } as unknown as PendingCloudJob } })
  return { pubkey, spawnId: S().events[0]?.id, respawns: S().respawns }
}

describe('a switch of identity while a respawn waits for its version look', () => {
  it('RESPAWN asked as A, B signed in meanwhile: nothing is respawned, and B keeps its chain and its kept job', async () => {
    await S().useNsec(nip19.nsecEncode(generateSecretKey()))
    const release = holdLook()
    const respawning = S().respawn()
    const b = await switchToB()
    cleared.length = 0
    release()
    await expect(respawning).rejects.toThrow(/identity changed/)
    expect(S().identity.pubkey).toBe(b.pubkey)
    expect(S().events[0]?.id).toBe(b.spawnId)
    expect(S().respawns).toBe(b.respawns)
    expect(S().cloud.job?.jobId).toBe('b-kept-job')
    expect(cleared).not.toContain(b.pubkey)
  })

  it('RESPAWN NOW on a broken chain confirmed for A, B signed in meanwhile: refused, and B is untouched', async () => {
    await S().useNsec(nip19.nsecEncode(generateSecretKey()))
    const a = S().identity.pubkey
    const release = holdLook()
    const respawning = S().respawnFromBrokenChain(a)
    const b = await switchToB()
    cleared.length = 0
    release()
    await expect(respawning).rejects.toThrow(/identity changed/)
    expect(S().identity.pubkey).toBe(b.pubkey)
    expect(S().events[0]?.id).toBe(b.spawnId)
    expect(S().respawns).toBe(b.respawns)
    expect(S().cloud.job?.jobId).toBe('b-kept-job')
    expect(cleared).not.toContain(b.pubkey)
  })

  it('with no switch, the respawn still lands once the look says go', async () => {
    await S().useNsec(nip19.nsecEncode(generateSecretKey()))
    const before = S().respawns
    const release = holdLook()
    const respawning = S().respawn()
    release()
    await respawning
    expect(S().respawns).toBe(before + 1)
  })
})
