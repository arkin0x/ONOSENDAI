/**
 * crewButtonTwoTaps.test.tsx - a player's card never takes someone off your
 * Crew in one tap (owner's rule: no destructive one-tap controls). ADD TO
 * CREW adds at once; IN YOUR CREW asks TAP AGAIN TO TAKE OFF, and only the
 * second tap takes them off; let the ask run out and nothing happens. Taken
 * off some other way, the button starts from one tap again.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
    key: () => null,
    get length() { return mem.size },
  }
}

const calls = vi.hoisted(() => ({ added: [] as string[], removed: [] as string[] }))
vi.mock('../../store/terrainShare', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../store/terrainShare')>()
  return {
    ...real,
    addCrew: vi.fn(async (pk: string) => { calls.added.push(pk); real.useShare.setState({ crew: [...real.useShare.getState().crew, pk] }); return true }),
    removeCrew: vi.fn(async (pk: string) => { calls.removed.push(pk); real.useShare.setState({ crew: real.useShare.getState().crew.filter((p) => p !== pk) }); return true }),
  }
})

import { createElement } from 'react'
import { mount, settled } from '../../test/elementRoot'
import { useShare } from '../../store/terrainShare'
import { CrewButton } from '../PersonModal'

const P = 'ab'.repeat(32)
const SHORT_MS = 40

beforeEach(() => {
  calls.added.length = 0
  calls.removed.length = 0
  useShare.setState({ crew: [], crewOf: [] })
})

describe('the Crew button on a player card', () => {
  it('adds in one tap', async () => {
    const m = await mount(createElement(CrewButton, { pubkey: P, confirmMs: SHORT_MS }))
    await m.press('ADD TO CREW')
    expect(calls.added).toEqual([P])
    expect(m.says('IN YOUR CREW')).toBe(true)
    await m.unmount()
  })

  it('takes them off only on the second tap', async () => {
    useShare.setState({ crew: [P] })
    const m = await mount(createElement(CrewButton, { pubkey: P, confirmMs: 60_000 }))
    await m.press('IN YOUR CREW')
    expect(calls.removed).toEqual([])
    expect(m.says('TAP AGAIN TO TAKE OFF')).toBe(true)
    await m.press('TAP AGAIN TO TAKE OFF')
    expect(calls.removed).toEqual([P])
    expect(m.says('ADD TO CREW')).toBe(true)
    await m.unmount()
  })

  it('does nothing once the ask runs out', async () => {
    useShare.setState({ crew: [P] })
    const m = await mount(createElement(CrewButton, { pubkey: P, confirmMs: SHORT_MS }))
    await m.press('IN YOUR CREW')
    await new Promise((r) => setTimeout(r, SHORT_MS * 3))
    await settled()
    expect(m.says('IN YOUR CREW')).toBe(true)
    await m.press('IN YOUR CREW')
    expect(calls.removed).toEqual([])
    await m.unmount()
  })

  it('starts from one tap again when they were taken off some other way', async () => {
    useShare.setState({ crew: [P] })
    const m = await mount(createElement(CrewButton, { pubkey: P, confirmMs: 60_000 }))
    await m.press('IN YOUR CREW')
    useShare.setState({ crew: [] })
    await settled()
    useShare.setState({ crew: [P] })
    await settled()
    expect(m.says('IN YOUR CREW')).toBe(true)
    expect(m.says('TAP AGAIN')).toBe(false)
    await m.unmount()
  })
})
