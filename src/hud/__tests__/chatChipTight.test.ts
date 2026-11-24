/**
 * chatChipTight.test.ts - CHAT's chip drops its word when the bottom row has
 * no room for it (owner, 2026-11-24: "at this size, Chat chip should lose
 * 'chat' and just have the conversation bubble"), measured against what the
 * row keeps clear of it, never a breakpoint.
 */

import { describe, expect, it } from 'vitest'
import { chipCrowded } from '../ChatDock'

const box = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height })

describe('the CHAT chip', () => {
  const chip = box(110, 840, 90, 29)

  it('keeps its word with room to spare beside the hotbar', () => {
    expect(chipCrowded(chip, 90, [box(300, 838, 400, 40)])).toBe(false)
  })

  it('drops to the bubble when its full width would touch the hotbar, or come within 6px of it', () => {
    expect(chipCrowded(chip, 90, [box(195, 838, 400, 40)])).toBe(true)
    expect(chipCrowded(chip, 90, [box(204, 838, 400, 40)])).toBe(true)
    expect(chipCrowded(chip, 90, [box(207, 838, 400, 40)])).toBe(false)
  })

  it('pays no mind to what is on another row, or not drawn', () => {
    expect(chipCrowded(chip, 90, [box(150, 700, 400, 32)])).toBe(false)
    expect(chipCrowded(chip, 90, [box(150, 838, 0, 0)])).toBe(false)
  })

  it('measures the word\'s width it would need, not the narrow chip it is while tight', () => {
    // Narrow now (the bubble alone, 29px), but its full width (90px) would still touch: it stays tight.
    expect(chipCrowded({ ...chip, right: chip.left + 29 }, 90, [box(195, 838, 400, 40)])).toBe(true)
  })
})
