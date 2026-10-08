/**
 * avatarsPanelKeep.test.ts - closing the menu does not empty the Avatars
 * list (arkinox, 2026-10-08: "Closing the menu should not empty it").
 *
 * Closing the menu unmounts the panel, and reopening mounts a new one. The
 * list used to live in the panel's own state, so every new mount began at
 * LOADING with no rows. It lives in a store now (store/useRoster.ts): a
 * panel mounted after the list was gathered shows it on its first render.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  relaySet: () => ['wss://relay.test'],
  askRelay: vi.fn(async (url: string) => ({ url, outcome: 'answered', events: [] })),
  askEach: vi.fn(async () => []),
  subscribe: vi.fn(() => () => {}),
  onResume: vi.fn(() => () => {}),
}))

// A server render reads a zustand store's server snapshot, which is its
// initial state; here each store's hook reads the live state, as a mounted
// component in the browser does.
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { hopTemplate, positionHex, type NostrEvent } from '../../lib/events'
import { AvatarsPanel } from '../AvatarsPanel'
import { flushIngest, ingest, stopRoster, useRoster } from '../../store/useRoster'

const here = { x: 5n << 30n, y: 9n << 30n, z: 3n << 30n }

function hop(createdAt: number): NostrEvent {
  return finalizeEvent(hopTemplate({ createdAt, genesisId: 'a'.repeat(64), previousId: 'b'.repeat(64), prevCoordHex: positionHex(here, 0), to: here, plane: 0, proofHash: 'c'.repeat(64) }), generateSecretKey()) as NostrEvent
}

/** The panel as a fresh mount renders it: what reopening the menu shows first. */
const mount = (): string => renderToString(createElement(AvatarsPanel))

afterEach(() => { stopRoster() })

describe('the Avatars panel after the menu is closed and reopened', () => {
  it('shows the rows gathered while it was open on its first render, not LOADING', () => {
    const now = Math.floor(Date.now() / 1000)
    for (let i = 0; i < 7; i++) ingest(hop(now - 60 * i))
    flushIngest()
    useRoster.setState({ answered: true })

    const first = mount()
    expect(first).toContain('7 SEEN')
    // A new mount (the menu reopened) shows the same list straight away.
    const reopened = mount()
    expect(reopened).toContain('7 SEEN')
    expect(reopened).not.toContain('LOADING')
    expect(reopened.match(/avatars__row/g)).toHaveLength(5)
    expect(reopened.replace(/<!-- -->/g, '')).toContain('VIEW MORE (2)')
  })

  it('shows the kept rows with an UPDATING chip while the relays are asked for newer moves', () => {
    ingest(hop(Math.floor(Date.now() / 1000)))
    flushIngest()
    useRoster.setState({ asking: 1 })
    const html = mount()
    expect(html).toContain('UPDATING')
    expect(html).toContain('1 SEEN')
    expect(html.match(/avatars__row/g)).toHaveLength(1)
  })

  it('says LOADING only while it has nothing to show and no relay has answered', () => {
    useRoster.setState({ asking: 2 })
    const html = mount()
    expect(html).toContain('LOADING')
    expect(html).not.toContain('UPDATING')
  })
})
