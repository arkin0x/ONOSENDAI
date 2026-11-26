/**
 * lookFoldsWithPad.test.tsx - WALK's LOOK ball folds away with the pad
 * (owner, 2026-11-26: "look should disappear when the controls are
 * collapsed").
 *
 * - In WALK a tap on the scene folds the pad, and LOOK goes with it; the
 *   CONTROLS chip brings both back. LOOK used to stay up alone, dropped into
 *   the gap JUMP and DOWN left.
 * - TERRAIN never folds on a tap (a tap mines), but on a phone the open chat
 *   puts the pad away there too: LOOK, PLACE, SURVEY, the hotbar and the
 *   carried block go with it, each out of sight in its own place so nothing
 *   moves, and all come back when the chat folds.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
import { mount, settled } from '../../test/elementRoot'
import type { Host, Mounted } from '../../test/elementRoot'
import { WalkLookSphere } from '../WalkLookSphere'
import { TerrainView } from '../../terrain/TerrainView'
import { useCyberspace } from '../../store/useCyberspace'
import { useLayers } from '../../store/useLayers'
import { linkChatAndPad, tapScene, usePad } from '../../store/usePad'
import { useChat } from '../../store/useChat'
import { useTerrain } from '../../store/useTerrain'

const CSS = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')

/** Whether the LOOK ball is on screen. */
const lookUp = (m: Mounted): boolean => m.all().some((h) => String(h.props.className ?? '').includes('walklook'))
/** TERRAIN's own layer. */
const terrainView = (m: Mounted): Host | undefined => m.all().find((h) => String(h.props.className ?? '').split(' ').includes('terrainview'))

beforeEach(() => {
  useCyberspace.setState({ walking: true })
  useLayers.getState().setLayer('walkLookSphere', true)
  usePad.setState({ open: true })
})
afterEach(() => {
  usePad.setState({ open: true })
  useChat.getState().setOpen(false)
  useTerrain.setState({ active: false })
  useCyberspace.setState({ walking: false })
})

describe('LOOK in WALK', () => {
  it('folds away when a tap on the scene collapses the controls, and comes back with CONTROLS', async () => {
    const m = await mount(createElement(WalkLookSphere))
    try {
      expect(lookUp(m)).toBe(true)
      // A tap on open scene folds the pad.
      tapScene()
      await settled()
      expect(usePad.getState().open).toBe(false)
      expect(lookUp(m)).toBe(false)
      // The CONTROLS chip.
      usePad.getState().setOpen(true)
      await settled()
      expect(lookUp(m)).toBe(true)
      // A second tap folds again, a third unfolds.
      tapScene(); await settled()
      expect(lookUp(m)).toBe(false)
      tapScene(); await settled()
      expect(lookUp(m)).toBe(true)
    } finally {
      await m.unmount()
    }
  })
})

describe('TERRAIN with the pad put away', () => {
  it('never folds on a tap, and on a phone the open chat folds LOOK and TERRAIN\'s tools together, in place', async () => {
    useTerrain.setState({ active: true, loading: false, sheet: false })
    const stop = linkChatAndPad(() => true)
    const m = await mount(createElement('div', null, createElement(TerrainView), createElement(WalkLookSphere)))
    try {
      expect(lookUp(m)).toBe(true)
      expect(String(terrainView(m)?.props.className)).not.toContain('is-folded')
      // A tap mines in TERRAIN: the pad stays out.
      tapScene(); await settled()
      expect(usePad.getState().open).toBe(true)
      expect(lookUp(m)).toBe(true)

      // The chat over the pad's column on a phone.
      useChat.getState().setOpen(true)
      await settled()
      expect(usePad.getState().open).toBe(false)
      expect(lookUp(m)).toBe(false)
      expect(String(terrainView(m)?.props.className)).toContain('is-folded')
      // PLACE and the hotbar are still there, only out of sight: nothing moves.
      expect(m.buttons('PLACE').length).toBe(1)
      expect(m.all().some((h) => String(h.props.className ?? '').includes('terrain-hotbar'))).toBe(true)

      // Folding the chat brings it all back.
      useChat.getState().setOpen(false)
      await settled()
      expect(usePad.getState().open).toBe(true)
      expect(lookUp(m)).toBe(true)
      expect(String(terrainView(m)?.props.className)).not.toContain('is-folded')
    } finally {
      await m.unmount()
      stop()
    }
  })

  it('hides PLACE, SURVEY, the hotbar and the carried block with visibility, so each keeps its place', () => {
    expect(CSS).toContain('.terrainview.is-folded :is(.terrain-tools, .terrain-hotbar) { visibility: hidden; }')
    expect(CSS).toContain('body:has(.terrainview.is-folded) .terrain-held { visibility: hidden; }')
  })
})
