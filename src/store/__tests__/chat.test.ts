import { beforeEach, describe, expect, it } from 'vitest'

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
import { bagTemplate, chatInnerTemplate, CHAT_BAG_KIND } from '../../lib/hidden'
import { mergeLines, sendKey, useChat, type ChatLine } from '../useChat'
import { useSecrets } from '../useSecrets'
import { useCyberspace } from '../useCyberspace'

const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

const line = (id: string, at: number, over: Partial<ChatLine> = {}): ChatLine => ({ id, from: 'f'.repeat(64), text: id, at, region: 'r', height: 12, mine: false, ...over })

describe('lines', () => {
  it('merge newest last and never repeat', () => {
    const have = [line('a', 10), line('b', 20)]
    const out = mergeLines(have, [line('b', 20), line('c', 15)])
    expect(out.map((l) => l.id)).toEqual(['a', 'c', 'b'])
  })

  it('return the same list when nothing is new', () => {
    const have = [line('a', 10)]
    expect(mergeLines(have, [line('a', 10)])).toBe(have)
  })
})

describe('the key a line goes out with', () => {
  it('is the widest cube the scan reaches', () => {
    useSecrets.setState({ current: { r4: { keyHex: '04', height: 4 }, r12: { keyHex: '0c', height: 12 }, r9: { keyHex: '09', height: 9 } } })
    expect(sendKey()).toEqual({ lookupId: 'r12', keyHex: '0c', height: 12 })
  })

  it('is nothing before the first scan', () => {
    useSecrets.setState({ current: {} })
    expect(sendKey()).toBeNull()
  })
})

describe('receiving', () => {
  const regionKey = new Uint8Array(32).map((_, i) => (i * 5 + 1) & 0xff)
  const region = 'dd'.repeat(32)

  beforeEach(() => {
    useChat.setState({ lines: [], open: false, unread: 0, muted: true })
    useSecrets.setState({ current: { [region]: { keyHex: bytesToHex(regionKey), height: 12 } } })
    useCyberspace.setState({ anchorPlane: 0 })
  })

  it('opens an envelope from someone else, unfolds the dock and keeps the line', async () => {
    const sk = generateSecretKey()
    const inner = finalizeEvent(chatInnerTemplate('anyone around?', { x: 1n, y: 2n, z: 3n }, 0, 1_700_000_100, region), sk)
    const outer = finalizeEvent(await bagTemplate([inner], regionKey, region, 12, 1_700_000_100, CHAT_BAG_KIND), sk)
    await useChat.getState().receive(outer)
    const s = useChat.getState()
    expect(s.lines).toHaveLength(1)
    expect(s.lines[0]).toMatchObject({ id: inner.id, from: getPublicKey(sk), text: 'anyone around?', region, height: 12, mine: false })
    expect(s.open).toBe(true)
    expect(JSON.parse(localStorage.getItem('onosendai:chat') ?? '[]')).toHaveLength(1)
  })

  it('opens an envelope from a neighboring cube with that cube\'s key', async () => {
    const other = 'ff'.repeat(32)
    useSecrets.setState({ neighbors: { [other]: { keyHex: bytesToHex(regionKey), height: 12 } } })
    const sk = generateSecretKey()
    const inner = finalizeEvent(chatInnerTemplate('over the wall', { x: 1n, y: 2n, z: 3n }, 0, 5, other), sk)
    const outer = finalizeEvent(await bagTemplate([inner], regionKey, other, 12, 5, CHAT_BAG_KIND), sk)
    await useChat.getState().receive(outer)
    expect(useChat.getState().lines.map((l) => l.text)).toEqual(['over the wall'])
    useSecrets.setState({ neighbors: {} })
  })

  it('ignores an envelope for a region it has no key for', async () => {
    const sk = generateSecretKey()
    const inner = finalizeEvent(chatInnerTemplate('elsewhere', { x: 1n, y: 2n, z: 3n }, 0, 1, 'ee'.repeat(32)), sk)
    const outer = finalizeEvent(await bagTemplate([inner], regionKey, 'ee'.repeat(32), 12, 1, CHAT_BAG_KIND), sk)
    await useChat.getState().receive(outer)
    expect(useChat.getState().lines).toHaveLength(0)
    expect(useChat.getState().open).toBe(false)
  })

  it('does not unfold for your own echo', async () => {
    const sk = generateSecretKey()
    useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: getPublicKey(sk) } })
    const inner = finalizeEvent(chatInnerTemplate('me', { x: 1n, y: 2n, z: 3n }, 0, 2, region), sk)
    const outer = finalizeEvent(await bagTemplate([inner], regionKey, region, 12, 2, CHAT_BAG_KIND), sk)
    await useChat.getState().receive(outer)
    expect(useChat.getState().lines[0]?.mine).toBe(true)
    expect(useChat.getState().open).toBe(false)
  })

  it('the same envelope twice is one line', async () => {
    const sk = generateSecretKey()
    const inner = finalizeEvent(chatInnerTemplate('once', { x: 1n, y: 2n, z: 3n }, 0, 3, region), sk)
    const outer = finalizeEvent(await bagTemplate([inner], regionKey, region, 12, 3, CHAT_BAG_KIND), sk)
    await useChat.getState().receive(outer)
    await useChat.getState().receive(outer)
    expect(useChat.getState().lines).toHaveLength(1)
  })

  // A room's key and d are the same in both planes (spec §7.6 Planes), so an
  // envelope said at these X, Y and Z in the other plane opens with this key;
  // only the line's C says which plane it was said in (DECK-0005 §3.2).
  it('hears a line only in the plane its C names', async () => {
    const sk = generateSecretKey()
    const twin = finalizeEvent(chatInnerTemplate('from the twin plane', { x: 1n, y: 2n, z: 3n }, 1, 6, region), sk)
    await useChat.getState().receive(finalizeEvent(await bagTemplate([twin], regionKey, region, 12, 6, CHAT_BAG_KIND), sk))
    expect(useChat.getState().lines).toHaveLength(0)
    expect(useChat.getState().open).toBe(false)
    const here = finalizeEvent(chatInnerTemplate('from this plane', { x: 1n, y: 2n, z: 3n }, 0, 7, region), sk)
    await useChat.getState().receive(finalizeEvent(await bagTemplate([here], regionKey, region, 12, 7, CHAT_BAG_KIND), sk))
    expect(useChat.getState().lines.map((l) => l.text)).toEqual(['from this plane'])
    // Listening from ideaspace, the same twin line is heard.
    useCyberspace.setState({ anchorPlane: 1 })
    await useChat.getState().receive(finalizeEvent(await bagTemplate([twin], regionKey, region, 12, 6, CHAT_BAG_KIND), sk))
    expect(useChat.getState().lines.map((l) => l.text)).toContain('from the twin plane')
  })

  it('hears a line with no C in either plane', async () => {
    const sk = generateSecretKey()
    const bare = finalizeEvent({ kind: 23333, created_at: 8, content: 'no place said', tags: [['d', region]] }, sk)
    for (const plane of [0, 1] as const) {
      useChat.setState({ lines: [] })
      useCyberspace.setState({ anchorPlane: plane })
      await useChat.getState().receive(finalizeEvent(await bagTemplate([bare], regionKey, region, 12, 8, CHAT_BAG_KIND), sk))
      expect(useChat.getState().lines.map((l) => l.text)).toEqual(['no place said'])
    }
  })

  it('clear forgets everything on this device', () => {
    useChat.setState({ lines: [line('a', 1)], unread: 3 })
    useChat.getState().clear()
    expect(useChat.getState().lines).toHaveLength(0)
    expect(useChat.getState().unread).toBe(0)
    expect(localStorage.getItem('onosendai:chat')).toBe('[]')
  })
})
