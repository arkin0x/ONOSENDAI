/**
 * The escape stack says when a modal is up, and tells its listeners: what the
 * controls pad hides behind (arkinox, 2026-10-10: the pad hovered over every
 * modal). A chip or the menu on the stack is not a modal.
 */
import { describe, expect, it } from 'vitest'
import { modalUp, registerEscape, subscribeEscape } from '../useEscape'

describe('modalUp', () => {
  it('is true while anything on the modal layer is registered, and not for chips or the menu', () => {
    expect(modalUp()).toBe(false)
    const offChip = registerEscape('chip', () => {})
    const offMenu = registerEscape('menu', () => {})
    expect(modalUp()).toBe(false)
    const offModal = registerEscape('modal', () => {})
    expect(modalUp()).toBe(true)
    const offSecond = registerEscape('modal', () => {})
    offModal()
    expect(modalUp()).toBe(true) // the second modal still stands
    offSecond()
    expect(modalUp()).toBe(false)
    offChip(); offMenu()
  })

  it('tells a listener on every registration and removal, and stops when unsubscribed', () => {
    let heard = 0
    const stop = subscribeEscape(() => { heard += 1 })
    const off = registerEscape('modal', () => {})
    expect(heard).toBe(1)
    off()
    expect(heard).toBe(2)
    off() // a second removal of the same entry changes nothing
    expect(heard).toBe(2)
    stop()
    const off2 = registerEscape('chip', () => {})
    off2()
    expect(heard).toBe(2)
  })
})
