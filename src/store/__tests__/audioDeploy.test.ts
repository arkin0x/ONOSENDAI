/**
 * audioDeploy.test.ts: hiding audio through the deploy (DECK-0007), and in
 * a chest. The item goes into the bag as a kind 1063 rumor with `-`, never
 * to the signer (only the bag is signed); the world draws it as audio; a
 * chest seals it in as a rumor its signer vouches for, and a room behind a
 * door reveals it in place. Relays are mocked, and the file is already
 * uploaded (AudioCompose does that): nothing leaves the machine.
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

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { getEventHash } from 'nostr-tools/pure'
import { forgeKey, openWithSecret, readContents } from '../../lib/chests'
import { AUDIO_KIND, audioItemOf, type AudioItem } from '../../lib/audioItem'
import { type Hidden } from '../../lib/hidden'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { useBuilder } from '../useBuilder'
import { useToast } from '../useToast'
import { pendingEmpty, pendingName, useShards } from '../useShards'
import { pendingSphereRadius } from '../../scene/AudioSphereGhost'

const S = () => useShards.getState()

const audio: AudioItem = {
  title: 'Trickling water', about: '', url: 'https://blossom.test/' + 'ab'.repeat(32), mime: 'audio/mpeg', hash: 'ab'.repeat(32),
  originalHash: 'cd'.repeat(32), size: 2048, keyHex: 'ef'.repeat(32), nonceHex: '01'.repeat(12), autoplay: true, loop: true, retrigger: 'once', walkOnly: false,
}

beforeEach(() => {
  useShards.setState({ mine: [], discovered: {}, deleted: {}, pending: null, deployHeight: 0, deployStatus: 'idle', deployError: null })
  useInventory.setState({ owner: useCyberspace.getState().identity.pubkey, items: {}, storage: 'memory' })
  useCyberspace.setState({ live: false })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('hiding audio', () => {
  it('names the deploy by its title, and is empty only without a file', () => {
    expect(pendingName({ type: 'audio', audio }, null)).toBe('Trickling water')
    expect(pendingEmpty({ type: 'audio', audio }, null)).toBe(false)
    expect(pendingEmpty({ type: 'audio', audio: { ...audio, url: '' } }, null)).toBe(true)
  })

  it('seals a kind 1063 rumor with `-` into the bag, never asks the signer for it, and draws it as audio', async () => {
    const sign = vi.spyOn(useCyberspace.getState(), 'signEvent')
    S().startDeployAudio(audio)
    await S().deploy()
    expect(S().deployError).toBeNull()
    expect(S().deployStatus).toBe('done')
    const d = S().mine.find((x) => x.type === 'audio')!
    expect(d.inner.kind).toBe(AUDIO_KIND)
    expect(d.inner.pubkey).toBe(useCyberspace.getState().identity.pubkey)
    expect('sig' in d.inner).toBe(false)
    expect(d.inner.id).toBe(getEventHash(d.inner))
    expect(d.inner.tags).toContainEqual(['-'])
    expect(audioItemOf(d.inner)).toEqual(audio)
    expect(d.audio).toEqual(audio)
    // One signature: the envelope's.
    expect(sign.mock.calls.map((c) => c[0].kind)).toEqual([33330])
    sign.mockRestore()

    const w = S().worldItems().find((x) => x.key === d.eventId)!
    expect(w.type).toBe('audio')
    expect(w.audio).toEqual(audio)
    expect(S().secretByEvent(d.eventId)?.audio?.title).toBe('Trickling water')
  })

  it('kept whole when BUILD mode ends under it, so the file is not uploaded again', () => {
    useBuilder.setState({ itemDraft: null })
    S().startDeployAudio(audio)
    expect(useBuilder.getState().active).toBe(true)
    // An Earth tap ends BUILD under the lined-up deploy.
    useCyberspace.getState().focusOn(useCyberspace.getState().position, 0, 'EARTH · tap')
    expect(useBuilder.getState().active).toBe(false)
    expect(useToast.getState().toast?.meta ?? '').toMatch(/Your audio is kept: PLACE AUDIO/)
    expect(useBuilder.getState().takeItemDraft('key')).toBeNull()
    expect(useBuilder.getState().takeItemDraft('audio')).toEqual({ type: 'audio', audio })
    expect(useBuilder.getState().itemDraft).toBeNull()
    useCyberspace.getState().clearFocus()
  })
})

describe('the FADE stepper (step 3)', () => {
  it('sets the pending audio\'s sphere, AUTO clears it, and the deploy writes it clamped to where it lands', async () => {
    S().startDeployAudio(audio)
    S().setDeployFade(1_000_000)
    expect(S().pending).toMatchObject({ type: 'audio', audio: { fade: 1_000_000 } })
    S().setDeployFade(undefined)
    const p = S().pending
    expect(p?.type === 'audio' && 'fade' in p.audio).toBe(false)
    S().setDeployFade(1_000_000)
    useShards.setState({ deployHeight: 6, deployHeightAuto: false })
    // What the rings show is what the deploy writes: whole gibsons, clamped to the room (never its n + 0.5).
    const shown = pendingSphereRadius()
    expect(Number.isInteger(shown)).toBe(true)
    await S().deploy()
    expect(S().mine.find((x) => x.type === 'audio')!.audio!.fade).toBe(shown)
    expect(S().deployError).toBeNull()
    const d = S().mine.find((x) => x.type === 'audio')!
    // Never past the nearest wall of a 64-gibson region.
    expect(d.audio!.fade).toBeLessThanOrEqual(32)
    expect(d.inner.tags.find((t) => t[0] === 'fade')?.[1]).toBe(String(d.audio!.fade))
  })
})

describe('audio in a chest (a room behind a door)', () => {
  it('goes in as a rumor the chest vouches for, and is revealed in place when the chest opens', async () => {
    const lock = forgeKey('Door Key')
    S().startDeployKey(lock)
    await S().deploy()
    S().startDeployChest({ name: 'Room', lock: { pubkey: lock.itemPubkey, label: 'Door Key' }, requires: 'Door Key', contents: [{ kind: 'audio', audio: { ...audio, loop: false, retrigger: 'auto' } }] })
    await S().deploy()
    expect(S().deployError).toBeNull()
    const d = S().mine.find((x) => x.type === 'chest')!
    const raw = openWithSecret(d.chest!, lock.secretHex)
    const inside = raw[0] as Record<string, unknown> & { kind: number; id: string }
    expect(inside.kind).toBe(AUDIO_KIND)
    expect('sig' in inside).toBe(false)
    const read = readContents(raw, d.inner.pubkey)
    expect(read[0].body.audio?.retrigger).toBe('auto')
    expect(read[0].verified).toBe(true)

    // Another device holding the key finds the bag: the audio is revealed where the chest stands.
    const finds = S().mine.map((m) => ({ eventId: m.eventId, inner: m.inner, keyHex: m.keyHex, bagId: m.bagId, lookupId: m.lookupId, author: m.inner.pubkey, at: { x: BigInt(m.at.x), y: BigInt(m.at.y), z: BigInt(m.at.z) }, plane: m.plane, height: m.height, createdAt: m.createdAt, type: m.type, key: m.key, chest: m.chest, text: m.text, audio: m.audio, bag: m.bag }) as Hidden)
    useShards.setState({ mine: [] })
    S().addDiscovered(finds)
    const revealed = Object.values(S().discovered).filter((h) => h.chestId)
    expect(revealed.map((h) => h.type)).toEqual(['audio'])
    expect(revealed[0].audio?.title).toBe('Trickling water')
    expect(revealed[0].claim).toBeUndefined()
  })
})

