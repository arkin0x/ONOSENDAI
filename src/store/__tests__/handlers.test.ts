/**
 * handlers.test.ts - the apps that sell listed objects (NIP-89 handlers):
 * fetched once per app from the profile relays, checked (signature, author,
 * kind, d), the newest kept, a bounded number remembered. Handlers here are
 * signed with throwaway keys made for the test; nothing is published.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const held: unknown[] = []
const askEach = vi.fn(async (_relays: string[], _filter: unknown, onEvent: (ev: unknown) => void) => {
  await new Promise((r) => setTimeout(r, 5))
  for (const ev of held) onEvent(ev)
  return [{ outcome: 'answered' }]
})
vi.mock('../../lib/relay', () => ({ askEach: (...a: Parameters<typeof askEach>) => askEach(...a), relaySet: () => ['wss://mine.test'] }))

import { listingApp, type ListingApp } from 'sno-core/feed'
import { HANDLERS_ASKING, HANDLERS_KEPT, HANDLER_MAX_CHARS, isHandlerOf, useHandlers } from '../useHandlers'

const appKey = generateSecretKey()
const APP_PK = getPublicKey(appKey)
const app: ListingApp = listingApp([['client', 'Sno Shop', `31990:${APP_PK}:snoshop`]])!
const handler = (createdAt: number, over: { d?: string; kind?: number } = {}, key = appKey) => finalizeEvent({
  kind: over.kind ?? 31990, created_at: createdAt, content: JSON.stringify({ name: 'Sno Shop' }),
  tags: [['d', over.d ?? 'snoshop'], ['k', '33331'], ['web', 'https://shop.snoshop.example/item/<bech32>', 'naddr']],
}, key)

beforeEach(() => {
  held.length = 0
  askEach.mockClear()
  useHandlers.setState({ handlers: {} })
})

describe('NIP-89 handlers for listings', () => {
  it('asks the profile relays once per app, by coordinate, and keeps the newest valid handler', async () => {
    held.push(handler(100), handler(200), handler(300, { d: 'other' }), handler(400, { kind: 31989 }))
    useHandlers.getState().request(app)
    useHandlers.getState().request(app)
    expect(askEach).toHaveBeenCalledTimes(1)
    const [relays, filter] = askEach.mock.calls[0]
    expect(relays).toContain('wss://mine.test')
    expect(relays).toContain('wss://relay.primal.net')
    expect(filter).toEqual({ kinds: [31990], authors: [APP_PK], '#d': ['snoshop'], limit: 5 })
    await vi.waitFor(() => expect(useHandlers.getState().handlers[app.address]).toBeDefined())
    expect(useHandlers.getState().handlers[app.address]?.created_at).toBe(200)
    // Known now: not asked again this session.
    useHandlers.getState().request(app)
    expect(askEach).toHaveBeenCalledTimes(1)
  })

  it('a handler signed by another key, or with a forged signature, is not the app\'s', async () => {
    const other = handler(500, {}, generateSecretKey())
    const forged = { ...handler(600), content: JSON.stringify({ name: 'Swapped' }) }
    expect(isHandlerOf(handler(1), app)).toBe(true)
    expect(isHandlerOf(other, app)).toBe(false)
    expect(isHandlerOf({ ...other, pubkey: APP_PK }, app)).toBe(false)
    expect(isHandlerOf(forged, app)).toBe(false)
    held.push(other, forged)
    useHandlers.getState().request(app)
    await vi.waitFor(() => expect(app.address in useHandlers.getState().handlers).toBe(true))
    expect(useHandlers.getState().handlers[app.address]).toBeNull()
  })

  it('asks for at most HANDLERS_ASKING apps at once, and every one in turn', async () => {
    const apps = Array.from({ length: 12 }, (_, i) => listingApp([['client', 'X', `31990:${APP_PK}:app${i}`]])!)
    for (const a of apps) useHandlers.getState().request(a)
    expect(askEach).toHaveBeenCalledTimes(HANDLERS_ASKING)
    await vi.waitFor(() => expect(apps.every((a) => a.address in useHandlers.getState().handlers)).toBe(true))
    expect(askEach).toHaveBeenCalledTimes(apps.length)
  })

  it('a handler too big to be one, or not shaped as NIP-01 says, is not read', () => {
    const big = finalizeEvent({ kind: 31990, created_at: 1, content: JSON.stringify({ name: 'x'.repeat(HANDLER_MAX_CHARS) }), tags: [['d', 'snoshop'], ['k', '33331']] }, appKey)
    expect(isHandlerOf(big, app)).toBe(false)
    for (const bad of [{ ...handler(1), tags: [null] }, { ...handler(1), tags: 'x' }, { ...handler(1), content: 5 }, null]) {
      expect(() => isHandlerOf(bad as never, app)).not.toThrow()
      expect(isHandlerOf(bad as never, app)).toBe(false)
    }
  })

  it('remembers at most HANDLERS_KEPT apps, the oldest going first', async () => {
    const seeded: Record<string, null> = {}
    for (let i = 0; i < HANDLERS_KEPT; i++) seeded[`31990:${'0'.repeat(63)}${i % 10}:app${i}`] = null
    useHandlers.setState({ handlers: seeded })
    useHandlers.getState().request(app)
    await vi.waitFor(() => expect(app.address in useHandlers.getState().handlers).toBe(true))
    const keys = Object.keys(useHandlers.getState().handlers)
    expect(keys).toHaveLength(HANDLERS_KEPT)
    expect(keys).not.toContain(Object.keys(seeded)[0])
  })
})
