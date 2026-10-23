/** opacityStep.test.ts - the workshop's OPACITY stepper moves in fives between the floor and solid. */

import { describe, expect, it } from 'vitest'
import { opacityPercent, stepOpacity } from '../opacityStep'

describe('the OPACITY stepper', () => {
  it('reads no opacity as solid', () => {
    expect(opacityPercent(undefined)).toBe(100)
    expect(opacityPercent(40)).toBe(40)
  })

  it('steps in fives, and stops at the floor and at solid', () => {
    expect(stepOpacity(undefined, -1)).toBe(95)
    expect(stepOpacity(95, 1)).toBe(100)
    expect(stepOpacity(100, 1)).toBe(100)
    expect(stepOpacity(15, -1)).toBe(10)
    expect(stepOpacity(10, -1)).toBe(10)
  })

  it('takes a value off the fives to the next five in the direction asked', () => {
    expect(stepOpacity(33, 1)).toBe(35)
    expect(stepOpacity(33, -1)).toBe(30)
    expect(stepOpacity(3, 1)).toBe(10)
  })
})
