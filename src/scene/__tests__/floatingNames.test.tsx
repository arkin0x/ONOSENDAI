/**
 * floatingNames.test.tsx: which placed things carry their name floating in the
 * world (arkinox, 2026-11-02). A door, a chest and a sound do not: the name is
 * on the card a tap opens. An item keeps its name until the owner decides.
 */
import { readFileSync } from 'node:fs'
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
import { AudioMark, FLOATING_NAME, ItemMark } from '../WorldMessages'

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

  it('the world’s chests and doors ask FLOATING_NAME by their look’s kind', () => {
    const source = readFileSync(new URL('../ChestLooks.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/label=\{FLOATING_NAME\[w\.look\.kind\] \? \{/)
    expect(builtInLook('treasure').kind).toBe('chest')
    expect(builtInLook('door').kind).toBe('door')
  })

  it('an item still has its name and who left it', async () => {
    const m = await mount(createElement(ItemMark, { text: '⚷ Silver Key', sub: 'by someone', at: [0, 0, 0] }))
    expect(labels(m)).toHaveLength(1)
    expect(labels(m)[0].props.text).toBe('⚷ Silver Key')
    await m.unmount()
  })
})
