/**
 * chatSwitchSend.test.ts - a chat line written as one identity is never
 * signed by another (identity-switch audit, 2026-11-19).
 *
 * A line is stamped with the author's key, then sealed into its envelope,
 * which takes a moment (encryption is async), and only then is the envelope
 * signed. A switch of identity in that moment had the new identity sign an
 * envelope holding a line by the old one: both keys in one public event, a
 * link between them anyone in the room could read. The seal here switches
 * identity while it works. No relay is touched.
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

/** Runs while the envelope is being sealed, before it is handed back to be signed. */
const seal = vi.hoisted(() => ({ during: null as null | (() => Promise<void>) }))
vi.mock('../../lib/hidden', async (orig) => {
  const real = await orig<typeof import('../../lib/hidden')>()
  return {
    ...real,
    bagTemplate: async (...args: Parameters<typeof real.bagTemplate>) => {
      await seal.during?.()
      return real.bagTemplate(...args)
    },
  }
})

import { nip19 } from 'nostr-tools'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { publishMany } from '../../lib/relay'
import type { EventTemplate } from '../../lib/events'
import { useChat } from '../useChat'
import { useSecrets } from '../useSecrets'
import { useCyberspace } from '../useCyberspace'

const region = 'dd'.repeat(32)
const keyHex = '11'.repeat(32)

/** The store's own signEvent, before any test wraps it. */
const storeSign = useCyberspace.getState().signEvent

/** Every signature the store was asked for, with the identity on screen when it was asked. */
let asked: { kind: number; as: string }[] = []

describe('a switch of identity while a chat line is sealed', () => {
  beforeEach(async () => {
    vi.mocked(publishMany).mockClear()
    seal.during = null
    asked = []
    await useCyberspace.getState().useNsec(nip19.nsecEncode(generateSecretKey()))
    const real = storeSign
    useCyberspace.setState({
      signEvent: (t: EventTemplate, patience?: number, late?: Parameters<typeof real>[2]) => {
        asked.push({ kind: t.kind, as: useCyberspace.getState().identity.pubkey })
        return real(t, patience, late)
      },
    })
    useSecrets.setState({ current: { [region]: { keyHex, height: 12 } } })
    useChat.setState({ lines: [], draft: '', picked: [], sendStatus: 'idle', sendError: null })
  })

  it('never asks the new identity to sign the old one\'s line, and sends nothing', async () => {
    const b = generateSecretKey()
    seal.during = async () => { await useCyberspace.getState().useNsec(nip19.nsecEncode(b)) }
    useChat.getState().setDraft('said as A')
    await useChat.getState().send()
    expect(useCyberspace.getState().identity.pubkey).toBe(getPublicKey(b))
    expect(asked).toEqual([])
    expect(publishMany).not.toHaveBeenCalled()
    const s = useChat.getState()
    expect(s.sendStatus).toBe('error')
    expect(s.sendError).toMatch(/switched identity/)
    // The line stays in the box, to send again as whoever is signed in now.
    expect(s.draft).toBe('said as A')
    expect(s.lines).toEqual([])
  })

  it('a signer that answers for the old identity after the switch: the line is not sent', async () => {
    const b = generateSecretKey()
    const sign = useCyberspace.getState().signEvent
    useCyberspace.setState({
      signEvent: async (t: EventTemplate, patience?: number, late?: Parameters<typeof sign>[2]) => {
        const signed = await sign(t, patience, late)
        // Switched while the signer (a bunker on a phone) was still answering.
        await useCyberspace.getState().useNsec(nip19.nsecEncode(b))
        return signed
      },
    })
    useChat.getState().setDraft('said as A, answered late')
    await useChat.getState().send()
    expect(useCyberspace.getState().identity.pubkey).toBe(getPublicKey(b))
    expect(publishMany).not.toHaveBeenCalled()
    const s = useChat.getState()
    expect(s.sendError).toMatch(/switched identity/)
    expect(s.draft).toBe('said as A, answered late')
    expect(s.lines).toEqual([])
  })

  it('with no switch, the line goes out signed by its author', async () => {
    const me = useCyberspace.getState().identity.pubkey
    useChat.getState().setDraft('said as me')
    await useChat.getState().send()
    expect(useChat.getState().sendError).toBeNull()
    expect(publishMany).toHaveBeenCalledTimes(1)
    const outer = vi.mocked(publishMany).mock.calls[0][1] as { pubkey: string }
    expect(outer.pubkey).toBe(me)
    expect(asked.every((a) => a.as === me)).toBe(true)
  })
})
