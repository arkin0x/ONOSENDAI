/**
 * letterReveal.test.ts: how a hidden message opens (owner, 2026-11-26:
 * "decode effect for the message itself"): the seal cracks and the page
 * unfolds, then the words decode, about 1.1 s the first time and 0.3 s after,
 * not at all with reduced motion, and a tap skips to the words.
 */
import { describe, expect, it } from 'vitest'
import { DECODE_AGAIN_MS, DECODE_FIRST_MS, SHORT_MAX, isShortMessage, revealPlan, revealProgress, sealInitial } from '../letterReveal'

describe('a letter opening', () => {
  it('decodes for about 1.1 s the first time and 0.3 s after, and not at all with reduced motion', () => {
    expect(DECODE_FIRST_MS).toBe(1100)
    expect(DECODE_AGAIN_MS).toBe(300)
    expect(revealPlan(false, false).decodeMs).toBe(1100)
    expect(revealPlan(true, false).decodeMs).toBe(300)
    expect(revealPlan(false, false).unfoldMs).toBeGreaterThan(revealPlan(true, false).unfoldMs)
    expect(revealPlan(false, true)).toEqual({ unfoldMs: 0, decodeMs: 0 })
    expect(revealPlan(true, true)).toEqual({ unfoldMs: 0, decodeMs: 0 })
  })

  it('holds the words as glyphs through the unfold, resolves them over the decode, and a tap ends it', () => {
    const plan = revealPlan(false, false)
    expect(revealProgress(plan, 0, false)).toBe(0)
    expect(revealProgress(plan, plan.unfoldMs, false)).toBe(0)
    expect(revealProgress(plan, plan.unfoldMs + plan.decodeMs / 2, false)).toBeCloseTo(0.5, 9)
    expect(revealProgress(plan, plan.unfoldMs + plan.decodeMs, false)).toBe(1)
    expect(revealProgress(plan, 10, true)).toBe(1)
    expect(revealProgress(revealPlan(false, true), 0, false)).toBe(1)
  })

  it('sets a message of up to 80 letters large, and longer ones in the reading view', () => {
    expect(SHORT_MAX).toBe(80)
    expect(isShortMessage('The door on the north wall opens.')).toBe(true)
    expect(isShortMessage(`  ${'a'.repeat(80)}  `)).toBe(true)
    expect(isShortMessage('a'.repeat(81))).toBe(false)
  })

  it('puts the first letter of a name on the seal, or the key’s when the name starts with something the world cannot draw', () => {
    expect(sealInitial('molly', 'npub1xyz')).toBe('M')
    expect(sealInitial('  case', 'npub1xyz')).toBe('C')
    expect(sealInitial('7jane', 'npub1xyz')).toBe('7')
    expect(sealInitial('Ωmega', 'npub1qxyz')).toBe('Q')
    expect(sealInitial(undefined, 'npub1kq')).toBe('K')
    expect(sealInitial('', '')).toBe('?')
  })
})
