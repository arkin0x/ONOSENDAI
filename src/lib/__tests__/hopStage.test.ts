/**
 * hopStage.test.ts: what can wait for your own avatar's glide waits for it,
 * and then runs; nothing waits forever (owner, 2026-11-12: the first hop
 * froze and the avatar appeared at its destination with no glide).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AVATAR_LERP_MS } from '../avatarLerp'
import { HOP_SETTLE_SLACK_MS, afterHop, frameBudget, glideDone, glideStart, holdGlide, hopLanding, hopSettling, resetHopStage, yieldTask } from '../hopStage'

beforeEach(() => { vi.useFakeTimers(); resetHopStage() })
afterEach(() => { resetHopStage(); vi.useRealTimers() })

describe('afterHop', () => {
  it('runs at once when no move of yours is landing', () => {
    const fn = vi.fn()
    afterHop(fn)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('waits from the landing until the avatar arrives, then runs each in a slot of its own, in order', () => {
    const order: string[] = []
    hopLanding(0)
    expect(hopSettling()).toBe(true)
    afterHop(() => order.push('discovery'))
    afterHop(() => order.push('camera'))
    vi.advanceTimersByTime(AVATAR_LERP_MS / 2)
    expect(order).toEqual([])
    glideDone()
    expect(hopSettling()).toBe(false)
    // Not inside glideDone (a frame of the scene): in the next idle slots.
    expect(order).toEqual([])
    vi.runOnlyPendingTimers()
    expect(order).toEqual(['discovery', 'camera'])
  })

  it('never waits past the planned glide and its slack: a scene not drawing never reports arriving', () => {
    const fn = vi.fn()
    hopLanding(0)
    afterHop(fn)
    vi.advanceTimersByTime(AVATAR_LERP_MS + HOP_SETTLE_SLACK_MS - 1)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    vi.runOnlyPendingTimers()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(hopSettling()).toBe(false)
  })

  it('a move landing while one still settles keeps the first deadline: quick moves never put the work off for good', () => {
    const fn = vi.fn()
    hopLanding(0)
    afterHop(fn)
    for (let t = 400; t < AVATAR_LERP_MS + HOP_SETTLE_SLACK_MS; t += 400) {
      vi.advanceTimersByTime(400)
      hopLanding(t)
    }
    vi.advanceTimersByTime(400)
    vi.runOnlyPendingTimers()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('a glide that ends with no landing waiting changes nothing', () => {
    glideDone()
    const fn = vi.fn()
    afterHop(fn)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('one failing piece of deferred work does not stop the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fn = vi.fn()
    hopLanding(0)
    afterHop(() => { throw new Error('no') })
    afterHop(fn)
    glideDone()
    vi.runOnlyPendingTimers()
    expect(fn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('holdGlide', () => {
  it('holds the next glide until the camera is in place, once', () => {
    holdGlide(500)
    expect(glideStart(100)).toBe(500)
    expect(glideStart(120)).toBe(120)
  })

  it('a hold already past holds nothing', () => {
    holdGlide(500)
    expect(glideStart(800)).toBe(800)
  })

  it('stretches the wait for the arrival by the hold', () => {
    const fn = vi.fn()
    holdGlide(500)
    hopLanding(100)
    afterHop(fn)
    vi.advanceTimersByTime(400 + AVATAR_LERP_MS + HOP_SETTLE_SLACK_MS - 50)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    vi.runOnlyPendingTimers()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('frameBudget', () => {
  it('yields to the browser only once the budget is spent', async () => {
    vi.useRealTimers()
    let now = 0
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now)
    const yields = vi.fn(async () => {})
    const pause = frameBudget(8, yields)
    now = 5
    await pause()
    expect(yields).not.toHaveBeenCalled()
    now = 9
    await pause()
    expect(yields).toHaveBeenCalledTimes(1)
    now = 12
    await pause()
    expect(yields).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('yields with a task a hidden tab does not hold back', async () => {
    vi.useRealTimers()
    await expect(yieldTask()).resolves.toBeUndefined()
  })
})
