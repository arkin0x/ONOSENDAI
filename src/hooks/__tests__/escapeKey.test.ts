/**
 * Escape closes the top layer even from a field: a modal that focuses its own
 * input (ITEM FEED's search, a chest's name, the login box) could not be
 * closed from the keyboard at all (pre-class smoke test, 2026-10-16).
 */
import { afterEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const { registerEscape } = await import('../useEscape')
const { escapeKey } = await import('../useKeyboard')

let undo: Array<() => void> = []
afterEach(() => { undo.forEach((u) => u()); undo = [] })

const key = (code: string, extra: Partial<{ defaultPrevented: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => {
  const e = { code, defaultPrevented: false, metaKey: false, ctrlKey: false, altKey: false, ...extra, prevented: false, preventDefault() { this.prevented = true } }
  return e
}

describe('Escape from anywhere, a field included', () => {
  it('closes the top modal', () => {
    let closed = 0
    undo.push(registerEscape('modal', () => { closed++ }))
    const e = key('Escape')
    expect(escapeKey(e)).toBe(true)
    expect(closed).toBe(1)
    expect(e.prevented).toBe(true)
  })

  it('leaves an Escape the field already handled (the chat line\'s mention list)', () => {
    let closed = 0
    undo.push(registerEscape('modal', () => { closed++ }))
    expect(escapeKey(key('Escape', { defaultPrevented: true }))).toBe(true)
    expect(closed).toBe(0)
  })

  it('leaves a browser shortcut alone, and ignores every other key', () => {
    let closed = 0
    undo.push(registerEscape('modal', () => { closed++ }))
    expect(escapeKey(key('Escape', { metaKey: true }))).toBe(true)
    expect(escapeKey(key('KeyW'))).toBe(false)
    expect(closed).toBe(0)
  })
})
