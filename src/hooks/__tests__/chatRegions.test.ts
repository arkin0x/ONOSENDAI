/**
 * chatRegions.test.ts: the chat listens on the cube every line is sealed to
 * and its 26 neighbours, and not on the smaller cubes a walk changes at
 * every step (owner's walk, 2026-11-21: the chat subscription went out again
 * to every relay at every landing).
 */
import { describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
// The neighbours' keys come from a worker: one that never answers, as the test sets them itself.
;(globalThis as { Worker?: unknown }).Worker ??= class { postMessage(): void {} addEventListener(): void {} removeEventListener(): void {} terminate(): void {} }

const subs = vi.hoisted(() => ({ filters: [] as Array<{ '#d': string[] }> }))
vi.mock('../../lib/relay', async (real) => ({
  ...(await real<typeof import('../../lib/relay')>()),
  subscribe: (f: { '#d': string[] }) => { subs.filters.push(f); return () => {} },
}))

import { mountHook, settle } from '../../test/hookRoot'
import { chatRegions, useChatFeed } from '../useChatFeed'
import { sendKey } from '../../store/useChat'
import { useSecrets, type CurrentKey } from '../../store/useSecrets'
import { SCAN_MAX_HEIGHT } from '../../store/useShards'

/** The thirteen keys a scan finds where you stand, heights 0 to SCAN_MAX_HEIGHT; `step` varies the smaller cubes' ids, as a step does. */
function scan(step: number, wide = 'w'): Record<string, CurrentKey> {
  const out: Record<string, CurrentKey> = {}
  for (let h = 0; h <= SCAN_MAX_HEIGHT; h++) out[h === SCAN_MAX_HEIGHT ? `${wide}-${h}` : `s${step}-${h}`] = { keyHex: 'ab'.repeat(32), height: h }
  return out
}
const neighbors: Record<string, CurrentKey> = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`n${i}`, { keyHex: 'cd'.repeat(32), height: SCAN_MAX_HEIGHT }]))

describe('the regions the chat listens on', () => {
  it('are the widest cube you stand in and its 26 neighbours', () => {
    const ids = chatRegions(scan(0), neighbors).split(',')
    expect(ids).toHaveLength(27)
    expect(ids).toContain(`w-${SCAN_MAX_HEIGHT}`)
    expect(ids.some((id) => id.startsWith('s0-'))).toBe(false)
  })

  it('do not change when a step changes only the smaller cubes, so the subscription is not sent again', () => {
    const first = chatRegions(scan(0), neighbors)
    for (let step = 1; step < 20; step++) expect(chatRegions(scan(step), neighbors)).toBe(first)
    // Crossing into another wide cube does change them.
    expect(chatRegions(scan(20, 'w2'), neighbors)).not.toBe(first)
  })

  it('always hold the region a line is sealed to', () => {
    for (let step = 0; step < 5; step++) {
      const current = scan(step)
      useSecrets.setState({ current })
      expect(chatRegions(current, neighbors).split(',')).toContain(sendKey()!.lookupId)
    }
    // A scan that came back without the widest cube: lines go to the widest it has, and the chat listens there.
    const partial = Object.fromEntries(Object.entries(scan(1)).filter(([, k]) => k.height < 9))
    useSecrets.setState({ current: partial })
    expect(chatRegions(partial, {}).split(',')).toEqual([sendKey()!.lookupId])
  })

  it('listen on nothing before a scan', () => {
    expect(chatRegions({}, {})).toBe('')
  })
})

describe('the chat subscription on a walk', () => {
  it('is sent once for twenty steps inside one wide cube, and again on crossing into the next', async () => {
    subs.filters.length = 0
    useSecrets.setState({ current: scan(0), neighbors })
    const h = mountHook(() => useChatFeed(), undefined)
    await settle()
    expect(subs.filters).toHaveLength(1)
    for (let step = 1; step <= 20; step++) { useSecrets.getState().setCurrent(scan(step)); await settle(1) }
    expect(subs.filters).toHaveLength(1)
    expect(subs.filters[0]['#d']).toHaveLength(27)
    useSecrets.getState().setCurrent(scan(21, 'w2'))
    await settle()
    expect(subs.filters).toHaveLength(2)
    expect(subs.filters[1]['#d']).toContain(`w2-${SCAN_MAX_HEIGHT}`)
    await h.unmount()
  })
})
