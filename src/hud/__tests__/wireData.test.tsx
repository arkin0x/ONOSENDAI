/**
 * The wire record folded into the card (arkinox, 2026-10-20: "kind, coord,
 * relays, published status, and test discovery button could be added to our
 * metadata section before you delete the 'wire record' modal. then we can
 * have these unified"). What would fail silently without these: a fact the
 * old record had (lookup id, coordinate, height, relays, the LOCAL / LIVE
 * switch, TEST DISCOVERY) missing from the card, the facts showing on
 * someone else's find, the region key or a key item's secret on screen, or
 * PUBLISH closing the card it was tapped on.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store keeps deployments in localStorage; the test runs where there is none.
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
  relaySet: () => ['wss://relay.test'],
}))

import { positionHex } from '../../lib/events'
import { KEY_KIND, MESSAGE_KIND } from '../../lib/hidden'
import { useCyberspace } from '../../store/useCyberspace'
import { positionOf, useShards, type MyDeployment } from '../../store/useShards'
import { EventData, kindName } from '../EventData'
import { SecretModal } from '../SecretModal'
import { TEST_WORDS, WireData, relayNames } from '../WireData'

const LOOKUP = 'ab'.repeat(32)
const REGION_KEY = '11'.repeat(32)

async function deployment(over: Partial<MyDeployment> = {}, kind = MESSAGE_KIND, tags: string[][] = []): Promise<MyDeployment> {
  const inner = await useCyberspace.getState().signEvent({ kind, created_at: 1_800_000_000, content: 'hidden', tags })
  return {
    eventId: inner.id,
    inner,
    bagId: 'ff'.repeat(32),
    type: 'message',
    text: 'hidden',
    at: { x: '1', y: '2', z: '3' },
    plane: 0,
    height: 8,
    lookupId: LOOKUP,
    keyHex: REGION_KEY,
    relays: [],
    createdAt: 1_800_000_000,
    published: false,
    ...over,
  }
}

describe('the wire facts (WireData)', () => {
  it('has every fact the wire record had, each copyable where it was', async () => {
    const dep = await deployment({ published: true, relays: ['wss://relay.test', 'wss://two.test'] })
    const html = renderToStaticMarkup(<WireData dep={dep} />)
    for (const label of ['lookup ID', 'coord', 'height', 'relays', 'published']) expect(html).toContain(`<dt>${label}</dt>`)
    expect(html).toMatch(new RegExp(`<button class="eventdata__value"[^>]*>${LOOKUP}</button>`))
    // The C coordinate, as the movement chain writes it.
    expect(html).toMatch(new RegExp(`<button class="eventdata__value"[^>]*>${positionHex(positionOf(dep), 0)}</button>`))
    expect(html).toContain('>8</span>')
    expect(html).toContain('relay.test</span>')
    expect(html).toContain('two.test</span>')
    expect(html).toContain('class="pubswitch"')
    expect(html).toContain(TEST_WORDS.idle)
  })

  it('offers TEST DISCOVERY only once the bag is LIVE, and says where a LOCAL one is', async () => {
    const html = renderToStaticMarkup(<WireData dep={await deployment()} />)
    expect(html).not.toContain(TEST_WORDS.idle)
    expect(html).toContain('nowhere yet: signed and kept on this device')
    expect(relayNames({ published: false, relays: ['wss://relay.test'] })).toEqual([])
  })

  it('shows each result of the test in its own words and color', async () => {
    const dep = await deployment({ published: true, relays: ['wss://relay.test'] })
    for (const state of ['testing', 'found', 'missing', 'refused'] as const) {
      const html = renderToStaticMarkup(<WireData dep={dep} initialTest={state} />)
      expect(html).toContain(`eventdata__test--${state}`)
      expect(html).toContain(TEST_WORDS[state].replace('&', '&amp;'))
    }
    expect(Object.values(TEST_WORDS).join('')).not.toContain(String.fromCharCode(0x2014))
  })

  it('says why its own LIVE did not go, and never another bag\'s reason', async () => {
    const dep = await deployment()
    const render = (): string => { Object.assign(useShards.getInitialState(), useShards.getState()); return renderToStaticMarkup(<WireData dep={dep} />) }
    useShards.setState({ broadcastError: 'No relay took the bag. Try again when one is reachable.', broadcastFailed: LOOKUP })
    expect(render()).toContain('No relay took the bag.')
    useShards.setState({ broadcastFailed: 'cd'.repeat(32) })
    expect(render()).not.toContain('No relay took the bag.')
    useShards.setState({ broadcastError: null, broadcastFailed: null })
  })

  it('says which bag a failed broadcast was', async () => {
    const dep = await deployment()
    useShards.setState({ mine: [dep], broadcasting: null, broadcastError: null, broadcastFailed: null })
    const { publishMany } = await import('../../lib/relay')
    vi.mocked(publishMany).mockResolvedValueOnce({ ok: false } as never)
    expect(await useShards.getState().broadcast(LOOKUP)).toBe(false)
    expect(useShards.getState().broadcastFailed).toBe(LOOKUP)
    expect(useShards.getState().broadcastError).toMatch(/No relay/)
  })

  it('never shows the region key', async () => {
    const html = renderToStaticMarkup(<WireData dep={await deployment({ published: true, relays: ['wss://relay.test'] })} />)
    expect(html).not.toContain(REGION_KEY)
  })
})

describe('the kind, named', () => {
  it('names the kinds a bag holds, and leaves the rest a number', () => {
    expect(kindName(3330)).toBe('shard')
    expect(kindName(33331)).toBe('shard, by reference')
    expect(kindName(1)).toBe('message')
    expect(kindName(3340)).toBe('item')
    expect(kindName(3341)).toBe('chest')
    expect(kindName(11333)).toBeNull()
    const html = renderToStaticMarkup(<EventData event={{ id: 'a'.repeat(64), pubkey: 'b'.repeat(64), created_at: 1, kind: 3340, tags: [], content: '', sig: 'c'.repeat(128) }} />)
    expect(html).toMatch(/<dt>kind<\/dt><dd><button class="eventdata__value"[^>]*>3340 \(item\)<\/button>/)
  })
})

/** The card as rendered now: a server render reads a store's initial state, so it is brought up to date first (as askBubble.test does). */
function card(): string {
  for (const store of [useShards, useCyberspace] as const) Object.assign(store.getInitialState(), store.getState())
  return renderToStaticMarkup(<SecretModal />)
}

describe('the card (SecretModal)', () => {
  beforeEach(() => {
    useShards.setState({ mine: [], discovered: {}, deleted: {}, deletedBags: {}, selectedSecret: null, curated: null })
    // The event data is under METADATA, closed by default (Metadata): these read it open.
    localStorage.setItem('onosendai:metadataOpen', '1')
  })

  it('shows the wire facts in the event data for a thing this device hid, and has no WIRE RECORD', async () => {
    const dep = await deployment({ published: true, relays: ['wss://relay.test'] })
    useShards.setState({ mine: [dep], selectedSecret: dep.eventId })
    const html = card()
    expect(html).toContain('aria-label="On the wire"')
    expect(html).toContain(TEST_WORDS.idle)
    expect(html).not.toContain('WIRE RECORD')
    // Under the actions, inside the event data, before the JSON.
    const at = ['secret__actions', 'aria-label="Event data"', 'aria-label="On the wire"', 'eventdata__json'].map((s) => html.indexOf(s))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('shows no wire facts for someone else\'s find', async () => {
    const dep = await deployment()
    const found = { ...dep, author: 'cd'.repeat(32), at: positionOf(dep) }
    useShards.setState({ discovered: { [dep.eventId]: found as never }, selectedSecret: dep.eventId })
    const html = card()
    expect(html).toContain('aria-label="Event data"')
    expect(html).not.toContain('aria-label="On the wire"')
  })

  it('still hides a key item\'s secret with the wire facts beside it', async () => {
    const secret = 'f'.repeat(64)
    const dep = await deployment({ type: 'key', text: undefined, key: { name: 'Vapor Key' } as never }, KEY_KIND, [['title', 'Vapor Key'], ['secret', secret]])
    useShards.setState({ mine: [dep], selectedSecret: dep.eventId })
    const html = card()
    expect(html).toContain('aria-label="On the wire"')
    expect(html).not.toContain(secret)
    expect(html).toContain('will not verify')
  })
})

describe('the store', () => {
  it('has no wire record state left', () => {
    const s = useShards.getState() as unknown as Record<string, unknown>
    expect('inspect' in s).toBe(false)
    expect('inspecting' in s).toBe(false)
  })

  it('keeps the card open on a row PUBLISH re-keys (a failed move put back first)', async () => {
    const dep = await deployment()
    const back = await useCyberspace.getState().signEvent({ kind: MESSAGE_KIND, created_at: 1_800_000_001, content: 'hidden', tags: [] })
    useShards.setState({ mine: [{ ...dep, putBack: back }], selectedSecret: dep.eventId, broadcasting: null })
    await useShards.getState().broadcast(LOOKUP)
    expect(useShards.getState().mine[0].eventId).toBe(back.id)
    expect(useShards.getState().selectedSecret).toBe(back.id)
  })
})
