/**
 * Sending a line with a mention (arkinox, 2026-10-11): the @Name picked in
 * the composer goes out as nostr:npub text and a p tag on the inner event,
 * inside the same envelope as any other line. No relay is touched.
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
  subscribe: vi.fn(() => () => {}),
  askEach: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { nip19 } from 'nostr-tools'
import { publishMany } from '../../lib/relay'
import { chatInners, CHAT_BAG_KIND } from '../../lib/hidden'
import { hexToBytes, type NostrEvent } from '../../lib/events'
import { useChat } from '../useChat'
import { useSecrets } from '../useSecrets'

const region = 'dd'.repeat(32)
const keyHex = '11'.repeat(32)
const xor = 'a'.repeat(64)

describe('a line that mentions someone', () => {
  beforeEach(() => {
    vi.mocked(publishMany).mockClear()
    useSecrets.setState({ current: { [region]: { keyHex, height: 12 } } })
    useChat.setState({ lines: [], draft: '', picked: [], sendStatus: 'idle', sendError: null })
  })

  it('goes out as nostr:npub with a p tag, in the usual envelope', async () => {
    const chat = useChat.getState()
    chat.setDraft('@XOR come here')
    chat.pick({ pubkey: xor, label: 'XOR' })
    await useChat.getState().send()
    expect(useChat.getState().sendError).toBeNull()
    const outer = vi.mocked(publishMany).mock.calls[0][1] as NostrEvent
    expect(outer.kind).toBe(CHAT_BAG_KIND)
    const [inner] = await chatInners(outer, hexToBytes(keyHex))
    expect(inner.content).toBe(`nostr:${nip19.npubEncode(xor)} come here`)
    expect(inner.tags.filter((t) => t[0] === 'p')).toEqual([['p', xor]])
    // The signer adds its client tag after these, as on every event.
    expect(inner.tags.map((t) => t[0]).slice(0, 3)).toEqual(['d', 'C', 'p'])
    const s = useChat.getState()
    expect(s.lines.at(-1)?.mentions).toEqual([xor])
    expect(s.draft).toBe('')
    expect(s.picked).toEqual([])
  })

  it('an emptied draft forgets its picks', () => {
    const chat = useChat.getState()
    chat.setDraft('@XOR')
    chat.pick({ pubkey: xor, label: 'XOR' })
    chat.setDraft('')
    expect(useChat.getState().picked).toEqual([])
  })
})
