import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/chime', () => ({ chime: vi.fn() }))

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { chime } from '../../lib/chime'
import { bagTemplate, chatInnerTemplate, CHAT_BAG_KIND } from '../../lib/hidden'
import { ChatDock } from '../../hud/ChatDock'
import { useChat } from '../useChat'
import { useSecrets } from '../useSecrets'
import { linkChatAndPad, usePad } from '../usePad'

// A server render reads a store's server snapshot, which zustand 4 takes from
// the store's initial state object; copy the live state into it so the chip
// renders what the store holds right now.
const sync = (): void => {
  for (const store of [useChat, useSecrets] as const) Object.assign(store.getInitialState(), store.getState())
}

const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const regionKey = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff)
const region = 'ab'.repeat(32)

let at = 1_700_000_000
async function arrive(text: string): Promise<void> {
  at += 1
  const sk = generateSecretKey()
  const inner = finalizeEvent(chatInnerTemplate(text, { x: 1n, y: 2n, z: 3n }, 0, at, region), sk)
  const outer = finalizeEvent(await bagTemplate([inner], regionKey, region, 12, at, CHAT_BAG_KIND), sk)
  await useChat.getState().receive(outer)
}

const chip = (): string => { sync(); return renderToString(createElement(ChatDock)) }
const hasDot = (html: string): boolean => html.includes('chatdock__dot')

describe('a line arriving while the controls are out', () => {
  let phone = true
  let unlink: () => void = () => {}

  beforeEach(() => {
    phone = true
    vi.mocked(chime).mockClear()
    useChat.setState({ lines: [], open: false, unread: 0, muted: false })
    useSecrets.setState({ current: { [region]: { keyHex: bytesToHex(regionKey), height: 12 } } })
    usePad.setState({ open: true })
    unlink = linkChatAndPad(() => phone)
  })
  afterEach(() => unlink())

  it('on a phone: the chat stays folded, the controls stay, it chimes, and the chip has the dot', async () => {
    expect(hasDot(chip())).toBe(false)
    await arrive('anyone around?')
    const s = useChat.getState()
    expect(s.lines).toHaveLength(1)
    expect(s.open).toBe(false)
    expect(s.unread).toBe(1)
    expect(usePad.getState().open).toBe(true)
    expect(chime).toHaveBeenCalledTimes(1)
    expect(hasDot(chip())).toBe(true)
  })

  it('on a phone, muted: no chime, still the dot', async () => {
    useChat.setState({ muted: true })
    await arrive('quiet')
    expect(chime).not.toHaveBeenCalled()
    expect(useChat.getState().unread).toBe(1)
    expect(hasDot(chip())).toBe(true)
  })

  it('opening the chat clears the dot', async () => {
    await arrive('hello')
    expect(hasDot(chip())).toBe(true)
    useChat.getState().setOpen(true)
    expect(useChat.getState().unread).toBe(0)
    useChat.getState().setOpen(false)
    expect(usePad.getState().open).toBe(true)
    expect(hasDot(chip())).toBe(false)
  })

  it('the dot waits while the chip is away and is there when it comes back', async () => {
    // The chip is not drawn (menu open, offer card, or the star in its place),
    // and more lines arrive meanwhile. Nothing but opening the chat clears it.
    await arrive('one')
    await arrive('two')
    usePad.getState().setOpen(false)
    usePad.getState().setOpen(true)
    expect(useChat.getState().open).toBe(false)
    expect(useChat.getState().unread).toBe(2)
    expect(hasDot(chip())).toBe(true)
  })

  it('on a phone with the controls put away: unfolds as before', async () => {
    usePad.getState().setOpen(false)
    await arrive('hi')
    expect(useChat.getState().open).toBe(true)
    expect(useChat.getState().unread).toBe(0)
    expect(chime).toHaveBeenCalledTimes(1)
  })

  it('on a desktop: unfolds as before, and the controls stay', async () => {
    phone = false
    await arrive('hi')
    expect(useChat.getState().open).toBe(true)
    expect(useChat.getState().unread).toBe(0)
    expect(usePad.getState().open).toBe(true)
    expect(chime).toHaveBeenCalledTimes(1)
  })

  it('unlinked (nothing to protect): unfolds as before', async () => {
    unlink()
    await arrive('hi')
    expect(useChat.getState().open).toBe(true)
  })
})
