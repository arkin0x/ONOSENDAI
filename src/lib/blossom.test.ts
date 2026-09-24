import { describe, expect, it, vi } from 'vitest'
import {
  AUTH_TTL_S, BLOSSOM_AUTH_KIND, BlossomRefusal, DEFAULT_BLOSSOM_SERVERS, authHeader, explainUpload,
  normalizeServer, parseDescriptor, serversFromList, sha256Hex, uploadAuthTemplate, uploadBlob,
} from './blossom'
import type { EventTemplate, NostrEvent } from './events'

const fakeSign = async (t: EventTemplate): Promise<NostrEvent> => ({ ...t, id: '1'.repeat(64), pubkey: 'ab'.repeat(32), sig: 'cd'.repeat(64) })
const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], { type: 'image/png' })
const respond = (status: number, body: unknown = null, headers: Record<string, string> = {}): Response =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers })

describe('normalizeServer', () => {
  it('accepts a bare host and strips a trailing slash', () => {
    expect(normalizeServer('blossom.band')).toBe('https://blossom.band')
    expect(normalizeServer('https://nostr.download/')).toBe('https://nostr.download')
    expect(normalizeServer(' https://cdn.example.org/blossom/ ')).toBe('https://cdn.example.org/blossom')
  })
  it('refuses plain http except for a local server, and anything that is not a host', () => {
    expect(normalizeServer('http://blossom.band')).toBeNull()
    expect(normalizeServer('http://localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeServer('not a url')).toBeNull()
    expect(normalizeServer('')).toBeNull()
  })
  it('the defaults are already normal', () => {
    for (const s of DEFAULT_BLOSSOM_SERVERS) expect(normalizeServer(s)).toBe(s)
  })
})

describe('uploadAuthTemplate and authHeader', () => {
  it('is a kind 24242 naming the action, the bytes and an expiry', () => {
    const t = uploadAuthTemplate('ff'.repeat(32), 1_800_000_000)
    expect(t.kind).toBe(BLOSSOM_AUTH_KIND)
    expect(t.tags).toEqual([['t', 'upload'], ['x', 'ff'.repeat(32)], ['expiration', String(1_800_000_000 + AUTH_TTL_S)]])
    expect(t.content.length).toBeGreaterThan(0)
  })
  it('the header carries the whole signed event, base64, and decodes back', async () => {
    const ev = await fakeSign(uploadAuthTemplate('00'.repeat(32), 1_800_000_000, 'héllo ✓'))
    const header = authHeader(ev)
    expect(header.startsWith('Nostr ')).toBe(true)
    const json = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)))
    expect(JSON.parse(json)).toEqual(ev)
  })
})

describe('serversFromList', () => {
  it('reads server tags in order, normalized, each once, ignoring the rest', () => {
    const ev = { tags: [['server', 'https://a.example/'], ['d', 'x'], ['server', 'b.example'], ['server', 'https://a.example'], ['server', 'nope nope']] }
    expect(serversFromList(ev)).toEqual(['https://a.example', 'https://b.example'])
    expect(serversFromList(null)).toEqual([])
  })
})

describe('parseDescriptor', () => {
  it('needs url and sha256, fills the rest', () => {
    expect(parseDescriptor({ url: 'https://x/ab.png', sha256: 'AB' })).toEqual({ url: 'https://x/ab.png', sha256: 'ab', size: 0, type: 'application/octet-stream' })
    expect(parseDescriptor({ url: 'https://x/ab.png' })).toBeNull()
    expect(parseDescriptor('nope')).toBeNull()
  })
})

describe('uploadBlob', () => {
  const hash = sha256Hex(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]))

  it('asks with HEAD, then PUTs the bytes with the signed token, and returns where they live', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return init.method === 'HEAD' ? respond(200) : respond(200, { url: `https://blossom.band/${hash}.png`, sha256: hash, size: 11, type: 'image/png' })
    })
    const desc = await uploadBlob('https://blossom.band', png, fakeSign, fetchImpl)
    expect(desc.url).toBe(`https://blossom.band/${hash}.png`)
    expect(calls.map((c) => c.init.method)).toEqual(['HEAD', 'PUT'])
    expect(calls.every((c) => c.url === 'https://blossom.band/upload')).toBe(true)
    const head = calls[0].init.headers as Record<string, string>
    expect(head['X-SHA-256']).toBe(hash)
    expect(head['X-Content-Type']).toBe('image/png')
    expect(head['X-Content-Length']).toBe('11')
    const put = calls[1].init.headers as Record<string, string>
    expect(put['Content-Type']).toBe('image/png')
    const token = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(put.Authorization.slice(6)), (c) => c.charCodeAt(0)))) as NostrEvent
    expect(token.kind).toBe(BLOSSOM_AUTH_KIND)
    expect(token.tags).toContainEqual(['x', hash])
    expect(token.tags).toContainEqual(['t', 'upload'])
  })

  it('a server without HEAD, or one whose CORS rejects the probe, still gets the PUT', async () => {
    for (const probe of [() => respond(404), () => respond(405), () => { throw new TypeError('Failed to fetch') }]) {
      const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => (init.method === 'HEAD' ? probe() : respond(201, { url: 'https://s/x.png', sha256: hash })))
      await expect(uploadBlob('https://s', png, fakeSign, fetchImpl)).resolves.toMatchObject({ url: 'https://s/x.png' })
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    }
  })

  it('a refusal on HEAD stops before the bytes are sent, and carries the server\'s reason', async () => {
    const fetchImpl = vi.fn(async () => respond(413, null, { 'X-Reason': 'too big, 2 MB max' }))
    await expect(uploadBlob('https://s', png, fakeSign, fetchImpl)).rejects.toMatchObject({ status: 413, reason: 'too big, 2 MB max' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('a refusal on PUT is a BlossomRefusal too', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => (init.method === 'HEAD' ? respond(200) : respond(401, null, { 'X-Reason': 'bad sig' })))
    await expect(uploadBlob('https://s', png, fakeSign, fetchImpl)).rejects.toBeInstanceOf(BlossomRefusal)
  })

  it('a descriptor naming other bytes is refused', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => (init.method === 'HEAD' ? respond(200) : respond(200, { url: 'https://s/x.png', sha256: '00'.repeat(32) })))
    await expect(uploadBlob('https://s', png, fakeSign, fetchImpl)).rejects.toThrow(/different bytes/)
  })
})

describe('explainUpload', () => {
  it('turns statuses into sentences and keeps the reason', () => {
    expect(explainUpload(new BlossomRefusal(402, null))).toMatch(/payment/)
    expect(explainUpload(new BlossomRefusal(413, '2 MB max'))).toMatch(/too large.*2 MB max/)
    expect(explainUpload(new TypeError('Failed to fetch'))).toMatch(/reached|browser/)
    expect(explainUpload(new Error('odd'))).toBe('odd')
  })
})
