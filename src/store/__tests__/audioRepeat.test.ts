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
import { placeAudioOpts } from '../../hud/AudioCompose'
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
      S().startDeployAudio(audio, { server: 'https://blossom.test' })
      await S().deploy()
      expect(S().deployError).toBeNull()
      // Lined up again at once, marked to be sealed afresh when it is placed, on the server picked.
      expect(S().pending).toMatchObject({ type: 'audio', reseal: true, server: 'https://blossom.test' })
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

  it('a copy goes to the server the hider picked, even when the first copy is served from another host', async () => {
    const server = mockBlossom()
    const realFetch = globalThis.fetch
    const seen: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${String(input)}`)
      // The CDN serves what the API host stored.
      return server.fetch(String(input).replace('https://cdn.test/', 'https://blossom.test/'), init)
    }) as typeof fetch
    try {
      const sk = generateSecretKey()
      const first = await sealAndUpload(new Blob([toneWav() as BlobPart], { type: 'audio/wav' }), 'https://blossom.test', async (t) => finalizeEvent(t, sk), server.fetch)
      const onCdn: AudioItem = { ...first, url: `https://cdn.test/${first.hash}`, title: 'Bell', about: '', autoplay: true, loop: true, retrigger: 'once', walkOnly: false }
      useShards.setState({ pending: { type: 'audio', audio: onCdn, reseal: true, server: 'https://blossom.test' } })
      await S().deploy()
      expect(S().deployError).toBeNull()
      expect(seen).toContain('PUT https://blossom.test/upload')
      expect(seen.some((s) => s.startsWith('PUT https://cdn.test'))).toBe(false)
    } finally {
      globalThis.fetch = realFetch
      S().cancelDeploy()
    }
  })

  it('a copy BUILD mode ends under is kept as a copy: PLACE AUDIO then seals it afresh, never under the first key', () => {
    const a = { hash: 'aa'.repeat(32) }
    const kept = { audio: a, reseal: true as const, server: 'https://blossom.test' }
    expect(placeAudioOpts(a, undefined, kept)).toEqual({ server: 'https://blossom.test', reseal: true })
    // A new file picked instead is a first copy, on the server it went to.
    expect(placeAudioOpts({ hash: 'bb'.repeat(32) }, 'https://other.test', kept)).toEqual({ server: 'https://other.test', reseal: false })
    // A kept first copy (never placed) is placed as it is.
    expect(placeAudioOpts(a, undefined, { audio: a, server: 'https://blossom.test' })).toEqual({ server: 'https://blossom.test', reseal: false })
    expect(placeAudioOpts(a, 'https://blossom.test', undefined)).toEqual({ server: 'https://blossom.test', reseal: false })
  })

  it('BUILD mode ending under a copy keeps it whole, reseal and server with it', () => {
    const audio: AudioItem = { title: 'Bell', about: '', url: 'https://blossom.test/' + 'aa'.repeat(32), mime: 'audio/wav', hash: 'aa'.repeat(32), originalHash: '', size: 10, keyHex: '11'.repeat(32), nonceHex: '22'.repeat(12), autoplay: true, loop: true, retrigger: 'once', walkOnly: false }
    useBuilder.setState({ itemDraft: null })
    useShards.setState({ pending: { type: 'audio', audio, reseal: true, server: 'https://blossom.test' } })
    C().focusOn(C().position, 0, 'EARTH · tap')
    expect(useBuilder.getState().active).toBe(false)
    expect(useBuilder.getState().itemDraft).toEqual({ type: 'audio', audio, reseal: true, server: 'https://blossom.test' })
    C().clearFocus()
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
