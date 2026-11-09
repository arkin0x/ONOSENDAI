/**
 * speakeasyLine.test.tsx: the speakeasy under the Position panel's coordinate
 * (speakeasy step 7). ADD RELAY adds the speakeasy to your relays exactly as
 * the Relays panel's ADD does; once it is there the line says JOINED. The
 * lookup is a fake that answers what each test says: nothing is fetched.
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

const HEAD = '0fe6b3deeb67e952f852e8c1df15' + 'a'.repeat(36)
// Your chain head, as the store gives it: one event, at HEAD.
vi.mock('../../store/useCyberspace', () => ({
  useCyberspace: (sel: (s: { events: unknown[]; coordHex: () => string }) => unknown) => sel({ events: [{}], coordHex: () => HEAD }),
}))

import { mount, type Host } from '../../test/elementRoot'
import type { Speakeasy, SpeakeasyLookup } from '../../lib/speakeasy'
import { useRelays } from '../../store/useRelays'
import { SpeakeasyLine, addSpeakeasy, joined } from '../SpeakeasyLine'

const NAMED: Speakeasy = { region: '0fe6b3deeb67e952f852e8c1df15', name: 'fiatjafs-speakeasy', url: 'wss://relay.onosendai.tech/fiatjafs-speakeasy', created_at: 1762300000 }
const PLAIN: Speakeasy = { region: '0fe6', name: null, url: 'wss://relay.onosendai.tech/0fe6', created_at: 1762300000 }

function fakeLookup(list: Speakeasy[]): SpeakeasyLookup & { asked: Array<string | null> } {
  const asked: Array<string | null> = []
  return { asked, update: (c) => { asked.push(c) }, current: () => list, subscribe: () => () => undefined }
}

const links = (all: Host[]): Host[] => all.filter((h) => h.type === 'a')

describe('the speakeasy line', () => {
  beforeEach(() => { useRelays.getState().reset() })

  it('shows nothing when the head is in no speakeasy', async () => {
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([])} />)
    expect(m.all()).toHaveLength(0)
    await m.unmount()
  })

  it('asks about your chain head', async () => {
    const lookup = fakeLookup([])
    const m = await mount(<SpeakeasyLine lookup={lookup} />)
    expect(lookup.asked).toEqual([HEAD])
    await m.unmount()
  })

  it('names each speakeasy, links its region page, and offers ADD RELAY', async () => {
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([NAMED, PLAIN])} />)
    expect(m.says('fiatjafs-speakeasy')).toBe(true)
    expect(m.says('0fe6')).toBe(true)
    expect(m.buttons('ADD RELAY')).toHaveLength(2)
    expect(m.says('JOINED')).toBe(false)
    const hrefs = links(m.all()).map((a) => a.props.href)
    expect(hrefs).toEqual(['https://relay.onosendai.tech/0fe6b3deeb67e952f852e8c1df15', 'https://relay.onosendai.tech/0fe6'])
    for (const a of links(m.all())) expect(a.props.target).toBe('_blank')
    await m.unmount()
  })

  it('says JOINED for a speakeasy already in your relays, ADD RELAY for the other', async () => {
    useRelays.getState().add('wss://relay.onosendai.tech/fiatjafs-speakeasy')
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([NAMED, PLAIN])} />)
    expect(m.says('JOINED')).toBe(true)
    expect(m.buttons('ADD RELAY')).toHaveLength(1)
    await m.unmount()
  })

  it('ADD RELAY puts it in your relays, saved like any other, and the line turns to JOINED', async () => {
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([PLAIN])} />)
    await m.press('ADD RELAY')
    expect(useRelays.getState().relays).toContain('wss://relay.onosendai.tech/0fe6')
    expect(JSON.parse(localStorage.getItem('onosendai:relays') ?? '[]')).toContain('wss://relay.onosendai.tech/0fe6')
    expect(m.says('JOINED')).toBe(true)
    expect(m.buttons('ADD RELAY')).toHaveLength(0)
    await m.unmount()
  })
})

describe('joined and the add path', () => {
  beforeEach(() => { useRelays.getState().reset() })

  it('a path speakeasy is not the canonical relay, whose host it shares', () => {
    expect(joined(PLAIN, useRelays.getState().relays)).toBe(false)
  })

  it('reads the relay list as the store normalizes it', () => {
    expect(joined({ ...PLAIN, url: 'wss://relay.onosendai.tech/0fe6/' }, ['wss://relay.onosendai.tech/0fe6'])).toBe(true)
  })

  it('adds through the relay store, once', () => {
    expect(addSpeakeasy(PLAIN)).toBe('wss://relay.onosendai.tech/0fe6')
    expect(addSpeakeasy(PLAIN)).toBe('wss://relay.onosendai.tech/0fe6')
    expect(useRelays.getState().relays.filter((r) => r === 'wss://relay.onosendai.tech/0fe6')).toHaveLength(1)
  })
})
