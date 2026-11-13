/**
 * firstHop.test.ts: the tutorial's first hop, shown (owner, 2026-11-12).
 *
 * On COMMIT in the box step the spin stops, the camera is asked to frame the
 * hop (start and end), and the avatar is held where it is while the camera
 * gets there. Once the avatar has landed AND arrived, the camera is asked in
 * close over its shoulder, from behind it as seen from the chest. A hop that
 * does not land puts the box step back as it was.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { HOP_FRAME_MS, setTutorialFrame, useTutorialCam } from '../../store/useTutorialCam'
import { glideDone, glideStart, hopLanding, resetHopStage } from '../../lib/hopStage'
import { useTutorialStage } from '../director'
import { TUTORIAL_SCRIPT } from '../script'
import { chestCell, toWorld } from '../layout'

async function staged(): Promise<void> {
  for (let i = 0; i < 200 && !useTutorialStage.getState().stage; i++) await new Promise((r) => setTimeout(r, 10))
  expect(useTutorialStage.getState().stage).not.toBe(null)
}

/** Up to the box step, its cursor lined up on the chest's neighbor. */
async function atBox(): Promise<void> {
  useTutorial.getState().start({ restart: true })
  await staged()
  useTutorial.getState().start({ at: 'box' })
  await staged()
  expect(useTutorial.getState().script.steps[useTutorial.getState().index].id).toBe('box')
}

beforeEach(() => {
  resetHopStage()
  useTutorial.setState({ script: TUTORIAL_SCRIPT })
  // Nothing computing: the store between moves.
  useCyberspace.setState({ pendingTarget: null })
})
afterEach(() => { useTutorial.getState().pause(); resetHopStage() })

describe('the first hop, shown', () => {
  it('on COMMIT stops the spin, frames the hop from start to end, and holds the avatar for the camera', async () => {
    await atBox()
    expect(useTutorialCam.getState().spin).toBe(true)
    const from = { ...useCyberspace.getState().position }
    const to = { ...useCyberspace.getState().cursor }
    // COMMIT: the hop's proof starts (store/useCyberspace.ts commitToward sets pendingTarget).
    const before = performance.now()
    useCyberspace.setState({ pendingTarget: to })
    expect(useTutorialCam.getState().spin).toBe(false)
    expect(useTutorialCam.getState().frame).toEqual({ from, to })
    // The glide that lands next starts no earlier than the camera's ease ends.
    expect(glideStart(before)).toBeGreaterThanOrEqual(before + HOP_FRAME_MS - 1)
  })

  it('once landed and arrived, eases in over the avatar\'s shoulder, behind it from the chest, and stops framing', async () => {
    await atBox()
    const layout = useTutorialStage.getState().layout!
    const to = { ...useCyberspace.getState().cursor }
    useCyberspace.setState({ pendingTarget: to })
    // Landed (finishProof marks the landing, then moves the store).
    hopLanding()
    useCyberspace.setState({ position: to, pendingTarget: null })
    // Still gliding: the camera stays on the framed hop.
    expect(useTutorialCam.getState().zoom).toBe(null)
    expect(useTutorialCam.getState().frame).not.toBe(null)
    glideDone()
    await vi.waitFor(() => { expect(useTutorialCam.getState().zoom).not.toBe(null) })
    expect(useTutorialCam.getState().frame).toBe(null)
    expect(useTutorialCam.getState().zoom).toBeLessThan(12)
    // From the avatar away from the chest: the camera is behind it, the chest ahead.
    const cell = chestCell(layout)
    const chest = toWorld(layout.frame, cell.f, cell.r, cell.u)
    expect(useTutorialCam.getState().from).toEqual({ x: Number(to.x - chest.x), y: Number(to.y - chest.y), z: Number(to.z - chest.z) })
  })

  it('a hop that does not land puts the spin back and stops framing', async () => {
    await atBox()
    const to = { ...useCyberspace.getState().cursor }
    useCyberspace.setState({ pendingTarget: to })
    expect(useTutorialCam.getState().frame).not.toBe(null)
    useCyberspace.setState({ pendingTarget: null })
    expect(useTutorialCam.getState().frame).toBe(null)
    expect(useTutorialCam.getState().spin).toBe(true)
  })

  it('a player who takes the camera during the hop keeps it: no shot over the shoulder follows', async () => {
    await atBox()
    const to = { ...useCyberspace.getState().cursor }
    useCyberspace.setState({ pendingTarget: to })
    // A press, a pinch or the wheel on the scene: the rig ends the framing (scene/Scene.tsx).
    setTutorialFrame(null)
    hopLanding()
    useCyberspace.setState({ position: to, pendingTarget: null })
    glideDone()
    await new Promise((r) => setTimeout(r, 30))
    expect(useTutorialCam.getState().zoom).toBe(null)
    expect(useTutorialCam.getState().frame).toBe(null)
  })

  it('a hop whose chain is replaced under it (somewhere else, target cleared) does not leave the camera framing it', async () => {
    await atBox()
    const from = { ...useCyberspace.getState().position }
    const to = { ...useCyberspace.getState().cursor }
    const before = performance.now()
    useCyberspace.setState({ pendingTarget: to })
    useCyberspace.setState({ position: { ...from, x: from.x + 5n }, pendingTarget: null })
    expect(useTutorialCam.getState().frame).toBe(null)
    expect(useTutorialCam.getState().spin).toBe(true)
    // Nor is the next glide held for a camera that is not coming.
    expect(glideStart(before)).toBe(before)
  })

  it('the tutorial going away mid-hop leaves the camera alone', async () => {
    await atBox()
    const to = { ...useCyberspace.getState().cursor }
    useCyberspace.setState({ pendingTarget: to })
    hopLanding()
    useCyberspace.setState({ position: to, pendingTarget: null })
    useTutorial.getState().pause()
    glideDone()
    await new Promise((r) => setTimeout(r, 30))
    expect(useTutorialCam.getState().zoom).toBe(null)
    expect(useTutorialCam.getState().frame).toBe(null)
  })
})
