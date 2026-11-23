import * as proofCapability from '../../lib/proofCapability'
/**
 * movePlan.test.ts - a commit beyond the ceiling takes exactly one step of the
 * way there, one signature, pausing on a declined signature; the next commit
 * takes the next step.
 */
import { provedFor, provedHop } from '../fixtures/provedHop'
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
  return { ...mod, recommendedHopHeight: () => 2 }
})

import { hopTemplate, parseAction } from '../../lib/events'
import { useCyberspace } from '../useCyberspace'

function done(req: (typeof posted)[number]) {
  // A sidestep's proof is real too: finishProof checks it at Level 1 (lib/sidestepCheck.ts).
  return { type: 'done' as const, id: req.id, mode: req.mode as 'hop' | 'sidestep', elapsedMs: 5, ...provedFor(req, useCyberspace.getState().events), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4 }
}

/** Stand the chain itself at `to`: a stand-in move already on the relays, so the next move's c is there. */
async function standAt(to: { x: bigint; y: bigint; z: bigint }): Promise<void> {
  const s = useCyberspace.getState()
  const last = s.events[s.events.length - 1]
  const ev = await s.signEvent(hopTemplate({
    createdAt: last.created_at + 1, genesisId: s.genesisId, previousId: s.prevEventId, prevCoordHex: s.coordHex(),
    to, plane: s.headPlane, proofHash: '0'.repeat(64), mn: '0'.repeat(16), mp: '00',
  }))
  useCyberspace.setState({ events: [...s.events, ev], prevEventId: ev.id, published: { ...s.published, [ev.id]: 'ok' }, position: to })
}

async function land(): Promise<void> {
  const req = posted[posted.length - 1]
  await useCyberspace.getState().applyProofMessage(done(req))
}

describe('a commit beyond the ceiling', () => {
  it('shows an allocation-limit explanation without starting the proof worker', async () => {
    const state = useCyberspace.getState()
    const base = (state.position.x >> 4n) << 4n
    useCyberspace.setState({ position: { ...state.position, x: base + 4n }, cursor: { ...state.position, x: base + 5n } })
    const issue = vi.spyOn(proofCapability, 'movementCapabilityIssue').mockReturnValue('This browser cannot compute this movement proof. Use Chrome or Chromium.')
    try {
      await useCyberspace.getState().commit()
      expect(posted).toHaveLength(0)
      expect(useCyberspace.getState().proof).toMatchObject({ status: 'infeasible', message: expect.stringContaining('cannot compute') })
    } finally { issue.mockRestore() }
  })

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
    // The chain stands on the wall's leaf, not only the avatar: a sidestep's
    // c is where the chain stands, and its proof is checked from there.
    await standAt({ ...s.position, x: x0 + 7n })
    useCyberspace.setState({ cursor: { ...s.position, x: x0 + 9n } })
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
    expect(st.events).toHaveLength(2)
    expect(posted).toHaveLength(1)                     // nothing recomputed

    useCyberspace.setState({ signEvent: realSign })
    useCyberspace.getState().resumePlan()
    // RESUME takes a bounded look at the relays before signing a kept proof
    // (finishProof), so the step lands a moment later, not on the next tick.
    await vi.waitFor(() => expect(useCyberspace.getState().position.x).toBe(x0 + 8n), { timeout: 4000 })
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

describe('a sidestep this machine computed is checked at Level 1 before it is kept or queued', () => {
  beforeEach(async () => {
    posted.length = 0
    useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode: 'off' } })
    await useCyberspace.getState().respawn()
  })

  /** A sidestep committed from the leaf touching an h4 wall, landed with the proof fields `proved`. */
  async function landWith(proved: (req: (typeof posted)[number], head: string, plane: 0 | 1) => ReturnType<typeof provedHop>) {
    const s = useCyberspace.getState()
    const x0 = (s.position.x >> 4n) << 4n
    await standAt({ ...s.position, x: x0 + 7n })
    useCyberspace.setState({ cursor: { ...s.position, x: x0 + 9n } })
    await useCyberspace.getState().commit()
    const req = posted[posted.length - 1]
    expect(req.mode).toBe('sidestep')
    const before = useCyberspace.getState()
    await useCyberspace.getState().applyProofMessage({ type: 'done', id: req.id, mode: 'sidestep', elapsedMs: 5, ...proved(req, before.prevEventId, before.plane), terrainK: 3, lca: { x: 4, y: 0, z: 0 }, totalOps: 4, prevEventId: before.prevEventId })
    return { before, after: useCyberspace.getState(), x0 }
  }

  const refused = (r: Awaited<ReturnType<typeof landWith>>, what: string) => {
    expect(r.after.events).toHaveLength(r.before.events.length)
    expect(Object.keys(r.after.published)).toEqual(Object.keys(r.before.published))
    expect(r.after.prevEventId).toBe(r.before.prevEventId)
    expect(r.after.position.x).toBe(r.x0 + 7n)
    expect(r.after.proof.status).toBe('infeasible')
    expect(r.after.proof.message).toMatch(/^This sidestep was not recorded or sent: its proof did not pass the check every reader will make of it \(.+\)$/)
    expect(r.after.proof.message!.slice(r.after.proof.message!.indexOf('(') + 1, -1).split(', ')).toContain(what)
  }

  it('proved from a position the chain does not stand at, under the current head: refused (review of #581, N1)', async () => {
    // What a stale route step made: the old position proved under the new head, signed with c where the chain stands.
    const r = await landWith((req, head, plane) => provedHop({ position: { ...req.from, y: req.from.y + 1n }, pendingTarget: req.to, plane, prevEventId: head }, 'sidestep'))
    refused(r, 'hy')
  })

  it('proved under another previous event: refused', async () => {
    const r = await landWith((req, _head, plane) => provedHop({ position: req.from, pendingTarget: req.to, plane, prevEventId: 'ab'.repeat(32) }, 'sidestep'))
    refused(r, 'openings:x')
  })

  it('a proof that holds for it is kept and queued', async () => {
    const r = await landWith((req, head, plane) => provedHop({ position: req.from, pendingTarget: req.to, plane, prevEventId: head }, 'sidestep'))
    expect(r.after.events).toHaveLength(r.before.events.length + 1)
    expect(r.after.published[r.after.prevEventId]).toBe('queued')
    expect(r.after.position.x).toBe(r.x0 + 8n)
  })
})
