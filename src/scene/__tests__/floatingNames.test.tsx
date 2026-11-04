/**
 * floatingNames.test.tsx: which placed things carry their name floating in the
 * world (arkinox, 2026-11-02). A door, a chest and a sound do not: the name is
 * on the card a tap opens. An item keeps its name until the owner decides.
 */
import { describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
vi.mock('@react-three/fiber', async (real) => ({ ...(await real<object>()), useFrame: () => undefined }))
vi.mock('../TapTarget', async (real) => ({ ...(await real<object>()), TapTarget: () => null }))
// A label is a host element here, so a test can count them.
vi.mock('../WorldLabel', async (real) => {
  const { createElement } = await import('react')
  return { ...(await real<object>()), WorldLabel: (props: object) => createElement('worldlabel', props) }
})
vi.mock('../ShardMesh', async () => {
  const { createElement } = await import('react')
  return { ShardMesh: (props: object) => createElement('shardmesh', props) }
})

import { createElement } from 'react'
import { builtInLook } from '../../lib/looks'
import type { ViewAxes } from '../../lib/space'
import { mount, type Mounted } from '../../test/elementRoot'
import { LookMark } from '../LookMark'
import { ChestLooks } from '../ChestLooks'
import { AudioMark, FLOATING_NAME, ItemMark } from '../WorldMessages'
import { useCyberspace } from '../../store/useCyberspace'
import { useShards } from '../../store/useShards'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
const label = { text: '▣ Wind Chest', color: '#fff', sub: 'by someone', subColor: '#fff' }
const labels = (m: Mounted) => m.all().filter((h) => h.type === 'worldlabel')

describe('floating names in the world', () => {
  it('none for a door, a chest or a sound; an item keeps its own', () => {
    expect(FLOATING_NAME).toEqual({ item: true, chest: false, door: false, sound: false })
  })

  it('a sound is its box and its note, with no name beside it', async () => {
    const m = await mount(createElement(AudioMark, { title: 'Rain Loop', at: [0, 0, 0] }))
    expect(labels(m)).toHaveLength(0)
    expect(m.all().some((h) => h.type === 'mesh')).toBe(true)
    await m.unmount()
  })

  it('a chest or a door drawn with no label has none; LookMark still draws one when handed one', async () => {
    for (const name of ['treasure', 'door'] as const) {
      const look = builtInLook(name)
      const bare = await mount(createElement(LookMark, { look, model: look.closed, at: [0, 0, 0], axes: AXES, minPx: 8 }))
      expect(labels(bare)).toHaveLength(0)
      expect(bare.all().filter((h) => h.type === 'shardmesh')).toHaveLength(1)
      await bare.unmount()
      const named = await mount(createElement(LookMark, { look, model: look.closed, at: [0, 0, 0], axes: AXES, minPx: 8, label }))
      expect(labels(named)).toHaveLength(1)
      await named.unmount()
    }
  })

  it('the world’s chests and doors are drawn with no name over them', async () => {
    const here = { x: (1n << 60n) + 9n, y: 1n << 59n, z: 1n << 58n }
    const near = (dx: bigint) => ({ ...here, x: here.x + dx })
    useCyberspace.setState({ anchor: { ...here }, anchorPlane: 0, scaleExp: 0 })
    const author = 'ab'.repeat(32)
    const chest = (name: string) => ({ name, lockPubkey: 'cd'.repeat(32), senderPubkey: 'ce'.repeat(32), requires: 'a key', payload: '' })
    const inner = (id: string, tags: string[][]) => ({ id, pubkey: author, kind: 1, created_at: 1, tags, content: '', sig: '0'.repeat(128) })
    const found = (id: string, name: string, tags: string[][], dx: bigint) => ({ eventId: id, keyHex: '11'.repeat(32), bagId: 'ff'.repeat(32), lookupId: 'ab'.repeat(32), author, at: near(dx), plane: 0, height: 8, createdAt: 1, type: 'chest', chest: chest(name), inner: inner(id, tags) })
    useShards.getState().addDiscovered([found('a4'.repeat(32), 'Wind Chest', [], 2n), found('a5'.repeat(32), 'Back Door', [['door', '3']], -2n)] as never)
    const m = await mount(createElement(ChestLooks, { axes: AXES }))
    // Both are drawn, as their looks...
    expect(m.all().filter((h) => h.type === 'shardmesh')).toHaveLength(2)
    // ...and neither has a name floating over it.
    expect(labels(m)).toHaveLength(0)
    await m.unmount()
  })

  it('an item still has its name and who left it', async () => {
    const m = await mount(createElement(ItemMark, { text: '⚷ Silver Key', sub: 'by someone', at: [0, 0, 0] }))
    expect(labels(m)).toHaveLength(1)
    expect(labels(m)[0].props.text).toBe('⚷ Silver Key')
    await m.unmount()
  })
})
