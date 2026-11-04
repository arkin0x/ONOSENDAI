/**
 * walkKeys.test.ts - WALK's first-person keys: W forward, S back, A and D
 * sideways, Space or R up, C or F down; nothing with a modifier, no Ctrl.
 */
import { describe, expect, it } from 'vitest'
import { walkMove, walkPress, type WalkKeyEvent } from '../walkKeys'

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

describe('walkPress: W or S with A or D held', () => {
  const held = (...codes: string[]) => new Set(codes)

  it('W or S alone is forward or back with no side', () => {
    expect(walkPress('away', 'KeyW', held('KeyW'))).toEqual({ name: 'away', strafe: 0 })
    expect(walkPress('toward', 'KeyS', held('KeyS'))).toEqual({ name: 'toward', strafe: 0 })
  })

  it('W with D held is forward and right, with A forward and left; S the same backward', () => {
    expect(walkPress('away', 'KeyW', held('KeyW', 'KeyD'))).toEqual({ name: 'away', strafe: 1 })
    expect(walkPress('away', 'KeyW', held('KeyW', 'KeyA'))).toEqual({ name: 'away', strafe: -1 })
    expect(walkPress('toward', 'KeyS', held('KeyS', 'KeyD'))).toEqual({ name: 'toward', strafe: 1 })
  })

  it('whichever of the two the keyboard repeats: D pressed with W held is the same diagonal', () => {
    expect(walkPress('right', 'KeyD', held('KeyW', 'KeyD'))).toEqual({ name: 'away', strafe: 1 })
    expect(walkPress('left', 'KeyA', held('KeyS', 'KeyA'))).toEqual({ name: 'toward', strafe: -1 })
  })

  it('A or D alone, or with W and S both held, or A and D together, is the side step it always was', () => {
    expect(walkPress('right', 'KeyD', held('KeyD'))).toEqual({ name: 'right', strafe: 0 })
    expect(walkPress('right', 'KeyD', held('KeyW', 'KeyS', 'KeyD'))).toEqual({ name: 'right', strafe: 0 })
    expect(walkPress('right', 'KeyD', held('KeyW', 'KeyA', 'KeyD'))).toEqual({ name: 'right', strafe: 0 })
    expect(walkPress('away', 'KeyW', held('KeyW', 'KeyA', 'KeyD'))).toEqual({ name: 'away', strafe: 0 })
    // Up and down never take a side.
    expect(walkPress('up', 'Space', held('KeyW', 'KeyD'))).toEqual({ name: 'up', strafe: 0 })
  })
})
