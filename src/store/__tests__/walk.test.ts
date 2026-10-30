/**
 * walk.test.ts - WALK shows every press at once, makes one move of presses in
 * one direction (a segment closed by a turn, by stillness or by its cost),
 * proves the segments in order, each from where the last one landed, and
 * stops the whole walk, back at the real head, the moment one does not land.
 */
import { provedFor } from '../fixtures/provedHop'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const posted: Array<{ id: number; mode: string; from: { x: bigint; y: bigint; z: bigint }; to: { x: bigint; y: bigint; z: bigint }; maxComputeHeight: number }> = []
vi.mock('../../lib/workers', () => ({
  postProof: vi.fn((req: (typeof posted)[number]) => { posted.push(req) }),
  cancelProof: vi.fn(),
  setProofHandler: vi.fn(),
}))
vi.mock('../../lib/calibration', async (orig) => {
  const mod = await orig<typeof import('../../lib/calibration')>()
  return { ...mod, recommendedHopHeight: () => 20 }
})

import { useCyberspace } from '../useCyberspace'
import { losingSync, segmentAffordable, SYNC_WARN_AT, WALK_SETTLE_MS, useWalk } from '../useWalk'
import { useCalibration } from '../../lib/calibration'
import { useToast } from '../useToast'

function done(req: (typeof posted)[number]) {
  return { type: 'done' as const, id: req.id, mode: req.mode as 'hop' | 'sidestep', elapsedMs: 5, ...provedFor(req), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4 }
}

/** Land the newest proof, and let the walk start the next one. */
async function land(): Promise<void> {
  const before = posted.length
  await useCyberspace.getState().applyProofMessage(done(posted[posted.length - 1]))
  // The next step's checks are async (walkTo): wait for its proof request, if one is due.
  if (useWalk.getState().queue.length > 0) await vi.waitFor(() => expect(posted.length).toBe(before + 1))
}

/** The axis and sign a press moves along in the default view, read off the first press. */
function stepped(a: { x: bigint; y: bigint; z: bigint }, b: { x: bigint; y: bigint; z: bigint }): bigint {
  return (b.x - a.x) + (b.y - a.y) + (b.z - a.z)
}

describe('WALK', () => {
  beforeEach(async () => {
    posted.length = 0
    useWalk.getState().exit()
    useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode: 'off' } })
    await useCyberspace.getState().respawn()
    useCyberspace.getState().cancel()
    useCalibration.setState({ cantorMsByHeight: undefined })
    useWalk.getState().enter()
  })

  it('makes one hop of presses in one direction, shown at once and proved when the walker stops', async () => {
    const start = { ...useCyberspace.getState().position }
    useWalk.getState().press('right')
    useWalk.getState().press('right')
    useWalk.getState().press('right')
    const w = useWalk.getState()
    // Still being walked: nothing queued, nothing behind.
    expect(w.queue).toEqual([])
    expect(w.behind).toBe(0)
    expect(w.open).not.toBeNull()
    expect(Math.abs(Number(stepped(start, w.open!.end)))).toBe(3)
    // The view is already at the end: the cursor, which WALK's camera follows.
    expect(useCyberspace.getState().cursor).toEqual(w.open!.end)
    expect(posted).toHaveLength(0)

    useWalk.getState().settle()
    expect(useWalk.getState().behind).toBe(1)
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].from).toEqual(start)
    expect(posted[0].to).toEqual(w.open!.end)
    await land()
    expect(useCyberspace.getState().position).toEqual(w.open!.end)
    expect(useWalk.getState().behind).toBe(0)
    // spawn, then ONE hop for three presses
    expect(useCyberspace.getState().events).toHaveLength(2)
  })

  it('a turn closes the segment: it goes to be proved and the new direction starts the next', async () => {
    const start = { ...useCyberspace.getState().position }
    useWalk.getState().press('right')
    useWalk.getState().press('right')
    useWalk.getState().press('up')
    const { queue, open, behind } = useWalk.getState()
    expect(queue).toHaveLength(1)
    expect(behind).toBe(1)
    expect(Math.abs(Number(stepped(start, queue[0])))).toBe(2)
    expect(open!.from).toEqual(queue[0])
    expect(useCyberspace.getState().cursor).toEqual(open!.end)

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].from).toEqual(start)
    expect(posted[0].to).toEqual(queue[0])
    await land()
    useWalk.getState().settle()
    await vi.waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1].from).toEqual(queue[0])
    expect(posted[1].to).toEqual(open!.end)
    await land()
    expect(useCyberspace.getState().position).toEqual(open!.end)
    expect(useCyberspace.getState().events).toHaveLength(3)
  })

  it('stillness closes the open segment after WALK_SETTLE_MS, and every press restarts the wait', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      useWalk.getState().press('right')
      vi.advanceTimersByTime(WALK_SETTLE_MS - 100)
      useWalk.getState().press('right')
      vi.advanceTimersByTime(WALK_SETTLE_MS - 1)
      expect(useWalk.getState().queue).toHaveLength(0)
      expect(useWalk.getState().open).not.toBeNull()
      vi.advanceTimersByTime(1)
      expect(useWalk.getState().open).toBeNull()
      expect(useWalk.getState().queue).toHaveLength(1)
      expect(useWalk.getState().behind).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a segment closes before it would cost more than its budget, so a long straight walk is a few hops', () => {
    // Height 3 and up projects past a second here: a segment may only cross walls up to h2.
    useCyberspace.setState({ scaleExp: 0 })
    useCalibration.setState({ cantorMsByHeight: { 1: 10, 2: 100, 3: 2000 } })
    const start = { ...useCyberspace.getState().position }
    for (let i = 0; i < 20; i++) useWalk.getState().press('right')
    const { queue, open } = useWalk.getState()
    const ends = [...queue, open!.end]
    expect(ends.length).toBeGreaterThan(1)
    expect(Math.abs(Number(stepped(start, ends[ends.length - 1])))).toBe(20)
    // Each segment is affordable, unless it is a single step, which is the least a press can be.
    let from = start
    for (const end of ends) {
      const one = Math.abs(Number(stepped(from, end))) === 1
      expect(one || segmentAffordable(from, end, useCyberspace.getState().plane)).toBe(true)
      from = end
    }
  })

  it('counts only closed segments for LOSING SYNC: a long straight walk never warns, quick turns do', () => {
    for (let i = 0; i < 6; i++) useWalk.getState().press('right')
    expect(useWalk.getState().behind).toBe(0)
    expect(losingSync(useWalk.getState().behind)).toBe(false)
    useWalk.getState().press('up')
    useWalk.getState().press('right')
    useWalk.getState().press('up')
    useWalk.getState().press('right')
    // Four closed (the first one computing), one open.
    expect(useWalk.getState().behind).toBe(4)
    expect(losingSync(useWalk.getState().behind)).toBe(true)
  })

  it('steps the zoom: one press is 2^scaleExp gibsons', async () => {
    useCyberspace.setState({ scaleExp: 4 })
    const start = { ...useCyberspace.getState().position }
    useWalk.getState().press('left')
    expect(Math.abs(Number(stepped(start, useWalk.getState().open!.end)))).toBe(16)
  })

  it('a move that does not land stops the walk and brings the view back to the real head, keeping what was signed', async () => {
    useWalk.getState().press('right')
    useWalk.getState().press('up')
    useWalk.getState().press('right')
    useWalk.getState().settle()
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    await land()
    const landed = { ...useCyberspace.getState().position }

    const realSign = useCyberspace.getState().signEvent
    useCyberspace.setState({ signEvent: async () => { throw new Error('user declined') } })
    await useCyberspace.getState().applyProofMessage(done(posted[1]))
    useCyberspace.setState({ signEvent: realSign })

    const w = useWalk.getState()
    expect(w.queue).toEqual([])
    expect(w.behind).toBe(0)
    const s = useCyberspace.getState()
    expect(s.walking).toBe(true)                       // still in WALK, just stopped
    expect(s.position).toEqual(landed)                 // the first step stays
    expect(s.cursor).toEqual(landed)                   // the view comes home to it
    expect(s.proof.message).toContain('declined')
    expect(posted).toHaveLength(2)                     // the third step never started
    // And the reason is on screen, not only in the menu.
    expect(useToast.getState().toast).toMatchObject({ label: 'WALK STOPPED', mark: 'walk' })
    expect(useToast.getState().toast?.meta).toContain('declined')
  })

  it('STOP drops the queue and the open segment and cancels the move in flight', async () => {
    const start = { ...useCyberspace.getState().position }
    useWalk.getState().press('up')
    useWalk.getState().press('right')
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(useWalk.getState().open).not.toBeNull()
    useToast.getState().dismiss()
    useWalk.getState().stop()
    // A STOP of your own needs no word.
    expect(useToast.getState().toast).toBeNull()
    expect(useWalk.getState().queue).toEqual([])
    expect(useWalk.getState().open).toBeNull()
    expect(useCyberspace.getState().proof.status).not.toBe('computing')
    expect(useCyberspace.getState().cursor).toEqual(start)
    expect(useCyberspace.getState().position).toEqual(start)
  })

  it('leaving WALK drops a segment still being walked: nothing is proved and the view comes home', () => {
    const start = { ...useCyberspace.getState().position }
    useWalk.getState().press('right')
    useWalk.getState().press('right')
    useWalk.getState().exit()
    expect(useWalk.getState().open).toBeNull()
    expect(useWalk.getState().queue).toEqual([])
    expect(posted).toHaveLength(0)
    expect(useCyberspace.getState().cursor).toEqual(start)
    expect(useCyberspace.getState().position).toEqual(start)
  })

  it('takes the cursor away from everything else while on, and gives it back on exit', () => {
    const at = { ...useCyberspace.getState().cursor }
    useCyberspace.getState().moveCursor({ axis: 'x', dir: 1 })
    expect(useCyberspace.getState().cursor).toEqual(at)
    useWalk.getState().exit()
    expect(useCyberspace.getState().walking).toBe(false)
    useCyberspace.getState().moveCursor({ axis: 'x', dir: 1 })
    expect(useCyberspace.getState().cursor).not.toEqual(at)
  })

  it('cycles HOP to VIEW to WALK and back to HOP', () => {
    useWalk.getState().exit()
    const s = useCyberspace.getState()
    expect(s.walking).toBe(false)
    expect(s.viewing()).toBe(false)                     // HOP
    s.viewHere()
    expect(useCyberspace.getState().viewing()).toBe(true) // VIEW
    useWalk.getState().enter()
    expect(useCyberspace.getState().viewing()).toBe(false)
    expect(useCyberspace.getState().walking).toBe(true)  // WALK, from your head
    expect(useCyberspace.getState().atHead()).toBe(true)
    useWalk.getState().exit()
    expect(useCyberspace.getState().walking).toBe(false) // HOP again
    expect(useCyberspace.getState().viewing()).toBe(false)
  })

  it('ends when the scene leaves your head', () => {
    useCyberspace.getState().focusOn(useCyberspace.getState().position, 0, 'somewhere')
    expect(useCyberspace.getState().walking).toBe(false)
    useCyberspace.getState().clearFocus()
  })

  it('warns from three steps behind and stands down at two', () => {
    expect(SYNC_WARN_AT).toBe(3)
    expect(losingSync(2)).toBe(false)
    expect(losingSync(3)).toBe(true)
    expect(losingSync(7)).toBe(true)
  })
})
