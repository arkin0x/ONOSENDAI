/**
 * smashButton.test.tsx - TERRAIN's SMASH button (owner, 2026-11-27): a
 * hammer while the Compiler is the chosen slot, a fist otherwise, and its hold
 * bar runs for that hand's hold (lib/blueprint/smash.ts COMPILER_HOLD_MS and
 * BARE_HOLD_MS, the owner's tuning block).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

// The held Compiler is a WebGL canvas of its own; this test is about the button.
vi.mock('../../terrain/HeldCompiler', () => ({ HeldCompiler: () => null }))

;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { addEventListener?: unknown }).addEventListener ??= () => {}
;(globalThis as { removeEventListener?: unknown }).removeEventListener ??= () => {}
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
    key: () => null,
    get length() { return mem.size },
  }
}

import { createElement } from 'react'
import { mount, settled, type Host, type Mounted } from '../../test/elementRoot'
import { TerrainView } from '../../terrain/TerrainView'
import { useTerrain } from '../../store/useTerrain'
import { useCyberspace } from '../../store/useCyberspace'
import { emptyInventory, withCompiler } from '../../lib/terrain/terrainDb'
import { BARE_HOLD_MS, BARE_REACH, COMPILER_HOLD_MS, COMPILER_REACH } from '../../lib/blueprint/smash'

const smash = (m: Mounted): Host | undefined => m.all().find((h) => String(h.props.className ?? '').includes('terrain-act--smash'))
const icon = (m: Mounted): string | undefined => {
  const b = smash(m)
  if (!b) return undefined
  return m.all().map((h) => h.props['data-icon'] as string | undefined).find((v) => v === 'fist' || v === 'hammer')
}

afterEach(() => {
  useTerrain.setState({ active: false, inventory: emptyInventory() })
  useCyberspace.setState({ walking: false })
})

describe('the owner\'s tuning', () => {
  it('a bare hand holds 7 seconds and reaches the 3 by 3 by 3 box; the Compiler holds 4 and reaches the whole window', () => {
    expect(BARE_HOLD_MS).toBe(7000)
    expect(COMPILER_HOLD_MS).toBe(4000)
    expect(BARE_REACH).toEqual({ below: 1, above: 1 })
    expect(COMPILER_REACH).toEqual({ below: 8, above: 7 })
  })
})

describe('SMASH shows the hand you smash with', () => {
  it('a hammer with the Compiler chosen, a fist with any other slot, and the bar runs for that hold', async () => {
    useCyberspace.setState({ walking: true })
    const inv = withCompiler(emptyInventory(), 'granted')
    useTerrain.setState({ active: true, loading: false, sheet: false, inventory: { ...inv, slot: 0 } })
    const m = await mount(createElement(TerrainView))
    try {
      expect(icon(m)).toBe('hammer')
      expect((smash(m)!.props.style as Record<string, string>)['--hold-ms']).toBe(`${COMPILER_HOLD_MS}ms`)
      useTerrain.setState({ inventory: { ...useTerrain.getState().inventory, slot: 3 } })
      await settled()
      expect(icon(m)).toBe('fist')
      expect((smash(m)!.props.style as Record<string, string>)['--hold-ms']).toBe(`${BARE_HOLD_MS}ms`)
      useTerrain.setState({ inventory: { ...useTerrain.getState().inventory, slot: 0 } })
      await settled()
      expect(icon(m)).toBe('hammer')
    } finally {
      await m.unmount()
    }
  })
})
