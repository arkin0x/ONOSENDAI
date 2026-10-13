/**
 * walk.test.ts - WALK commits a step per press, shows it at once, proves the
 * steps in the order pressed, each from where the last one landed, and stops
 * the whole walk, back at the real head, the moment a step does not land.
 */
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
import { losingSync, SYNC_WARN_AT, useWalk } from '../useWalk'

function done(req: (typeof posted)[number]) {
  return { type: 'done' as const, id: req.id, mode: req.mode as 'hop' | 'sidestep', elapsedMs: 5, proofHash: 'dd'.repeat(32), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4 }
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
    useWalk.getState().enter()
  })

  it('shows every press at once and proves the steps in order, each from the last landing', async () => {
    const start = { ...useCyberspace.getState().position }
    useWalk.getState().press('right')
    useWalk.getState().press('right')
    useWalk.getState().press('up')
    const { queue, behind } = useWalk.getState()
    expect(behind).toBe(3)
    expect(queue).toHaveLength(3)
    // The view is already at the last step: the cursor, which WALK's camera follows.
    expect(useCyberspace.getState().cursor).toEqual(queue[2])
    expect(useCyberspace.getState().position).toEqual(start)

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].from).toEqual(start)
    expect(posted[0].to).toEqual(queue[0])
    expect(Math.abs(Number(stepped(start, queue[0])))).toBe(1)

    await land()
    expect(useCyberspace.getState().position).toEqual(queue[0])
    expect(useWalk.getState().behind).toBe(2)
    expect(posted[1].from).toEqual(queue[0])
    expect(posted[1].to).toEqual(queue[1])

    await land()
    expect(posted[2].from).toEqual(queue[1])
    expect(posted[2].to).toEqual(queue[2])
    await land()
    expect(useCyberspace.getState().position).toEqual(queue[2])
    expect(useWalk.getState().behind).toBe(0)
    // spawn, then one hop per press
    expect(useCyberspace.getState().events).toHaveLength(4)
  })

  it('steps the zoom: one press is 2^scaleExp gibsons', async () => {
    useCyberspace.setState({ scaleExp: 4 })
    const start = { ...useCyberspace.getState().position }
    useWalk.getState().press('left')
    expect(Math.abs(Number(stepped(start, useWalk.getState().queue[0])))).toBe(16)
  })

  it('a step that does not land stops the walk and brings the view back to the real head, keeping what was signed', async () => {
    useWalk.getState().press('right')
    useWalk.getState().press('right')
    useWalk.getState().press('right')
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
  })

  it('STOP drops the queue and cancels the step in flight', async () => {
    const start = { ...useCyberspace.getState().position }
    useWalk.getState().press('up')
    useWalk.getState().press('up')
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    useWalk.getState().stop()
    expect(useWalk.getState().queue).toEqual([])
    expect(useCyberspace.getState().proof.status).not.toBe('computing')
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
