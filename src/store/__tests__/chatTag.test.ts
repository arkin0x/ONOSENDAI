import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/chime', () => ({ chime: vi.fn() }))

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bagTemplate, chatInnerTemplate, CHAT_BAG_KIND } from '../../lib/hidden'
import { freshMentions, MENTION_FRESH_S, prependMention } from '../../lib/mentions'
import { fromRelays, mentionNotification, type Notification } from '../../lib/notifications'
import { ChatDock } from '../../hud/ChatDock'
import { chatUnavailable } from '../../hud/PersonModal'
import { buzzFor, MENTION_BUZZ_MS, useChat } from '../useChat'
import { useCyberspace } from '../useCyberspace'
import { useNotifications } from '../useNotifications'
import { useSecrets } from '../useSecrets'
import { linkChatAndPad, usePad } from '../usePad'

const sync = (): void => {
  for (const store of [useChat, useSecrets] as const) Object.assign(store.getInitialState(), store.getState())
}
const chip = (): string => { sync(); return renderToString(createElement(ChatDock)) }

const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const regionKey = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff)
const region = 'ab'.repeat(32)
const alice = 'a1'.repeat(32)
const bob = 'b2'.repeat(32)

describe('prependMention: CHAT on an avatar card (arkinox, 2026-10-13)', () => {
  const xor = { pubkey: alice, label: 'XOR' }

  it('puts "@Name " at the start of an empty draft, picked, with the caret after it', () => {
    expect(prependMention('', [], xor)).toEqual({ draft: '@XOR ', picked: [xor], caret: 5 })
  })

  it('puts the tag before a draft already typed', () => {
    const next = prependMention('  hello there', [], xor)
    expect(next.draft).toBe('@XOR hello there')
    expect(next.caret).toBe(5)
  })

  it('leaves a draft that already mentions them alone, caret at its end', () => {
    const next = prependMention('hey @XOR come here', [xor], xor)
    expect(next).toEqual({ draft: 'hey @XOR come here', picked: [xor], caret: 18 })
  })

  it('tags again when the name was picked but has since been deleted from the line', () => {
    const next = prependMention('come here', [xor], xor)
    expect(next.draft).toBe('@XOR come here')
    expect(next.picked).toEqual([xor])
  })

  it('keeps other people already picked, and never runs past the line limit', () => {
    const bobPick = { pubkey: bob, label: 'bob' }
    const next = prependMention('@bob hi', [bobPick], xor, 8)
    expect(next.picked).toEqual([bobPick, xor])
    expect(next.draft).toBe('@XOR @bo')
  })
})

describe('freshMentions: which arriving lines tag you', () => {
  const now = 1_800_000_000
  const line = (id: string, over: Partial<{ from: string; at: number; mentions: string[]; text: string }> = {}) =>
    ({ id, from: bob, at: now, mentions: [alice], text: 'hi', ...over })

  it('keeps a new line from someone else that tags you', () => {
    expect(freshMentions([line('1')], new Set(), alice, now).map((l) => l.id)).toEqual(['1'])
  })

  it('drops your own lines, lines already held, repeats, lines that do not tag you, and a replayed room', () => {
    const add = [
      line('mine', { from: alice }),
      line('held'),
      line('twice'), line('twice'),
      line('other', { mentions: [bob] }),
      line('old', { at: now - MENTION_FRESH_S - 1 }),
    ]
    expect(freshMentions(add, new Set(['held']), alice, now).map((l) => l.id)).toEqual(['twice'])
  })
})

describe('a line that tags you, arriving', () => {
  let unlink: () => void = () => {}
  const sk = generateSecretKey()
  const sender = getPublicKey(sk)
  const me = useCyberspace.getState().identity.pubkey

  async function arrive(text: string, tags: string[], at = Math.floor(Date.now() / 1000)): Promise<string> {
    const inner = finalizeEvent(chatInnerTemplate(text, { x: 1n, y: 2n, z: 3n }, 0, at, region, tags), sk)
    const outer = finalizeEvent(await bagTemplate([inner], regionKey, region, 12, at, CHAT_BAG_KIND), sk)
    await useChat.getState().receive(outer)
    return inner.id
  }

  beforeEach(() => {
    useChat.setState({ lines: [], open: false, unread: 0, mentionsUnread: 0, muted: true, revealId: null })
    useSecrets.setState({ current: { [region]: { keyHex: bytesToHex(regionKey), height: 12 } } })
    useNotifications.setState({ me, items: [] })
    usePad.setState({ open: true })
    // A phone with the controls out: the dock stays folded.
    unlink = linkChatAndPad(() => true)
  })
  afterEach(() => unlink())

  it('lights the @ badge instead of the dot, adds a notification, and does not unfold the dock', async () => {
    const id = await arrive('come look', [me])
    const s = useChat.getState()
    expect(s.open).toBe(false)
    expect(s.unread).toBe(1)
    expect(s.mentionsUnread).toBe(1)
    const html = chip()
    expect(html).toContain('chatdock__at')
    expect(html).not.toContain('chatdock__dot')
    const n = useNotifications.getState().items.find((x) => x.id === id)
    expect(n?.what).toBe('mention')
    expect(n?.from).toBe(sender)
    expect(n?.on).toEqual({ type: 'chat', id })
  })

  it('a plain line still gets only the dot', async () => {
    await arrive('just talking', [])
    expect(useChat.getState().mentionsUnread).toBe(0)
    expect(chip()).toContain('chatdock__dot')
    expect(useNotifications.getState().items).toHaveLength(0)
  })

  it('a replayed old line that tags you raises nothing', async () => {
    await arrive('from an hour ago', [me], Math.floor(Date.now() / 1000) - 3600)
    expect(useChat.getState().mentionsUnread).toBe(0)
    expect(useNotifications.getState().items).toHaveLength(0)
  })

  it('opening the dock clears the badge, and reveal opens it at the line', async () => {
    const id = await arrive('over here', [me])
    useChat.getState().reveal(id)
    const s = useChat.getState()
    expect(s.open).toBe(true)
    expect(s.mentionsUnread).toBe(0)
    expect(s.revealId).toBe(id)
    useChat.setState({ open: false, mentionsUnread: 3 })
    useChat.getState().setOpen(true)
    expect(useChat.getState().mentionsUnread).toBe(0)
  })
})

describe('startTo', () => {
  it('unfolds the dock with the tag at the start and asks for the caret after it', () => {
    useChat.setState({ draft: 'hello', picked: [], open: false, focusOnOpen: false, caretOnOpen: null })
    useChat.getState().startTo({ pubkey: alice, label: 'XOR' })
    const s = useChat.getState()
    expect(s.draft).toBe('@XOR hello')
    expect(s.picked).toEqual([{ pubkey: alice, label: 'XOR' }])
    expect(s.open).toBe(true)
    expect(s.focusOnOpen).toBe(true)
    expect(s.caretOnOpen).toBe(5)
  })
})

describe('buzzFor', () => {
  it('buzzes once per sender every MENTION_BUZZ_MS', () => {
    const t = 5_000_000
    expect(buzzFor(['s1'], t)).toBe(true)
    expect(buzzFor(['s1'], t + 1000)).toBe(false)
    expect(buzzFor(['s2'], t + 1000)).toBe(true)
    expect(buzzFor(['s1'], t + MENTION_BUZZ_MS)).toBe(true)
  })
})

describe('chatUnavailable: CHAT on the card says why it cannot', () => {
  it('names the reason the chat line itself gives', () => {
    expect(chatUnavailable(false, true)).toBe('Come back to your head to talk')
    expect(chatUnavailable(true, false)).toBe('Waiting for the scan of where you stand')
    expect(chatUnavailable(true, true)).toBeNull()
  })
})

describe('chat mentions among the notifications', () => {
  it('are never what the relays are paged by', () => {
    const tag = mentionNotification({ id: 'x', from: bob, at: 2_000_000_000, text: 'hi' })
    const reaction = { ...tag, id: 'r', what: 'reaction', createdAt: 1_000, on: { type: 'action', id: 'a' } } as Notification
    expect(fromRelays([tag, reaction])).toEqual([reaction])
  })
})
