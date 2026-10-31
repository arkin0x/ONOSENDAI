/**
 * openCeremony.test.ts: OPEN's ceremony plays once per chest, per identity,
 * per device (arkinox, 2026-10-30: "when you open the chest the modal goes
 * away and the in-world animation plays"). The first OPEN of a chest the
 * world draws closes the card and the list it was in and starts the
 * ceremony; a chest opened by hand before (a reload, a signer's chest asked
 * again) plays nothing and keeps its card; a chest the world does not draw
 * keeps its card and lists what is inside. Another identity on the same
 * device gets its own first time. Reduced motion is carried as the calm
 * path. No relay is touched (src/test/noNetwork.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex, type NostrEvent } from '../../lib/events'
import { sealEntries } from '../../lib/chests'
import { keyInnerTemplate, messageInnerTemplate, type ChestItem, type KeyItem } from '../../lib/hidden'
import { resetCeremonySound } from '../../lib/ceremonySound'
import { openChestHere } from '../../hud/ItemRows'
import { useCyberspace } from '../useCyberspace'
import { useShards } from '../useShards'
import { openedByHand, openedKey, resetOpenedChests } from '../useOpenedChests'
import { celebrateOpen, setDrawnLooks, useOpenCeremony } from '../useOpenCeremony'

const hider = generateSecretKey()
const at = { x: 1n, y: 2n, z: 3n }
const place = { lookupId: 'l', bagId: 'b', at: { x: '1', y: '2', z: '3' }, plane: 0 as const, height: 4 }
const CHEST = 'c'.repeat(64)

const lockSk = generateSecretKey()
const lock: KeyItem = { name: 'Brass Key', about: '', itemPubkey: getPublicKey(lockSk), secretHex: bytesToHex(lockSk) }
const lockEvent = finalizeEvent(keyInnerTemplate(lock, at, 0, 1), hider) as NostrEvent
const note = finalizeEvent(messageInnerTemplate('inside', at, 0, 1), hider) as NostrEvent
const sealed = sealEntries([note], lock.itemPubkey)
const chest: ChestItem = { name: 'Strongbox', lockPubkey: lock.itemPubkey, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }
const opener = { by: 'key' as const, key: { id: lockEvent.id, itemPubkey: lock.itemPubkey, secretHex: lock.secretHex } }

/** OPEN as ChestBlock runs it: whether it was opened by hand before, the decrypt, then the ceremony. */
async function tapOpen(me: string, calm = false): Promise<ReturnType<typeof celebrateOpen>> {
  const first = !openedByHand(me, CHEST, chest.lockPubkey)
  await openChestHere({ id: CHEST, chest, author: getPublicKey(hider), place, sealer: getPublicKey(hider) }, opener)
  return celebrateOpen({ me, chestId: CHEST, kind: 'chest', first, calm })
}

const ME = useCyberspace.getState().identity.pubkey

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.removeItem('onosendai:chests-opened')
  resetOpenedChests()
  resetCeremonySound()
  useOpenCeremony.setState({ playing: {} })
  useShards.setState({ mine: [], discovered: {}, selectedSecret: CHEST, nearbyOpen: true })
  setDrawnLooks([CHEST])
})

describe('the first OPEN of a chest the world draws', () => {
  it('closes the card and the list, and plays the ceremony on the chest', async () => {
    const plan = await tapOpen(ME)
    expect(plan).toEqual({ yieldCards: true, ceremony: true, feedback: true })
    expect(useShards.getState().selectedSecret).toBeNull()
    expect(useShards.getState().nearbyOpen).toBe(false)
    expect(useOpenCeremony.getState().playing[openedKey(ME, CHEST)]).toMatchObject({ kind: 'chest', calm: false })
  })

  it('carries reduced motion as the calm path, and ends by itself', async () => {
    await tapOpen(ME, true)
    expect(useOpenCeremony.getState().playing[openedKey(ME, CHEST)]?.calm).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(useOpenCeremony.getState().playing[openedKey(ME, CHEST)]).toBeUndefined()
  })
})

describe('once per chest', () => {
  it('a chest opened by hand before plays nothing and keeps its card, after a reload too', async () => {
    await tapOpen(ME)
    vi.advanceTimersByTime(10_000)
    // A reload: the session forgets, the kept ids stay (store/useOpenedChests).
    resetOpenedChests()
    useShards.setState({ selectedSecret: CHEST })
    const again = await tapOpen(ME)
    expect(again).toEqual({ yieldCards: false, ceremony: false, feedback: false })
    expect(useShards.getState().selectedSecret).toBe(CHEST)
    expect(useOpenCeremony.getState().playing).toEqual({})
  })

  it('another identity on this device gets its own first time', async () => {
    await tapOpen(ME)
    const other = 'f'.repeat(64)
    expect(openedByHand(other, CHEST, chest.lockPubkey)).toBe(false)
    useShards.setState({ selectedSecret: CHEST })
    const plan = celebrateOpen({ me: other, chestId: CHEST, kind: 'chest', first: !openedByHand(other, CHEST, chest.lockPubkey), calm: false })
    expect(plan.ceremony).toBe(true)
    expect(Object.keys(useOpenCeremony.getState().playing).sort()).toEqual([openedKey(ME, CHEST), openedKey(other, CHEST)].sort())
  })
})

describe('a chest the world does not draw', () => {
  it('keeps its card, which lists what is inside, and plays no ceremony', async () => {
    setDrawnLooks([])
    const plan = await tapOpen(ME)
    expect(plan).toEqual({ yieldCards: false, ceremony: false, feedback: true })
    expect(useShards.getState().selectedSecret).toBe(CHEST)
    expect(useOpenCeremony.getState().playing).toEqual({})
  })
})
