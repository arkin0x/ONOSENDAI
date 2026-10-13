/**
 * walkKeys.test.ts - WALK's first-person keys: W forward, S back, A and D
 * sideways, Space or R up, C or F down; nothing with a modifier, no Ctrl.
 */
import { describe, expect, it } from 'vitest'
import { walkMove, type WalkKeyEvent } from '../walkKeys'

const key = (code: string, more: Partial<WalkKeyEvent> = {}): WalkKeyEvent => ({
  code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...more,
})

describe('walkMove', () => {
  it('maps WASD first-person style', () => {
    expect(walkMove(key('KeyW'))).toBe('away')
    expect(walkMove(key('KeyS'))).toBe('toward')
    expect(walkMove(key('KeyA'))).toBe('left')
    expect(walkMove(key('KeyD'))).toBe('right')
  })

  it('puts up on Space and R, down on C and F', () => {
    expect(walkMove(key('Space'))).toBe('up')
    expect(walkMove(key('KeyR'))).toBe('up')
    expect(walkMove(key('KeyC'))).toBe('down')
    expect(walkMove(key('KeyF'))).toBe('down')
  })

  it('has no Ctrl binding', () => {
    expect(walkMove(key('ControlLeft', { ctrlKey: true }))).toBeNull()
    expect(walkMove(key('ControlRight', { ctrlKey: true }))).toBeNull()
  })

  it('leaves every key with a modifier to the browser or the view', () => {
    expect(walkMove(key('KeyW', { ctrlKey: true }))).toBeNull()
    expect(walkMove(key('KeyC', { ctrlKey: true }))).toBeNull()
    expect(walkMove(key('KeyW', { shiftKey: true }))).toBeNull()
    expect(walkMove(key('KeyD', { metaKey: true }))).toBeNull()
    expect(walkMove(key('KeyR', { altKey: true }))).toBeNull()
  })

  it('has nothing for keys that are not WALK\'s', () => {
    expect(walkMove(key('KeyX'))).toBeNull()
    expect(walkMove(key('KeyQ'))).toBeNull()
    expect(walkMove(key('KeyE'))).toBeNull()
  })
})
