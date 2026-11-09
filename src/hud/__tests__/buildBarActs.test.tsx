/**
 * buildBarActs.test.tsx: the BUILD bar's buttons (arkinox, 2026-11-09: "the
 * BUILD mode overlay should have buttons for Item, Chest, Door. Remove the
 * verb prefixes from each button ... We want them to sit nicely in the same
 * spot every time"). Nouns in a fixed order, every one always there, each
 * doing what its verb did; the verbs stay in the tooltips. Pressed through
 * their real onClick (elementRoot.ts). No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../../scene/CardSpin', () => ({ CardSpin: () => null }))
vi.mock('../../scene/ShardSpin', () => ({ ShardSpin: () => null }))
// The bar's cover measures a real box.
vi.mock('../../hooks/useCover', () => ({ useCover: () => () => undefined }))

import { mount, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'
import { useShards } from '../../store/useShards'
import { useStash } from '../stash'
import { BuildBar } from '../BuildBar'

const ORDER = ['OBJECT', 'MESSAGE', 'AUDIO', 'ITEM', 'CHEST', 'DOOR', 'AGAIN', 'AVATAR']

const acts = (bar: Mounted): Host[] => bar.all().filter((h) => h.type === 'button' && h.props.className === 'buildbar__act')
const act = (bar: Mounted, label: string): Host => acts(bar).find((h) => textOf(h) === label)!

beforeEach(() => {
  useCyberspace.setState({ live: false })
  useShards.setState({ pending: null, placedLast: null, deployStatus: 'idle' })
  useStash.getState().close()
  useBuilder.setState({ active: true })
})

afterEach(() => {
  if (useShards.getState().pending) useShards.getState().cancelDeploy()
  useStash.getState().close()
  useBuilder.setState({ active: false })
})

describe('the BUILD bar: ITEM, CHEST, DOOR, and no verbs', () => {
  it('shows every button by its noun, in one fixed order', async () => {
    const bar = await mount(<BuildBar />)
    expect(acts(bar).map(textOf)).toEqual(ORDER)
    for (const verb of ['PLACE OBJECT', 'HIDE MESSAGE', 'PLACE AUDIO', 'PLACE AGAIN', 'RETURN TO AVATAR', 'FORGE AN ITEM', 'SEAL A CHEST', 'SEAL A DOOR']) expect(bar.says(verb)).toBe(false)
    await bar.unmount()
  })

  it('keeps the verbs in the tooltips', async () => {
    const bar = await mount(<BuildBar />)
    expect(act(bar, 'ITEM').props.title).toMatch(/^Forge an item/)
    expect(act(bar, 'CHEST').props.title).toMatch(/^Seal a chest/)
    expect(act(bar, 'DOOR').props.title).toMatch(/^Seal a door/)
    expect(act(bar, 'OBJECT').props.title).toMatch(/^Place object/)
    expect(act(bar, 'AVATAR').props.title).toMatch(/^Return to avatar/)
    await bar.unmount()
  })

  it('names each button by its full phrase, its visible word inside it (label in name)', async () => {
    const bar = await mount(<BuildBar />)
    const names = ['Place object', 'Hide message', 'Place audio', 'Forge an item', 'Seal a chest', 'Seal a door', 'Place again', 'Return to avatar']
    expect(acts(bar).map((h) => h.props['aria-label'])).toEqual(names)
    for (const h of acts(bar)) expect(String(h.props['aria-label']).toUpperCase()).toContain(textOf(h))
    await bar.unmount()
  })

  it('AGAIN holds its cell, dimmed, when there is nothing to place again: nothing after it moves', async () => {
    const bar = await mount(<BuildBar />)
    expect(acts(bar)).toHaveLength(ORDER.length)
    expect(act(bar, 'AGAIN').props.disabled).toBe(true)
    expect(acts(bar).map(textOf).indexOf('AVATAR')).toBe(ORDER.indexOf('AVATAR'))
    await bar.unmount()
  })

  it('ITEM opens the item composer, as FORGE AN ITEM did', async () => {
    const bar = await mount(<BuildBar />)
    await bar.press(/^ITEM$/)
    expect(useStash.getState().key).toBe(true)
    await bar.unmount()
  })

  it('CHEST lines an empty chest up on the hide bar to place first, as SEAL A CHEST did', async () => {
    const bar = await mount(<BuildBar />)
    await bar.press(/^CHEST$/)
    const p = useShards.getState().pending
    expect(p?.type).toBe('chest')
    expect(p?.type === 'chest' && p.door).toBeFalsy()
    await bar.unmount()
  })

  it('DOOR lines a door up on the hide bar to place first, as SEAL A DOOR did', async () => {
    const bar = await mount(<BuildBar />)
    await bar.press(/^DOOR$/)
    const p = useShards.getState().pending
    expect(p?.type === 'chest' && p.door).toBe(true)
    await bar.unmount()
  })

  it('OBJECT, MESSAGE and AUDIO open what they opened before', async () => {
    const bar = await mount(<BuildBar />)
    await bar.press(/^OBJECT$/)
    expect(useStash.getState().models).toBe(true)
    useStash.getState().close()
    await bar.press(/^MESSAGE$/)
    expect(useStash.getState().message).toBe(true)
    useStash.getState().close()
    await bar.press(/^AUDIO$/)
    expect(useStash.getState().audio).toBe(true)
    await bar.unmount()
  })
})
