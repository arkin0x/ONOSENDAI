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

import { findLcaHeight } from 'cyberspace-core'
import { SECRETS_MAX, bytesOf, heldList, keyStateForAction, useSecrets, type HeldKey, volumeExponent } from './useSecrets'

const key = (over: Partial<HeldKey> = {}): HeldKey => ({
  lookupId: 'aa'.repeat(32),
  keyHex: 'bb'.repeat(32),
  height: 8,
  base: { x: '256', y: '512', z: '768' },
  plane: 0,
  source: 'scan',
  at: 1_800_000_000,
  ...over,
})

describe('the keys you hold', () => {
  beforeEach(() => { useSecrets.setState({ keys: {} }); localStorage.clear() })

  it('holds a region once, however often you stand in it', () => {
    useSecrets.getState().hold([key()])
    useSecrets.getState().hold([key({ at: 1_800_000_999 })])
    expect(Object.keys(useSecrets.getState().keys)).toHaveLength(1)
    // The first holding is kept: when you found it is when you found it.
    expect(useSecrets.getState().keys['aa'.repeat(32)].at).toBe(1_800_000_000)
  })

  it('survives a reload', () => {
    useSecrets.getState().hold([key()])
    useSecrets.setState({ keys: {} })
    useSecrets.getState().load()
    expect(Object.keys(useSecrets.getState().keys)).toHaveLength(1)
  })

  it('forgetting one leaves the rest', () => {
    useSecrets.getState().hold([key(), key({ lookupId: 'cc'.repeat(32), height: 9 })])
    useSecrets.getState().forget('aa'.repeat(32))
    expect(Object.keys(useSecrets.getState().keys)).toEqual(['cc'.repeat(32)])
  })

  it('keeps the newest when there are too many', () => {
    const many = Array.from({ length: SECRETS_MAX + 20 }, (_, i) =>
      key({ lookupId: i.toString(16).padStart(64, '0'), at: 1_800_000_000 + i }))
    useSecrets.getState().hold(many)
    const held = heldList(useSecrets.getState().keys)
    expect(held).toHaveLength(SECRETS_MAX)
    expect(held[0].at).toBe(1_800_000_000 + SECRETS_MAX + 19)
  })

  it('is small on disk', () => {
    expect(bytesOf(key())).toBeLessThan(400)
  })
})

describe('what an action left behind', () => {
  const at = (x: bigint): { x: bigint; y: bigint; z: bigint } => ({ x, y: 1n << 40n, z: 1n << 40n })
  const prev = { position: at(1n << 40n) }
  const hop = { type: 'hop', position: at((1n << 40n) ^ (1n << 9n)), plane: 0 as const }

  it('a sidestep yields no key, which is the point of a sidestep', () => {
    const side = { type: 'sidestep', position: hop.position, plane: 0 as const }
    expect(keyStateForAction(side, prev, {}, findLcaHeight).state).toBe('none')
  })

  it('a spawn comes from nowhere and crosses nothing', () => {
    expect(keyStateForAction({ type: 'spawn', position: at(1n << 40n), plane: 0 }, null, {}, findLcaHeight).state).toBe('none')
  })

  it('a hop yields one, and says when it is no longer held', () => {
    const got = keyStateForAction(hop, prev, {}, findLcaHeight)
    expect(got.state).toBe('gone')
    expect(got.height).toBe(10)
  })

  it('a hop whose region is in the list reads as held', () => {
    const h = 10n
    const held = key({
      lookupId: 'dd'.repeat(32),
      height: 10,
      base: {
        x: String((hop.position.x >> h) << h),
        y: String((hop.position.y >> h) << h),
        z: String((hop.position.z >> h) << h),
      },
    })
    const got = keyStateForAction(hop, prev, { [held.lookupId]: held }, findLcaHeight)
    expect(got.state).toBe('held')
  })

  it('a key for the same region in the other plane is not this one', () => {
    const h = 10n
    const held = key({
      lookupId: 'ee'.repeat(32),
      height: 10,
      plane: 1,
      base: {
        x: String((hop.position.x >> h) << h),
        y: String((hop.position.y >> h) << h),
        z: String((hop.position.z >> h) << h),
      },
    })
    expect(keyStateForAction(hop, prev, { [held.lookupId]: held }, findLcaHeight).state).toBe('gone')
  })
})

describe('the order of the list', () => {
  const at = (id: string, when: number, heights: { x: number; y: number; z: number }): HeldKey =>
    key({ lookupId: id.repeat(32), at: when, height: Math.max(heights.x, heights.y, heights.z), heights })

  const keys = {
    ['aa'.repeat(32)]: at('aa', 300, { x: 4, y: 4, z: 4 }),   // volume 2^12, newest
    ['bb'.repeat(32)]: at('bb', 200, { x: 20, y: 0, z: 0 }),  // volume 2^20, a long bar
    ['cc'.repeat(32)]: at('cc', 100, { x: 8, y: 8, z: 8 }),   // volume 2^24, oldest and biggest
  }

  it('by most recent puts the newest first', () => {
    expect(heldList(keys, 'recent').map((k) => k.at)).toEqual([300, 200, 100])
  })

  it('by volume puts the largest first, whatever its shape', () => {
    expect(heldList(keys, 'volume').map((k) => volumeExponent(k))).toEqual([24, 20, 12])
  })

  it('measures a box by its whole volume, not its longest side', () => {
    // A bar 2^20 long is a bigger region than a cube of side 2^6 (2^18).
    expect(volumeExponent(at('dd', 1, { x: 20, y: 0, z: 0 }))).toBe(20)
    expect(volumeExponent(at('ee', 1, { x: 6, y: 6, z: 6 }))).toBe(18)
  })

  it('a cube with no per-axis heights is still cubed', () => {
    expect(volumeExponent(key({ height: 5 }))).toBe(15)
  })

  it('defaults to most recent', () => {
    expect(heldList(keys).map((k) => k.at)).toEqual([300, 200, 100])
  })
})
