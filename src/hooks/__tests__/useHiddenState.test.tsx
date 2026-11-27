/**
 * useHiddenState.test.tsx: a hidden thing's state in the world, the same rule
 * for a letter, an item's token and a sound (owner ruling, 2026-11-27: read
 * and new states on all four): NEW while NEARBY has not shown it and it has
 * not been opened, READ once opened (by its lineage) or your own, UNREAD
 * otherwise; nothing new or unread until the opened record is read back.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { act } from 'react'
import { mount, type Mounted } from '../../test/elementRoot'
import { useHiddenState, useMarkOpened } from '../useHiddenState'
import { addNearbyNew, clearNearbyNew, forgetNearbyNew, nearbyNewFor } from '../../store/nearbyNew'
import { useMessagesRead } from '../../store/useMessagesRead'
import { useCyberspace } from '../../store/useCyberspace'
import { useShards } from '../../store/useShards'

;(globalThis as { window?: unknown }).window ??= globalThis

const seen: string[] = []
function Probe({ id, lineage, mine }: { id: string; lineage?: string; mine: boolean }): null {
  seen.push(useHiddenState({ key: id, lineage }, mine))
  return null
}
const last = (): string => seen[seen.length - 1]

let m: Mounted | null = null
beforeEach(() => {
  seen.length = 0
  forgetNearbyNew()
  useShards.setState({ nearbyOpen: false } as never)
  useMessagesRead.setState({ owner: 'me', read: { ids: [] }, ready: true })
})
afterEach(async () => {
  await m?.unmount()
  m = null
  clearNearbyNew(useCyberspace.getState().identity.pubkey)
})

describe('a hidden thing’s state', () => {
  it('is unread when nothing says otherwise', async () => {
    m = await mount(createElement(Probe, { id: 'a1', mine: false }))
    expect(last()).toBe('unread')
  })

  it('is new while it is a find NEARBY has not shown, and read once opened, by its lineage', async () => {
    const me = useCyberspace.getState().identity.pubkey
    addNearbyNew(['a2'], me)
    m = await mount(createElement(Probe, { id: 'a2', lineage: 'lin-2', mine: false }))
    expect(last()).toBe('new')
    await act(async () => { useMessagesRead.getState().markRead('lin-2') })
    expect(last()).toBe('read')
  })

  it('is no longer new once NEARBY has shown it (or its card was opened, which clears it there)', async () => {
    const me = useCyberspace.getState().identity.pubkey
    addNearbyNew(['a3'], me)
    m = await mount(createElement(Probe, { id: 'a3', mine: false }))
    expect(last()).toBe('new')
    await act(async () => { clearNearbyNew(me, ['a3']) })
    expect(last()).toBe('unread')
  })

  it('your own are read', async () => {
    addNearbyNew(['a4'], useCyberspace.getState().identity.pubkey)
    m = await mount(createElement(Probe, { id: 'a4', mine: true }))
    expect(last()).toBe('read')
  })

  it('until the opened record is read back, shows read: never a whole seal it then breaks', async () => {
    useMessagesRead.setState({ ready: false })
    m = await mount(createElement(Probe, { id: 'a5', mine: false }))
    expect(last()).toBe('read')
  })
})

function Opened({ item }: { item: { key: string; lineage?: string; type: string; author?: string } }): null {
  useMarkOpened(item)
  return null
}

describe('opening a card', () => {
  const OTHER = 'b'.repeat(64)
  for (const type of ['key', 'audio'] as const) {
    it(`an ${type === 'key' ? 'item' : 'sound'}’s card marks it read, by its lineage, and takes it off NEARBY’s +N`, async () => {
      const me = useCyberspace.getState().identity.pubkey
      addNearbyNew([`${type}-1`], me)
      m = await mount(createElement(Opened, { item: { key: `${type}-1`, lineage: `${type}-lin`, type, author: OTHER } }))
      expect(useMessagesRead.getState().read.ids).toContain(`${type}-lin`)
      expect(nearbyNewFor(me).has(`${type}-1`)).toBe(false)
    })
  }

  it('a message’s card takes it off +N (its letter card marks it read, as before)', async () => {
    const me = useCyberspace.getState().identity.pubkey
    addNearbyNew(['msg-1'], me)
    m = await mount(createElement(Opened, { item: { key: 'msg-1', type: 'message', author: OTHER } }))
    expect(nearbyNewFor(me).has('msg-1')).toBe(false)
    expect(useMessagesRead.getState().read.ids).not.toContain('msg-1')
  })

  it('your own item is not written to the record (it is read already)', async () => {
    const me = useCyberspace.getState().identity.pubkey
    m = await mount(createElement(Opened, { item: { key: 'own-1', type: 'key', author: me } }))
    expect(useMessagesRead.getState().read.ids).not.toContain('own-1')
  })

  it('a chest’s or a door’s card is neither marked read nor taken off +N: NEARBY keeps its own rule', async () => {
    const me = useCyberspace.getState().identity.pubkey
    addNearbyNew(['chest-1'], me)
    m = await mount(createElement(Opened, { item: { key: 'chest-1', type: 'chest', author: OTHER } }))
    expect(useMessagesRead.getState().read.ids).not.toContain('chest-1')
    expect(nearbyNewFor(me).has('chest-1')).toBe(true)
  })
})
