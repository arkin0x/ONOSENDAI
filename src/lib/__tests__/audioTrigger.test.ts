/**
 * audioTrigger.test.ts: a one-shot's trigger (DECK-0007 §5.2, arkinox's
 * ruling of 2026-10-23). Entering the sphere fires it once; entering again
 * in `once` mode does not, until RESET TRIGGER; `auto` fires on every entry;
 * nothing fires outside WALK mode when the item is walk-only, nor when it
 * loops or does not autoplay. Whether it fired is this device's record.
 */

import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { TRIGGER_START, forgetTriggers, hasTrigger, markFired, onTriggers, resetTrigger, stepTrigger, triggerFired, type TriggerState } from '../audioTrigger'

type Item = Parameters<typeof stepTrigger>[0]
const once: Item = { autoplay: true, loop: false, retrigger: 'once', walkOnly: false }
const auto: Item = { ...once, retrigger: 'auto' }

/**
 * Walk a listener through a list of frames (in the sphere or not, walking or
 * not) against the device's record for `id`, as the scene will, and count
 * the plays: a fire marks the record, as playback does.
 */
function walk(item: Item, id: string, frames: Array<{ in: boolean; walking?: boolean }>): number {
  let state: TriggerState = TRIGGER_START
  let plays = 0
  for (const f of frames) {
    const step = stepTrigger(item, state, { inSphere: f.in, walking: f.walking ?? true, fired: triggerFired(id) })
    state = step.state
    if (step.fire) { plays++; markFired(id) }
  }
  return plays
}

beforeEach(() => {
  localStorage.clear()
  forgetTriggers()
})

describe('a one-shot trigger', () => {
  it('fires once on entering the sphere, and not again while inside', () => {
    expect(walk(once, 'a', [{ in: false }, { in: true }, { in: true }, { in: true }])).toBe(1)
    expect(triggerFired('a')).toBe(true)
  })

  it('counts the first frame inside as an entry: finding it while standing in the sphere plays it', () => {
    expect(walk(once, 'b', [{ in: true }])).toBe(1)
  })

  it('in once mode, leaving and entering again does not fire it, even after a reload', () => {
    expect(walk(once, 'c', [{ in: true }, { in: false }, { in: true }, { in: false }, { in: true }])).toBe(1)
    forgetTriggers()
    expect(walk(once, 'c', [{ in: false }, { in: true }])).toBe(0)
  })

  it('RESET TRIGGER re-arms it: the next entry plays it once more', () => {
    expect(walk(once, 'd', [{ in: true }, { in: false }])).toBe(1)
    resetTrigger('d')
    expect(triggerFired('d')).toBe(false)
    expect(walk(once, 'd', [{ in: false }, { in: true }, { in: false }, { in: true }])).toBe(1)
  })

  it('a reset while standing inside waits for leaving and entering again', () => {
    let state: TriggerState = TRIGGER_START
    state = stepTrigger(once, state, { inSphere: true, walking: true, fired: false }).state
    markFired('e')
    resetTrigger('e')
    const still = stepTrigger(once, state, { inSphere: true, walking: true, fired: triggerFired('e') })
    expect(still.fire).toBe(false)
    const out = stepTrigger(once, still.state, { inSphere: false, walking: true, fired: false })
    expect(stepTrigger(once, out.state, { inSphere: true, walking: true, fired: false }).fire).toBe(true)
  })

  it('in automatic mode fires on every entry', () => {
    expect(walk(auto, 'f', [{ in: true }, { in: true }, { in: false }, { in: true }, { in: false }, { in: false }, { in: true }])).toBe(3)
  })

  it('walk-only: never fires outside WALK mode, and stepping into WALK inside the sphere is an entry', () => {
    const walkOnly = { ...once, walkOnly: true }
    expect(walk(walkOnly, 'g', [{ in: true, walking: false }, { in: true, walking: false }, { in: false, walking: false }, { in: true, walking: false }])).toBe(0)
    expect(triggerFired('g')).toBe(false)
    expect(walk(walkOnly, 'g', [{ in: true, walking: false }, { in: true, walking: true }])).toBe(1)
    const autoWalk = { ...auto, walkOnly: true }
    // Leaving WALK is leaving: back in WALK inside the sphere fires again.
    expect(walk(autoWalk, 'h', [{ in: true, walking: true }, { in: true, walking: false }, { in: true, walking: true }])).toBe(2)
  })

  it('has no trigger when it loops or does not autoplay: those play only from the card, or as a loop', () => {
    expect(hasTrigger(once)).toBe(true)
    expect(hasTrigger({ autoplay: false, loop: false })).toBe(false)
    expect(hasTrigger({ autoplay: true, loop: true })).toBe(false)
    expect(walk({ ...once, autoplay: false }, 'i', [{ in: false }, { in: true }])).toBe(0)
    expect(walk({ ...auto, loop: true }, 'j', [{ in: false }, { in: true }])).toBe(0)
  })
})

describe('the fired record', () => {
  it('is kept on this device only, in localStorage, and tells its listeners', () => {
    let told = 0
    const off = onTriggers(() => { told++ })
    markFired('k')
    markFired('k')
    expect(told).toBe(1)
    expect(JSON.parse(localStorage.getItem('onosendai:audio-fired') ?? '[]')).toEqual(['k'])
    resetTrigger('k')
    resetTrigger('k')
    expect(told).toBe(2)
    off()
    markFired('l')
    expect(told).toBe(2)
  })
})
