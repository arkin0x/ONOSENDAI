/**
 * hideAgainSwitch.test.ts - HIDE AGAIN of hidden audio never signs as an
 * identity switched to on the way (identity-switch audit, 2026-11-19).
 *
 * HIDE AGAIN seals the file again under a fresh key before its copy goes
 * back in the bag: the file is fetched and opened, sealed again, and only
 * then is its upload signed. A switch while the file was fetched had the
 * identity signed in since sign that upload for the one that began it, and
 * the file went up under the new key's name. The relays are mocked and
 * Blossom is a server in memory standing in for fetch, whose GET switches
 * identity. Nothing leaves the machine.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  queryEach: vi.fn(async () => [{ url: 'wss://relay.test', outcome: 'answered', events: [] }]),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { forgetOpenedAudio, sealAndUpload } from '../../lib/audioFile'
import type { AudioItem } from '../../lib/audioItem'
import { sha256Hex } from '../../lib/blossom'
import type { EventTemplate } from '../../lib/events'
import { moveDirection } from '../../lib/moves'
import { toneWav } from '../../lib/__tests__/audioFixture'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { useShards } from '../useShards'
import { placeSpawn } from '../fixtures/placeSpawn'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const up = (n = 1): void => { for (let i = 0; i < n; i++) C().moveCursor(moveDirection(C().axes(), 'up')) }

/** A Blossom server in memory: PUT stores by hash, GET serves it after `onGet`. */
function mockBlossom(): { fetch: typeof fetch; blobs: Map<string, Uint8Array>; puts: number; onGet: () => void } {
  const blobs = new Map<string, Uint8Array>()
  const out = { blobs, puts: 0, onGet: () => {}, fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
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
    out.onGet()
    const b = blobs.get(url.split('/').pop()!)
    return b ? new Response(b as BodyInit, { status: 200 }) : new Response(null, { status: 404 })
  }) as typeof fetch }
  return out
}

/** Every signature the store was asked for, by kind, with the identity on screen when it was asked. */
let asked: { kind: number; as: string }[] = []

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
  asked = []
})

describe('HIDE AGAIN of hidden audio when the identity switches while its file is fetched', () => {
  it('signs nothing and uploads nothing as the identity switched to, and says why', async () => {
    const server = mockBlossom()
    const realFetch = globalThis.fetch
    globalThis.fetch = server.fetch
    const realSign = C().signEvent
    try {
      const tone = toneWav(0.2, 523)
      const sk = generateSecretKey()
      const first = await sealAndUpload(new Blob([tone as BlobPart], { type: 'audio/wav' }), 'https://blossom.test', async (t) => finalizeEvent(t, sk), server.fetch)
      const audio: AudioItem = { ...first, title: 'Drip', about: '', autoplay: true, loop: false, retrigger: 'once', walkOnly: false }
      S().startDeployAudio(audio, { server: 'https://blossom.test' })
      await S().deploy()
      expect(S().deployError).toBeNull()
      S().cancelDeploy()
      const placed = S().mine.find((d) => d.type === 'audio')!
      // Gone from its bag, as a read of a newer bag that lacks it marks it.
      useShards.setState({ mine: S().mine.map((m) => (m.eventId === placed.eventId ? { ...m, goneFrom: m.bagAt ?? m.createdAt } : m)) })
      // Opened afresh, so HIDE AGAIN fetches the file.
      forgetOpenedAudio()
      const puts = server.puts
      useCyberspace.setState({
        signEvent: (t: EventTemplate, patience?: number, late?: Parameters<typeof realSign>[2]) => {
          asked.push({ kind: t.kind, as: C().identity.pubkey })
          return realSign(t, patience, late)
        },
      })
      const hider = C().identity
      const other = 'b2'.repeat(32)
      server.onGet = () => { useCyberspace.setState({ identity: { pubkey: other, npub: 'npub-other' } }) }
      const result = await S().hideAgain(placed.eventId)
      useCyberspace.setState({ identity: hider })
      expect(result).toMatch(/switched identity/)
      expect(asked.filter((a) => a.as === other)).toEqual([])
      expect(server.puts).toBe(puts)
    } finally {
      globalThis.fetch = realFetch
      useCyberspace.setState({ signEvent: realSign })
    }
  })
})
