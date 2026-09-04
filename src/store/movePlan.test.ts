/**
 * movePlan.test.ts - a commit beyond the ceiling takes exactly one step of the
 * way there, one signature, pausing on a declined signature; the next commit
 * takes the next step.
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

const posted: Array<{ id: number; mode: string; from: { x: bigint }; to: { x: bigint }; maxComputeHeight: number }> = []
vi.mock('../lib/workers', () => ({
  postProof: vi.fn((req: (typeof posted)[number]) => { posted.push(req) }),
  cancelProof: vi.fn(),
  setProofHandler: vi.fn(),
}))
vi.mock('../lib/calibration', async (orig) => {
  const mod = await orig<typeof import('../lib/calibration')>()
  return { ...mod, recommendedHopHeight: () => 2 }
})

import { parseAction } from '../lib/events'
import { useCyberspace } from './useCyberspace'

function done(req: (typeof posted)[number]) {
  const sidestep = req.mode === 'sidestep'
    ? { merkleRoots: ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)] as [string, string, string], inclusionProofs: ['', '', ''] as [string, string, string], lcaHeights: [1, 0, 0] as [number, number, number] }
    : undefined
  return { type: 'done' as const, id: req.id, mode: req.mode as 'hop' | 'sidestep', elapsedMs: 5, proofHash: 'dd'.repeat(32), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4, sidestep }
}

async function land(): Promise<void> {
  const req = posted[posted.length - 1]
  await useCyberspace.getState().applyProofMessage(done(req))
}

describe('a commit beyond the ceiling', () => {
  beforeEach(async () => {
    posted.length = 0
    // These routes are this machine's alone: the cloud stays off.
    useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode: 'off' } })
    await useCyberspace.getState().respawn()
  })

  it('walks to the boundary, sidesteps one gibson, hops on: one step per commit, one signature each', async () => {
    const s = useCyberspace.getState()
    const x0 = (s.position.x >> 4n) << 4n            // block base at h4
    useCyberspace.setState({ position: { ...s.position, x: x0 + 5n }, cursor: { ...s.position, x: x0 + 11n } })
    await useCyberspace.getState().commit()
    let st = useCyberspace.getState()
    expect(st.plan).not.toBeNull()
    // Only the first step of the way is committed: the hop to the boundary.
    expect(st.plan!.summary).toMatchObject({ hops: 1, sidesteps: 0 })
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ mode: 'hop', to: { x: x0 + 7n }, maxComputeHeight: 2 })

    await land()
    st = useCyberspace.getState()
    expect(st.position.x).toBe(x0 + 7n)
    expect(st.plan).toBeNull()                          // the one-step route is done
    expect(st.cursor.x).toBe(x0 + 11n)                  // the cursor stays where it was put
    expect(posted).toHaveLength(1)                      // nothing runs on its own

    await useCyberspace.getState().commit()             // the next commit is the sidestep
    expect(posted[1]).toMatchObject({ mode: 'sidestep', from: { x: x0 + 7n }, to: { x: x0 + 8n } })
    await land()
    st = useCyberspace.getState()
    expect(st.position.x).toBe(x0 + 8n)

    await useCyberspace.getState().commit()             // and the hop on to the cursor
    expect(posted[2]).toMatchObject({ mode: 'hop', from: { x: x0 + 8n }, to: { x: x0 + 11n } })
    await land()
    st = useCyberspace.getState()
    expect(st.position.x).toBe(x0 + 11n)
    expect(st.plan).toBeNull()
    expect(st.proof.status).toBe('done')
    const kinds = st.events.map((e) => parseAction(e)?.type)
    expect(kinds).toEqual(['spawn', 'hop', 'sidestep', 'hop'])
    // every event links to the one before it
    for (let i = 1; i < st.events.length; i++) {
      const prev = st.events[i].tags.find((t) => t[0] === 'e' && t[3] === 'previous')?.[1]
      expect(prev).toBe(st.events[i - 1].id)
    }
  })

  it('pauses on a declined signature and continues with the same proof on resume', async () => {
    const s = useCyberspace.getState()
    const x0 = (s.position.x >> 4n) << 4n
    useCyberspace.setState({ position: { ...s.position, x: x0 + 7n }, cursor: { ...s.position, x: x0 + 9n } })
    await useCyberspace.getState().commit()
    expect(posted[0].mode).toBe('sidestep')

    const realSign = useCyberspace.getState().signEvent
    useCyberspace.setState({ signEvent: async () => { throw new Error('user declined') } })
    await land()
    let st = useCyberspace.getState()
    expect(st.plan!.status).toBe('paused')
    expect(st.plan!.awaiting).not.toBeNull()
    expect(st.plan!.message).toContain('declined')
    expect(st.position.x).toBe(x0 + 7n)
    expect(st.events).toHaveLength(1)
    expect(posted).toHaveLength(1)                     // nothing recomputed

    useCyberspace.setState({ signEvent: realSign })
    useCyberspace.getState().resumePlan()
    await new Promise((r) => setTimeout(r, 0))
    st = useCyberspace.getState()
    expect(st.position.x).toBe(x0 + 8n)
    expect(st.plan).toBeNull()                         // that one step was the whole commit
    expect(posted).toHaveLength(1)                     // the next step waits for the next commit
    await useCyberspace.getState().commit()
    expect(posted[1]).toMatchObject({ mode: 'hop', to: { x: x0 + 9n } })
  })

  it('cancelling a route keeps the signed steps and drops the rest', async () => {
    const s = useCyberspace.getState()
    const x0 = (s.position.x >> 4n) << 4n
    useCyberspace.setState({ position: { ...s.position, x: x0 + 5n }, cursor: { ...s.position, x: x0 + 11n } })
    await useCyberspace.getState().commit()
    await land()
    expect(useCyberspace.getState().events).toHaveLength(2)
    useCyberspace.getState().cancel()
    const st = useCyberspace.getState()
    expect(st.plan).toBeNull()
    expect(st.pendingTarget).toBeNull()
    expect(st.events).toHaveLength(2)
    expect(st.position.x).toBe(x0 + 7n)
  })

  it('a hop within the ceiling is still a single event, no route', async () => {
    const s = useCyberspace.getState()
    useCyberspace.setState({ cursor: { ...s.position, x: s.position.x ^ 1n } })
    await useCyberspace.getState().commit()
    expect(useCyberspace.getState().plan).toBeNull()
    expect(posted[0].mode).toBe('hop')
  })
})
