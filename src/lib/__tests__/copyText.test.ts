/**
 * copyText (owner, 2026-11-16: coordinates and sectors tap to copy): the
 * Clipboard API first, and the old copy command where the API is missing or
 * refuses, so a phone on a plain-http page or a refusing browser still
 * copies. Never rejects.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyByCommand, copyText } from '../copyText'

/** A document just big enough for the old way: one textarea, execCommand, focus. */
function fakeDoc(copies: boolean | 'throws') {
  const appended: { value: string; selected: [number, number] | null; attrs: Record<string, string> }[] = []
  let removed = 0
  const before = { focus: vi.fn() }
  const doc = {
    activeElement: before,
    body: {
      appendChild: (el: (typeof appended)[number]) => { appended.push(el) },
      removeChild: () => { removed++ },
    },
    createElement: () => {
      const el = {
        value: '',
        style: { cssText: '' },
        selected: null as [number, number] | null,
        attrs: {} as Record<string, string>,
        setAttribute(k: string, v: string) { el.attrs[k] = v },
        focus: vi.fn(),
        select: vi.fn(),
        setSelectionRange(a: number, b: number) { el.selected = [a, b] },
      }
      return el
    },
    execCommand: vi.fn(() => { if (copies === 'throws') throw new Error('nope'); return copies }),
  }
  return { doc: doc as unknown as Document, appended, removed: () => removed, before, execCommand: doc.execCommand }
}

const realNavigator = globalThis.navigator
const realDocument = (globalThis as { document?: Document }).document
function setNavigator(nav: unknown): void {
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true })
}
afterEach(() => {
  setNavigator(realNavigator)
  ;(globalThis as { document?: Document }).document = realDocument
})

describe('copyByCommand', () => {
  it('selects the whole text in a read-only field, copies, removes the field and gives focus back', () => {
    const f = fakeDoc(true)
    const text = 'a'.repeat(64)
    expect(copyByCommand(text, f.doc)).toBe(true)
    expect(f.appended).toHaveLength(1)
    expect(f.appended[0].value).toBe(text)
    expect(f.appended[0].attrs.readonly).toBe('')
    expect(f.appended[0].selected).toEqual([0, 64])
    expect(f.execCommand).toHaveBeenCalledWith('copy')
    expect(f.removed()).toBe(1)
    expect(f.before.focus).toHaveBeenCalled()
  })

  it('says false when the browser will not copy, or throws, and still cleans up', () => {
    for (const how of [false, 'throws'] as const) {
      const f = fakeDoc(how)
      expect(copyByCommand('x', f.doc)).toBe(false)
      expect(f.removed()).toBe(1)
    }
  })
})

describe('copyText', () => {
  it('uses the Clipboard API when it works, and never the old way', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    setNavigator({ clipboard: { writeText } })
    const f = fakeDoc(true)
    ;(globalThis as { document?: Document }).document = f.doc
    await expect(copyText('cfe6b74c00ff8254ef')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('cfe6b74c00ff8254ef')
    expect(f.execCommand).not.toHaveBeenCalled()
  })

  it('falls back to the copy command when the Clipboard API refuses', async () => {
    setNavigator({ clipboard: { writeText: () => Promise.reject(new Error('NotAllowedError')) } })
    const f = fakeDoc(true)
    ;(globalThis as { document?: Document }).document = f.doc
    await expect(copyText('25200497907045552-36003453695486078-14837699276459992')).resolves.toBe(true)
    expect(f.appended[0].value).toBe('25200497907045552-36003453695486078-14837699276459992')
    expect(f.execCommand).toHaveBeenCalledWith('copy')
  })

  it('falls back at once when there is no Clipboard API (a plain-http page)', async () => {
    setNavigator({})
    const f = fakeDoc(true)
    ;(globalThis as { document?: Document }).document = f.doc
    const p = copyText('abc')
    // Synchronously, inside the tap: before the promise is even awaited.
    expect(f.execCommand).toHaveBeenCalledWith('copy')
    await expect(p).resolves.toBe(true)
  })

  it('resolves false, never rejects, when neither way works', async () => {
    setNavigator({ clipboard: { writeText: () => Promise.reject(new Error('no')) } })
    ;(globalThis as { document?: Document }).document = fakeDoc(false).doc
    await expect(copyText('abc')).resolves.toBe(false)
  })
})
