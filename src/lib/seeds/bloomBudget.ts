/**
 * bloomBudget.ts - how much growing this device does for one bloom.
 *
 * Growing a bloom costs up to generations x symbols symbol steps (sno-core
 * worstCaseSteps, DECK-0008 §7), once per seed, and drawing it costs up to
 * its symbol and vertex caps once per block. The caps a planter paid for can
 * reach 4,194,304 steps (16,384 symbols for 256 generations). Measured on
 * Node 22, 2026-11-10, growing the vectors' six DNAs with sno-core v0.1.27:
 *
 *   - original DNAs' caps (6,000 symbols, 40 generations, worst case 240,000 steps):
 *     a full grow takes 1 to 9 ms, a draw 1 to 5 ms;
 *   - the largest caps at day 256: up to 3,043,297 steps, 68 ms to grow and
 *     17 ms to draw (the oak, 18,100 vertices).
 *
 * A phone is five to ten times slower, and a DNA can make each step dearer
 * than the original DNAs do (§3.8 bounds a step, not its cost). So a phone grows a
 * bloom whose caps allow at most PHONE_BUDGET steps, a larger screen at most
 * DESKTOP_BUDGET (every bloom the caps allow), and anything dearer waits for
 * GROW ANYWAY. Either way growth runs in a worker, SLICE_STEPS at a time, so
 * one bloom never holds the worker for long and the others take turns.
 */

import { worstCaseSteps, type Caps } from 'sno-core/seeds'

/** 2^20: four times the worst case at the original DNAs' caps; about a quarter second on a slow phone. */
export const PHONE_BUDGET = 1 << 20
/** 2^22: the largest caps DECK-0008 allows, so every bloom grows here. */
export const DESKTOP_BUDGET = 1 << 22
/** Steps one worker call may take before it hands back a partial bloom (sno-core GrowOptions.maxSteps). */
export const SLICE_STEPS = 1 << 18

/** This device's budget: a phone's, or a larger screen's. */
export function deviceBudget(phone: boolean): number {
  return phone ? PHONE_BUDGET : DESKTOP_BUDGET
}

/** Whether growing a DNA with these caps could pass the budget: then it waits for GROW ANYWAY. */
export function tooHeavy(caps: Caps, budget: number): boolean {
  return worstCaseSteps(caps) > budget
}

/** Whether this looks like a phone: a coarse pointer and a small screen. Read once, at first use. */
export function looksLikePhone(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen?.width ?? 9999, window.screen?.height ?? 9999) < 900
  } catch {
    return false
  }
}
