/**
 * audioMute.test.ts: a mute or a block stops what already plays (the mute
 * agent's ask for hidden audio step 2, beside ONOSENDAI #464/#465). A card's
 * PLAY of a muted or blocked item stops the moment the list changes, from
 * wherever the change came, and NOW PLAYING drops it; a source in the world
 * reads the filtered world, so a muted one is no longer planned and stops;
 * your own audio is never muted; and unmuting does not restart a card.
 * Nothing leaves the machine: the file comes from a server in memory, and
 * the element is a stand-in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { forgetOpenedAudio, sealAndUpload } from '../../lib/audioFile'
import type { AudioItem } from '../../lib/audioItem'
import { sha256Hex } from '../../lib/blossom'
import { NOTHING_MUTED } from '../../lib/muteList'
import { freshMemory, planWorld } from '../../lib/audioWorld'
import { playingRows } from '../../hud/NowPlaying'
import { toneWav } from '../../lib/__tests__/audioFixture'
import { cardKey, playAudio, stopAllAudio, stopMutedVoices, useHiddenAudio } from '../useHiddenAudio'
import { useMutes } from '../useMutes'
import { muteSubject, useShards, type WorldItem } from '../useShards'
import { useCyberspace } from '../useCyberspace'

/** An audio element stand-in: plays at once, never ends by itself. */
class FakeAudio extends EventTarget {
  loop = false
  preload = ''
  src = ''
  paused = true
  async play(): Promise<void> { this.paused = false }
  pause(): void { this.paused = true }
  removeAttribute(): void { this.src = '' }
  load(): void {}
}

const someone = getPublicKey(generateSecretKey())
let audio: AudioItem
const realFetch = globalThis.fetch

beforeEach(async () => {
  vi.stubGlobal('Audio', FakeAudio)
  const blobs = new Map<string, Uint8Array>()
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'HEAD') return new Response(null, { status: 200 })
    if (method === 'PUT') {
      const body = new Uint8Array(init!.body as Uint8Array)
      const hash = sha256Hex(body)
      blobs.set(hash, body)
      return new Response(JSON.stringify({ url: `https://blossom.test/${hash}`, sha256: hash, size: body.byteLength }), { status: 200 })
    }
    const b = blobs.get(String(input).split('/').pop()!)
    return b ? new Response(b as BodyInit, { status: 200 }) : new Response(null, { status: 404 })
  }) as typeof fetch
  forgetOpenedAudio()
  const sk = generateSecretKey()
  const up = await sealAndUpload(new Blob([toneWav() as BlobPart], { type: 'audio/wav' }), 'https://blossom.test', async (t) => finalizeEvent(t, sk))
  audio = { ...up, title: 'Drone', about: '', autoplay: true, loop: true, retrigger: 'once', walkOnly: false }
  useMutes.setState({ muted: NOTHING_MUTED })
  useHiddenAudio.setState({ entries: {} })
})

afterEach(() => {
  stopAllAudio()
  globalThis.fetch = realFetch
  vi.unstubAllGlobals()
})

const item = (key: string, author: string, mine = false): WorldItem => ({ key, type: 'audio', at: { x: 1n, y: 2n, z: 3n }, plane: 0, height: 6, mine, author, audio, lineage: `L${key}` })

describe('a mute or a block stops what already plays', () => {
  it('a card\'s PLAY of someone blocked stops, and NOW PLAYING drops it', async () => {
    const w = item('aa'.repeat(32), someone)
    await playAudio(w.key, audio, muteSubject(w))
    expect(useHiddenAudio.getState().entries[cardKey(w.key)]?.phase).toBe('playing')
    expect(playingRows(useHiddenAudio.getState().entries, null, false)).toHaveLength(1)
    // The block arrives (from an avatar card, the BLOCKED list or another device: the list is what changes).
    useMutes.setState({ muted: { pubkeys: new Set([someone]), items: new Set() } })
    expect(useHiddenAudio.getState().entries[cardKey(w.key)]).toBeUndefined()
    expect(playingRows(useHiddenAudio.getState().entries, null, false)).toEqual([])
    // Unblocked again: nothing starts by itself.
    useMutes.setState({ muted: NOTHING_MUTED })
    expect(useHiddenAudio.getState().entries).toEqual({})
  })

  it('muting the item itself, by its id or its lineage, stops it too; your own never stops', async () => {
    const theirs = item('bb'.repeat(32), someone)
    const mine = item('cc'.repeat(32), useCyberspace.getState().identity.pubkey, true)
    await playAudio(theirs.key, audio, muteSubject(theirs))
    await playAudio(mine.key, audio, muteSubject(mine))
    useMutes.setState({ muted: { pubkeys: new Set([useCyberspace.getState().identity.pubkey]), items: new Set([`L${theirs.key}`, mine.key]) } })
    const left = Object.keys(useHiddenAudio.getState().entries)
    expect(left).toEqual([cardKey(mine.key)])
    expect(stopMutedVoices()).toEqual([])
  })

  it('a world source reads the filtered world: muted, it is no longer planned, and its voice stops', () => {
    const w = item('dd'.repeat(32), someone)
    useShards.setState({ mine: [], discovered: { [w.key]: { eventId: w.key, bagId: 'b', lookupId: 'l', author: someone, at: w.at, plane: 0, height: 6, createdAt: 1, type: 'audio', audio } } })
    const plan = (): string[] => {
      const sources = useShards.getState().worldItems().filter((x) => x.type === 'audio').map((x) => ({ key: x.key, lineage: x.key, audio: x.audio!, heard: { gain: 1, inSphere: true } }))
      return planWorld(sources, new Set([w.key]), () => false, 0, freshMemory()).stop
    }
    expect(plan()).toEqual([])
    useMutes.setState({ muted: { pubkeys: new Set([someone]), items: new Set() } })
    expect(plan()).toEqual([w.key])
    useShards.setState({ discovered: {} })
  })
})
