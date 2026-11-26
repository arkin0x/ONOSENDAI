/**
 * glyphAtlasRestore.test.tsx: the glyph rings come back after the app comes
 * back (owner, 2026-11-27: "the ring of glyphs disappear sometimes like when
 * i left the app to type this and came back they were gone and i had to
 * refresh the app to get them back").
 *
 * The atlas's pixels are held in the texture's own array, not in a canvas a
 * mobile browser may empty while the page is hidden, so when the WebGL
 * context is taken and given back three uploads them whole again. And the
 * atlas is drawn again and sent again when the context comes back and when
 * the page shows again. Run in a real R3F root (test/r3fRoot.ts), with a
 * stand-in canvas for drawing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'

vi.mock('@react-three/drei', async () => {
  const { createElement: h, forwardRef } = await import('react')
  return { Text: forwardRef((props: { position?: unknown }, ref) => h('group', { name: 'text', ref, position: props.position })) }
})

import { ATLAS_SIDE, forgetGlyphAtlas, glyphAtlas, refreshGlyphAtlas } from '../glyphAtlas'
import { dropLetter, LetterField, putLetter } from '../LetterField'

;(globalThis as { window?: unknown }).window ??= globalThis

/** A page with a 2D canvas whose pixels are `fill` until the browser empties it (`emptied`). */
const page = { fill: 255, emptied: false }
const listeners = new Map<string, Array<() => void>>()
const fakeDocument = {
  visibilityState: 'visible',
  addEventListener: (type: string, fn: () => void) => { listeners.set(type, [...(listeners.get(type) ?? []), fn]) },
  removeEventListener: (type: string, fn: () => void) => { listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)) },
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect: () => {}, fillText: () => {}, font: '', fillStyle: '', textAlign: '', textBaseline: '',
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(page.emptied ? 0 : page.fill) }),
    }),
  }),
  fonts: { ready: new Promise(() => {}) },
}

let r: R3fRoot | null = null
beforeEach(() => {
  ;(globalThis as { document?: unknown }).document = fakeDocument
  listeners.clear()
  page.fill = 255
  page.emptied = false
  forgetGlyphAtlas()
})
afterEach(async () => {
  await r?.unmount()
  r = null
  dropLetter('m1')
  delete (globalThis as { document?: unknown }).document
  forgetGlyphAtlas()
})

describe('the glyph atlas', () => {
  it('keeps its pixels in its own memory, not in a canvas the browser may empty', () => {
    const atlas = glyphAtlas()
    const data = atlas.image.data as Uint8Array
    expect(data).toBeInstanceOf(Uint8Array)
    expect(data.length).toBe(ATLAS_SIDE * ATLAS_SIDE * 4)
    expect(data[0]).toBe(255)
    // The page hides and the browser empties every 2D canvas: the atlas still holds its glyphs.
    page.emptied = true
    expect((glyphAtlas().image.data as Uint8Array)[0]).toBe(255)
  })

  it('is drawn again and sent again on refresh; a draw that comes back empty keeps what it had', () => {
    const atlas = glyphAtlas()
    const v = atlas.version
    page.fill = 200
    refreshGlyphAtlas()
    expect(atlas.version).toBeGreaterThan(v)
    expect((atlas.image.data as Uint8Array)[0]).toBe(200)
  })

  it('a letter field sends the atlas again when the WebGL context comes back and when the page shows again', async () => {
    r = await r3fRoot()
    await r.render(createElement('group'))
    const canvasHandlers = new Map<string, () => void>()
    const el = r.state().gl.domElement as unknown as { addEventListener: (t: string, f: () => void) => void; removeEventListener: () => void }
    el.addEventListener = (t, f) => { canvasHandlers.set(t, f) }
    el.removeEventListener = () => {}
    putLetter({ key: 'm1', centre: [0, 0, 0], width: 1, colour: '#ffcf6b', initial: 0, broken: false })
    await r.render(createElement(LetterField))
    const atlas = glyphAtlas()
    // The context is lost and restored.
    let v = atlas.version
    canvasHandlers.get('webglcontextrestored')!()
    expect(atlas.version).toBeGreaterThan(v)
    // The app goes to the background and comes back.
    v = atlas.version
    fakeDocument.visibilityState = 'hidden'
    for (const f of listeners.get('visibilitychange') ?? []) f()
    expect(atlas.version).toBe(v)
    fakeDocument.visibilityState = 'visible'
    for (const f of listeners.get('visibilitychange') ?? []) f()
    expect(atlas.version).toBeGreaterThan(v)
  })
})
