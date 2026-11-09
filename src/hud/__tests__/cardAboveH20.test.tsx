/**
 * cardAboveH20.test.tsx: the card of a bag above height 20 opens (2026-11-09).
 * Its comment section derived the region key in render, which
 * cyberspace-core refuses above 20, so the card crashed, and CLOSE on the
 * crash note left the card selected, so it crashed again until RELOAD.
 *
 * - A bag at 25 hidden here, or found with a key bought from HOSAKA, opens
 *   with its comments: the held key is used.
 * - A find at 25 with no key held says COMMENTS UNAVAILABLE and does not throw.
 * - A find at 13 to 20 with no key held renders without computing a key: the
 *   key is the region worker's job, after render.
 * - CLOSE on the crash note clears the open card.
 *
 * A server render runs render only, no effects: any key computed here was
 * computed during render, and regionKeyAt throws if it is.
 */
import { renderToStaticMarkup } from 'react-dom/server'
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

vi.mock('../../lib/relay', async (orig) => ({
  ...(await orig() as object),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryChecked: vi.fn(async () => ({ events: [], trouble: null })),
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../../lib/shardCrypto', async (orig) => ({
  ...(await orig() as object),
  regionKeyAt: vi.fn((_at: unknown, height: number) => { throw new Error(`regionKeyAt(${height}) during render`) }),
}))

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { messageInnerTemplate, type Hidden } from '../../lib/hidden'
import { regionKeyAt } from '../../lib/shardCrypto'
import { useCyberspace } from '../../store/useCyberspace'
import { useShards, type MyDeployment } from '../../store/useShards'
import { CrashNote } from '../CrashNote'
import { SecretModal } from '../SecretModal'

const ME_SK = new Uint8Array(32).fill(2)
const ME = getPublicKey(ME_SK)
const THEM_SK = new Uint8Array(32).fill(4)
const KEY_HEX = '99'.repeat(32)
const AT = { x: (1n << 40n) + 12345n, y: 77n << 20n, z: 3n << 30n }
const T = 1_800_000_000

function card(): string {
  for (const store of [useShards, useCyberspace] as const) Object.assign(store.getInitialState(), store.getState())
  return renderToStaticMarkup(<SecretModal />)
}

function mineAt(height: number): MyDeployment {
  const inner = finalizeEvent(messageInnerTemplate('up high', AT, 0, T), ME_SK)
  return {
    eventId: inner.id, inner, bagId: 'f'.repeat(64), type: 'message', text: 'up high',
    at: { x: AT.x.toString(), y: AT.y.toString(), z: AT.z.toString() }, plane: 0, height,
    lookupId: 'ab'.repeat(32), keyHex: KEY_HEX, relays: ['wss://relay.test'], createdAt: T, published: true,
  }
}

function foundAt(height: number, keyHex?: string): Hidden {
  const inner = finalizeEvent(messageInnerTemplate('theirs', AT, 0, T), THEM_SK)
  return {
    eventId: inner.id, inner, bagId: 'e'.repeat(64), lookupId: 'cd'.repeat(32), author: getPublicKey(THEM_SK),
    at: AT, plane: 0, height, createdAt: T, type: 'message', text: 'theirs', ...(keyHex ? { keyHex } : {}),
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.mocked(regionKeyAt).mockClear()
  useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: ME }, live: false })
  useShards.setState({ mine: [], discovered: {}, deleted: {}, deletedBags: {}, selectedSecret: null, curated: null })
})

describe('the card of a bag above height 20', () => {
  it('opens with its comments when this device hid it', () => {
    const dep = mineAt(25)
    useShards.setState({ mine: [dep], selectedSecret: dep.eventId })
    const html = card()
    expect(html).toContain('aria-label="Comments"')
    expect(html).not.toContain('COMMENTS UNAVAILABLE')
    expect(regionKeyAt).not.toHaveBeenCalled()
  })

  it('opens with its comments when found with a key bought from HOSAKA', () => {
    const h = foundAt(25, KEY_HEX)
    useShards.setState({ discovered: { [h.eventId]: h }, selectedSecret: h.eventId })
    const html = card()
    expect(html).toContain('aria-label="Comments"')
    expect(html).not.toContain('COMMENTS UNAVAILABLE')
    expect(regionKeyAt).not.toHaveBeenCalled()
  })

  it('says COMMENTS UNAVAILABLE, and does not throw, with no key held', () => {
    const h = foundAt(25)
    useShards.setState({ discovered: { [h.eventId]: h }, selectedSecret: h.eventId })
    let html = ''
    expect(() => { html = card() }).not.toThrow()
    expect(html).toContain('COMMENTS UNAVAILABLE')
    // No composer under it: there is no key to seal with.
    expect(html).not.toContain('comments__input')
    expect(regionKeyAt).not.toHaveBeenCalled()
  })

  it.each([13, 16, 20])('at height %i with no key held, renders without computing one', (height) => {
    const h = foundAt(height)
    useShards.setState({ discovered: { [h.eventId]: h }, selectedSecret: h.eventId })
    expect(() => card()).not.toThrow()
    expect(regionKeyAt).not.toHaveBeenCalled()
  })
})

describe('CLOSE on the crash note', () => {
  it('clears the open card, so the same render is not tried again', () => {
    const dep = mineAt(25)
    useShards.setState({ mine: [dep], selectedSecret: dep.eventId })
    const note = new CrashNote({ where: 'a modal', children: null })
    note.setState = () => {}
    ;(note as unknown as { close: () => void }).close()
    expect(useShards.getState().selectedSecret).toBeNull()
    expect(card()).toBe('')
  })
})
