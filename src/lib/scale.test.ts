/**
 * scale.test.ts - a cell's size reads in the unit it is best read in, short
 * for the ladder and spelled out for the readout; the step reads in gibsons.
 */

import { describe, it, expect } from 'vitest'
import { formatCellSize, formatCellSizeLong } from './scale'
import { formatStep } from './space'

describe('cell size', () => {
  it('spells the unit out for the readout and abbreviates it for the ladder', () => {
    expect(formatCellSize(0)).toBe('116 pm')
    expect(formatCellSizeLong(0)).toBe('116 picometers')
    expect(formatCellSizeLong(33)).toBe('1 meter')
    expect(formatCellSizeLong(34)).toBe('2 meters')
    expect(formatCellSizeLong(43)).toBe('1.02 kilometers')
    expect(formatCellSizeLong(84)).toMatch(/astronomical units$/)
  })
})

describe('step', () => {
  it('reads in gibsons, singular at 2^0', () => {
    expect(formatStep(0)).toBe('1 gibson')
    expect(formatStep(10)).toBe('1,024 gibsons')
    expect(formatStep(40)).toBe('2^40 gibsons')
  })
})
