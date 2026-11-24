/**
 * crashNote.test.tsx: the crash note where the app, the 3D view or a coach
 * used to go black (README "Browsers"; arkinox, 2026-11-23, an old iPad).
 *
 * - The whole app's and the 3D view's notes offer RELOAD and COPY, never
 *   CLOSE: closing would draw the same thing again and crash again.
 * - A WebGL context the browser refused is said in plain words; another
 *   error that names WebGL (a shader) is not told to close tabs.
 * - A coach's CLOSE also puts its tour away (onClose).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

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

import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { CrashNote } from '../CrashNote'

/** The note as it draws after catching `error`. */
function noteFor(error: Error, props: Partial<ConstructorParameters<typeof CrashNote>[0]> = {}): { html: string; note: CrashNote } {
  const note = new CrashNote({ where: 'the 3D view', children: null, ...props })
  note.state = { error, stack: `${error.name}: ${error.message}`, copied: false }
  return { html: renderToString(note.render() as ReactElement), note }
}

afterEach(() => { vi.restoreAllMocks() })

describe('the crash note', () => {
  it('offers CLOSE by default, as the HUD and modal notes always have', () => {
    const { html } = noteFor(new TypeError('x is undefined'), { where: 'a modal' })
    expect(html).toMatch(/>CLOSE</)
    expect(html).toMatch(/class="modal-close"/)
    expect(html).toMatch(/>RELOAD</)
  })

  it('offers RELOAD and COPY only where closing would crash again', () => {
    const { html } = noteFor(new Error('Error creating WebGL context.'), { closable: false })
    expect(html).not.toMatch(/>CLOSE</)
    expect(html).not.toMatch(/class="modal-close"/)
    expect(html).toMatch(/>RELOAD</)
    expect(html).toMatch(/>COPY</)
  })

  it('says a refused WebGL context in plain words, and nothing of the kind for a shader error', () => {
    expect(noteFor(new Error('Error creating WebGL context.')).html).toMatch(/class="crash__hint">3D graphics \(WebGL 2\) could not start/)
    expect(noteFor(new Error('THREE.WebGLProgram: Shader Error 1282 - VALIDATE_STATUS false')).html).not.toMatch(/crash__hint/)
  })

  it("runs a coach's onClose on CLOSE, then draws its part again", () => {
    const onClose = vi.fn()
    const { note } = noteFor(new TypeError('Object.hasOwn is not a function'), { where: 'the tutorial', onClose })
    const setState = vi.spyOn(note, 'setState').mockImplementation(() => undefined)
    ;(note as unknown as { close: () => void }).close()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(setState).toHaveBeenCalledWith({ error: null, stack: '', copied: false })
  })
})
