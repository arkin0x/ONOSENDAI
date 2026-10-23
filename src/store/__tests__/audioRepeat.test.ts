/**
 * audioRepeat.test.ts: PLACE AGAIN for hidden audio (#462, DECK-0007).
 * Audio repeats, and every copy is sealed again under its own key and
 * uploaded as its own ciphertext, so no two placements share a key, a
 * nonce or a hash. Relays are mocked and Blossom is a server in memory
 * standing in for fetch: nothing leaves the machine.
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

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { forgetOpenedAudio, sealAndUpload, serverOf } from '../../lib/audioFile'
import { decryptAudioFile, type AudioItem } from '../../lib/audioItem'
import { sha256Hex } from '../../lib/blossom'
import { moveDirection } from '../../lib/moves'
import { toneWav } from '../../lib/__tests__/audioFixture'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { repeatable, useShards } from '../useShards'
import { placeSpawn } from '../fixtures/placeSpawn'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const up = (n = 1): void => { for (let i = 0; i < n; i++) C().moveCursor(moveDirection(C().axes(), 'up')) }

/** A Blossom server in memory, standing in for fetch: PUT stores by hash, GET serves it. */
function mockBlossom(): { fetch: typeof fetch; blobs: Map<string, Uint8Array>; puts: number } {
  const blobs = new Map<string, Uint8Array>()
  const out = { blobs, puts: 0, fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method === 'HEAD') return new Response(null, { status: 200 })
    if (method === 'PUT') {
      const body = new Uint8Array(init!.body as Uint8Array)
      const hash = sha256Hex(body)
      blobs.set(hash, body)
      out.puts++
      return new Response(JSON.stringify({ url: `https://blossom.test/${hash}`, sha256: hash, size: body.byteLength, type: 'application/octet-stream' }), { status: 200 })
    }
    const b = blobs.get(url.split('/').pop()!)
    return b ? new Response(b as BodyInit, { status: 200 }) : new Response(null, { status: 404 })
  }) as typeof fetch }
  return out
}

beforeEach(async () => {
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, placedLast: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null })
  useBuilder.getState().exit()
  useInventory.setState({ owner: C().identity.pubkey, items: {}, storage: 'memory' })
  C().clearFocus()
  useCyberspace.setState({ live: false, scaleExp: 6, buildStep: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
  await placeSpawn()
  useBuilder.getState().enter('build')
  up(2)
  forgetOpenedAudio()
})

describe('PLACE AGAIN for audio', () => {
  it('names the server a copy goes to from the first copy’s address', () => {
    expect(serverOf('https://blossom.test/' + 'ab'.repeat(32))).toBe('https://blossom.test')
    expect(serverOf('https://cdn.example/media/' + 'ab'.repeat(32) + '.mp3')).toBe('https://cdn.example/media')
    expect(serverOf('nonsense')).toBeNull()
  })

  it('repeats, and every copy has its own key, nonce and ciphertext, opening to the same file', async () => {
    const server = mockBlossom()
    const realFetch = globalThis.fetch
    globalThis.fetch = server.fetch
    try {
      const tone = toneWav(0.2, 523)
      const sk = generateSecretKey()
      const first = await sealAndUpload(new Blob([tone as BlobPart], { type: 'audio/wav' }), 'https://blossom.test', async (t) => finalizeEvent(t, sk), server.fetch)
      const audio: AudioItem = { ...first, title: 'Drip', about: '', autoplay: true, loop: false, retrigger: 'once', walkOnly: false }
      expect(repeatable({ type: 'audio', audio })).toBe(true)
      S().startDeployAudio(audio)
      await S().deploy()
      expect(S().deployError).toBeNull()
      // Lined up again at once, marked to be sealed afresh when it is placed.
      expect(S().pending).toMatchObject({ type: 'audio', reseal: true })
      up(1)
      await S().deploy()
      expect(S().deployError).toBeNull()
      const placed = S().mine.filter((d) => d.type === 'audio').map((d) => d.audio!)
      expect(placed).toHaveLength(2)
      const [a, b] = placed
      expect(a.keyHex).not.toBe(b.keyHex)
      expect(a.nonceHex).not.toBe(b.nonceHex)
      expect(a.hash).not.toBe(b.hash)
      expect(a.originalHash).toBe(b.originalHash)
      expect(b.title).toBe('Drip')
      // One upload in the composer, one for the copy; the file is not fetched again (kept in memory).
      expect(server.puts).toBe(2)
      for (const x of placed) expect(await decryptAudioFile(server.blobs.get(x.hash)!, x.keyHex, x.nonceHex)).toEqual(tone)
    } finally {
      globalThis.fetch = realFetch
      S().cancelDeploy()
    }
  })

  it('a copy whose file cannot be reached is refused in words, and nothing is hidden', async () => {
    const server = mockBlossom()
    const realFetch = globalThis.fetch
    globalThis.fetch = server.fetch
    try {
      const audio: AudioItem = { title: 'Gone', about: '', url: 'https://blossom.test/' + 'ee'.repeat(32), mime: 'audio/wav', hash: 'ee'.repeat(32), originalHash: '', size: 10, keyHex: '11'.repeat(32), nonceHex: '22'.repeat(12), autoplay: true, loop: true, retrigger: 'once', walkOnly: false }
      useShards.setState({ pending: { type: 'audio', audio, reseal: true } })
      await S().deploy()
      expect(S().deployStatus).toBe('error')
      expect(S().deployError).toMatch(/HTTP 404/)
      expect(S().mine).toHaveLength(0)
      expect(server.puts).toBe(0)
    } finally {
      globalThis.fetch = realFetch
      S().cancelDeploy()
    }
  })
})
