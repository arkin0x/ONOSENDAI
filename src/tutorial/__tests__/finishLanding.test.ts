/**
 * finishLanding.test.ts - "You made it" waits until the walker has come down
 * on the finish deck (arkinox, 2026-11-13: "on the You Made It step, im having
 * a lot of trouble tapping on the chest again"; "im in walk mode btw").
 *
 * A jump's hops are made when it comes down (store/useWalk.ts), so a bounce
 * that overshoots the deck lands first, on the catch floor below or past it,
 * and only then is its chain head proved through the deck's region on the way
 * there. The step came up mid-way, with the player twelve gibsons under the
 * chest. Measured in a real browser (LOCAL, 375x812): held forward through the
 * bounce for 1.2 s, the walker came down at course (z 36, y -2), under and past
 * the deck, with "You made it" up.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

vi.mock('../../lib/relay', async (orig) => {
  const real = await orig<typeof import('../../lib/relay')>()
  return {
    ...real,
    publish: vi.fn(async () => ({ ok: true, accepted: [] })),
    publishMany: vi.fn(async () => ({ ok: true, accepted: [] })),
    query: vi.fn(async () => []),
  }
})

import { useCyberspace } from '../../store/useCyberspace'
import { useTutorial } from '../../store/useTutorial'
import { useShards } from '../../store/useShards'
import { useWalk } from '../../store/useWalk'
import { useTutorialStage } from '../director'
import { courseToWorld } from '../course'

async function staged(): Promise<void> {
  for (let i = 0; i < 200 && !useTutorialStage.getState().stage; i++) await new Promise((r) => setTimeout(r, 10))
  expect(useTutorialStage.getState().stage).not.toBe(null)
}

afterEach(() => {
  useWalk.setState({ falling: false, behind: 0, running: null, open: null, queue: [], gravity: false })
  useCyberspace.setState({ walking: false, events: [] })
  useTutorial.getState().pause()
})

describe('the finish step waits for the walker to come down on the deck', () => {
  it('a bounce whose head passes through the deck on its way to the floor below is not the finish; landing on the deck is', async () => {
    useTutorial.getState().start({ restart: true })
    await staged()
    const { stage, layout } = useTutorialStage.getState()
    useCyberspace.setState({ walking: true })
    useWalk.setState({ gravity: true })
    useTutorial.getState().start({ at: 'run' })
    await staged()
    expect(useTutorial.getState().script.steps[useTutorial.getState().index].id).toBe('run')
    // The walk's own state is set by hand below, so the live walk (which follows WALK) stands aside.
    useCyberspace.setState({ walking: false })
    // At the head, as a walker is (anything else stands WALK down and drops the walk: store/useWalk.ts).
    const head = (p: [number, number, number]): void => useCyberspace.setState({ events: [{ id: 'e', tags: [] } as never], position: courseToWorld(layout!.frame, p), headPlane: layout!.plane, focus: null, transit: null, spectate: null, exploreIndex: null })
    // The bounce flew through the deck's region (which reveals the chest) and came down past it:
    // its hops are being proved after the landing, the walk still behind.
    useShards.setState({ discovered: { ...useShards.getState().discovered, [stage!.ids.finishChest]: {} as never } })
    useWalk.setState({ falling: false, behind: 3, running: courseToWorld(layout!.frame, [0, 10, 33]) })
    head([0, 10, 33])
    expect(useWalk.getState().behind).toBe(3)
    expect(useTutorial.getState().done).toBe(false)
    // Still in the air: not the finish either.
    useWalk.setState({ falling: true, behind: 3, running: null })
    expect(useTutorial.getState().done).toBe(false)
    // Every hop proved, the head where it came down: the floor under the deck. Not the finish.
    head([0, -2, 36])
    useWalk.setState({ falling: false, behind: 0, running: null })
    expect(useTutorial.getState().done).toBe(false)
    // Come down on the deck's edge still running (the open segment walks on, off it): not yet.
    useWalk.setState({ falling: false, behind: 0, running: null, open: { end: courseToWorld(layout!.frame, [0, 10, 34]) } as never })
    head([0, 10, 34])
    expect(useTutorial.getState().done).toBe(false)
    // It ran on off the edge and came down on the floor below.
    head([0, -2, 36])
    useWalk.setState({ open: null })
    expect(useTutorial.getState().done).toBe(false)
    // Come down on the deck, nothing left to prove: the finish.
    useWalk.setState({ falling: false, behind: 1, running: courseToWorld(layout!.frame, [0, 10, 31]) })
    head([0, 10, 31])
    expect(useTutorial.getState().done).toBe(false)
    useWalk.setState({ behind: 0, running: null })
    expect(useTutorial.getState().done).toBe(true)
    expect(useTutorial.getState().script.steps[useTutorial.getState().index].id).toBe('run')
  })
})
