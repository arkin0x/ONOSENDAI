import { afterEach, describe, expect, it } from 'vitest'
import { escapeTop, nextEscapeOrder, registerEscape, topEscape, type EscapeLayer } from '../useEscape'

// The stack is module state, as it is in the app. Every test takes off what it
// put on, so none of them sees another's entries.
let undo: Array<() => void> = []
afterEach(() => { undo.forEach((u) => u()); undo = [] })

/** Open something: a closer that takes itself off the stack, as a real one does by unmounting. */
function open(layer: EscapeLayer, name: string, log: string[], order?: number): void {
  let off = (): void => {}
  off = registerEscape(layer, () => { log.push(name); off() }, order)
  undo.push(off)
}

describe('the Escape stack', () => {
  it('does nothing, and says so, when nothing is open (no more reset to top down)', () => {
    expect(topEscape()).toBeNull()
    expect(escapeTop()).toBe(false)
  })

  it('closes a modal, then the menu, then a chip, one per press, whatever order they opened in', () => {
    const log: string[] = []
    open('chip', 'chat', log)
    open('menu', 'menu', log)
    open('modal', 'profile', log)
    open('chip', 'explorer', log)
    expect(escapeTop()).toBe(true)
    expect(escapeTop()).toBe(true)
    expect(escapeTop()).toBe(true)
    expect(escapeTop()).toBe(true)
    expect(escapeTop()).toBe(false)
    // Chips go most recent first: the explorer opened after the chat.
    expect(log).toEqual(['profile', 'menu', 'explorer', 'chat'])
  })

  it('closes a confirmation over a modal before the modal', () => {
    const log: string[] = []
    open('modal', 'secrets', log)
    open('modal', 'forget all?', log)
    escapeTop()
    expect(log).toEqual(['forget all?'])
    escapeTop()
    expect(log).toEqual(['forget all?', 'secrets'])
  })

  it('orders by the opening taken at render, not by when the entry was added', () => {
    // A modal and its own confirmation mounting in one commit: the parent
    // renders first and takes the earlier place, but React runs the child's
    // effect first, so the child's entry is ADDED first. The order taken at
    // render is what decides.
    const log: string[] = []
    const parent = nextEscapeOrder()
    const child = nextEscapeOrder()
    open('modal', 'confirm', log, child)
    open('modal', 'dialog', log, parent)
    escapeTop()
    expect(log).toEqual(['confirm'])
  })

  it('leaves a closer that keeps its entry on top, for a closer that works in steps', () => {
    // The workshop: each press closes a panel, then clears, then closes; the
    // entry stays until the last step unmounts it.
    const steps = ['panel', 'selection', 'workshop']
    const done: string[] = []
    undo.push(registerEscape('modal', () => { done.push(steps[done.length]) }))
    open('chip', 'chat', [])
    escapeTop()
    escapeTop()
    escapeTop()
    expect(done).toEqual(['panel', 'selection', 'workshop'])
    expect(topEscape()?.layer).toBe('modal')
  })

  it('forgets a closed thing, so the next press reaches what is under it', () => {
    const log: string[] = []
    open('chip', 'scrubber', log)
    const off = registerEscape('modal', () => log.push('never'))
    off()
    expect(topEscape()?.layer).toBe('chip')
    escapeTop()
    expect(log).toEqual(['scrubber'])
  })
})
