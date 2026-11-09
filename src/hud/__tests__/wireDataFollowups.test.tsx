/**
 * wireDataFollowups.test.tsx: TEST DISCOVERY follow-ups (review of #624).
 *
 * - A derivation that fails reads COULD NOT DERIVE THE KEY, never NOT FOUND:
 *   the relay was never asked.
 * - A room bag's derived path says DERIVING ROOM KEY, not REGION KEY.
 * - The card subscribes to the calibration, so a ceiling that lands after it
 *   opened moves the path it shows.
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

vi.mock('../../lib/relay', () => ({
  onAuthChange: () => () => {},
  signInFailed: () => false,
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
// The calibration hook as a spy over the real one, its store methods kept: says which slice a render subscribed to.
vi.mock('../../lib/calibration', async (orig) => {
  const real = await orig() as typeof import('../../lib/calibration')
  const hook = vi.fn((sel: Parameters<typeof real.useCalibration>[0]) => real.useCalibration(sel))
  return { ...real, useCalibration: Object.assign(hook, real.useCalibration) }
})

import { MESSAGE_KIND } from '../../lib/hidden'
import { useCalibration } from '../../lib/calibration'
import { useCyberspace } from '../../store/useCyberspace'
import { keepDoorSecret, resetDoorSecrets } from '../../store/rooms'
import type { MyDeployment } from '../../store/useShards'
import { ROOM_TESTING, STORED_TESTING, TEST_WORDS, WireData } from '../WireData'
import { readFileSync } from 'node:fs'

async function deployment(over: Partial<MyDeployment> = {}): Promise<MyDeployment> {
  const inner = await useCyberspace.getState().signEvent({ kind: MESSAGE_KIND, created_at: 1_800_000_000, content: 'hidden', tags: [] })
  return {
    eventId: inner.id, inner, bagId: 'ff'.repeat(32), type: 'message', text: 'hidden',
    at: { x: '1', y: '2', z: '3' }, plane: 0, height: 8, lookupId: 'ab'.repeat(32), keyHex: '11'.repeat(32),
    relays: ['wss://relay.test'], createdAt: 1_800_000_000, published: true, ...over,
  }
}

const escaped = (s: string): string => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;')

beforeEach(() => {
  resetDoorSecrets()
  localStorage.removeItem('onosendai:door-secrets')
  useCalibration.setState({ hopHeight: 17 })
  vi.mocked(useCalibration).mockClear()
})

describe('TEST DISCOVERY follow-ups (review of #624)', () => {
  it('a failed derivation says so, and that the relay was never asked', async () => {
    const html = renderToStaticMarkup(<WireData dep={await deployment()} initialTest="underived" initialChecked={{ via: 'derived' }} />)
    expect(html).toContain(TEST_WORDS.underived)
    expect(TEST_WORDS.underived).toBe('✗ COULD NOT DERIVE THE KEY, TAP TO RETRY')
    expect(html).not.toContain(TEST_WORDS.missing)
    expect(html).toContain('the relay was never asked')
    expect(TEST_WORDS.underived).not.toContain(String.fromCharCode(0x2014))
  })

  it('a room bag derives the room key, and says so while it does', async () => {
    const me = useCyberspace.getState().identity.pubkey
    keepDoorSecret(me, 'dd'.repeat(32), 'ab'.repeat(32))
    const room = renderToStaticMarkup(<WireData dep={await deployment({ room: { doorId: 'dd'.repeat(32) } })} initialTest="testing" />)
    expect(room).toContain(ROOM_TESTING)
    expect(room).not.toContain(TEST_WORDS.testing)
    const region = renderToStaticMarkup(<WireData dep={await deployment()} initialTest="testing" />)
    expect(region).toContain(TEST_WORDS.testing)
    expect(region).not.toContain(ROOM_TESTING)
  })

  it('subscribes to the calibrated ceiling, so the path follows a benchmark that lands after the card opened', async () => {
    const dep = await deployment({ height: 18 })
    renderToStaticMarkup(<WireData dep={dep} initialTest="testing" />)
    const selectors = vi.mocked(useCalibration).mock.calls.map(([sel]) => sel)
    const state = { ...useCalibration.getState(), hopHeight: 19 }
    expect(selectors.some((sel) => sel?.(state) === 19)).toBe(true)
    // And the path it renders is the ceiling's at that moment: stored at 17, derived at 19.
    expect(renderToStaticMarkup(<WireData dep={dep} initialTest="testing" />)).toContain(escaped("can't derive height 18"))
    useCalibration.setState({ hopHeight: 19 })
    expect(renderToStaticMarkup(<WireData dep={dep} initialTest="testing" />)).toContain(TEST_WORDS.testing)
  })

  it('a row GONE FROM ITS BAG never says DERIVING: it is asked about with its stored key (review of #625)', async () => {
    const html = renderToStaticMarkup(<WireData dep={await deployment({ goneFrom: 1_800_000_010 })} initialTest="testing" />)
    expect(html).toContain(STORED_TESTING)
    expect(html).not.toContain(TEST_WORDS.testing)
    expect(html).toContain('gone from its bag')
    expect(html).not.toContain('as a stranger would')
  })

  it('the two retry states have their own color (review of #625)', () => {
    const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')
    for (const state of ['unread', 'underived']) expect(css).toMatch(new RegExp(`\\.eventdata__test--${state}[,:\\s{]`))
  })
})
