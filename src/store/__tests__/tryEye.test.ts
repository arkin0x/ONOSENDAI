/**
 * tryEye.test.ts - SET EYE's TRY WALK with the real stores (avatar eye, UI A):
 * WALK entered the pad's way (BUILD ends as the WALK button ends it,
 * spectating refuses), the WALK camera looking from the workshop shard's eye
 * for your own pubkey only, and the way back: the pad's way out (the lit
 * WALK, X) brings SET EYE back with its UNDO; any other end (the demo's exit,
 * spectating) ends the try silently and clears the override.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // No relay is ever dialed from here: a socket that never opens.
  ;(globalThis as { WebSocket?: unknown }).WebSocket = class {
    static OPEN = 1
    readyState = 0
    onopen = null; onclose = null; onerror = null; onmessage = null
    send(): void {}
    close(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }
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

vi.mock('../../lib/workers', () => ({ postProof: vi.fn(), cancelProof: vi.fn(), setProofHandler: vi.fn() }))
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async () => []),
  watchAuthor: vi.fn(() => () => {}),
}))

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { newShard } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { useBuilder } from '../useBuilder'
import { useShards } from '../useShards'
import { useWalk } from '../useWalk'
import { useScan } from '../useScan'
import { useWorkshop } from '../useWorkshop'
import { currentPadMode, leaveWalk } from '../padMode'
import { startTryWalk, tryEyeFor, useTryEye } from '../tryEye'
import { walkCancel } from '../../hooks/useKeyboard'
import { spectate, stopSpectating } from '../../lib/spectator'
import { placeSpawn } from '../fixtures/placeSpawn'

const S = () => useCyberspace.getState()
const W = () => useWorkshop.getState()
const me = (): string => S().identity.pubkey
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function cube() {
  return {
    ...newShard('Cube'),
    vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]].map((p) => ({ p: p as [number, number, number], c: [1, 1, 1] as [number, number, number] })),
    faces: [[0, 1, 2], [0, 2, 3]] as Array<[number, number, number]>,
  }
}

/** The workshop open on a cube with the eye in hand, moved once (one UNDO). */
function holdEye(): string {
  const s = cube()
  useWorkshop.setState({ open: true, shards: [s], currentId: s.id, tool: 'view', selection: [], partSel: [], selectedFaces: [], facePick: [], past: [], future: [], eyeEdit: false, notice: null })
  W().setEyeEdit(true)
  W().setEye([0, 300, 0])
  return s.id
}

beforeEach(async () => {
  stopSpectating()
  useShards.setState({ pending: null, placedLast: null, deployStatus: 'idle', deployError: null })
  useWalk.getState().exit()
  useBuilder.getState().exit()
  useScan.getState().exit()
  S().clearFocus()
  await placeSpawn()
  S().cancel()
  useTryEye.setState({ pubkey: null, shard: null })
  useWorkshop.setState({ open: false, eyeEdit: false })
  expect(currentPadMode()).toBe('hop')
})

describe('TRY WALK', () => {
  it('walks from the workshop shard\'s eye, unpublished, for your own pubkey only', () => {
    holdEye()
    expect(startTryWalk()).toBe(true)
    expect(S().walking).toBe(true)
    expect(W().open).toBe(false)
    expect(tryEyeFor(me())?.extra?.eye).toEqual([0, 300, 0])
    expect(tryEyeFor('someone else')).toBeNull()
  })

  it('enters the pad\'s way: BUILD ends as the WALK button ends it, and leaving goes back to BUILD', async () => {
    useBuilder.getState().enter('build')
    expect(currentPadMode()).toBe('build')
    const id = holdEye()
    expect(startTryWalk()).toBe(true)
    expect(useBuilder.getState().active).toBe(false)
    expect(S().walking).toBe(true)
    leaveWalk()
    await tick()
    expect(useBuilder.getState().active).toBe(true)
    expect(W().open).toBe(true)
    expect(W().currentId).toBe(id)
    expect(W().eyeEdit).toBe(true)
  })

  it('the pad\'s way out (the lit WALK) brings SET EYE back with its UNDO, and the try is over', async () => {
    const id = holdEye()
    startTryWalk()
    leaveWalk()
    await tick()
    expect(S().walking).toBe(false)
    expect(W().open).toBe(true)
    expect(W().currentId).toBe(id)
    expect(W().eyeEdit).toBe(true)
    expect(W().past).toHaveLength(1)
    expect(tryEyeFor(me())).toBeNull()
    // A later WALK is plain WALK.
    W().closeWorkshop()
    useWalk.getState().enter()
    leaveWalk()
    await tick()
    expect(W().open).toBe(false)
  })

  it('X in WALK is the pad\'s way out too', async () => {
    holdEye()
    startTryWalk()
    walkCancel()
    await tick()
    expect(W().open).toBe(true)
    expect(W().eyeEdit).toBe(true)
  })

  it('any other end of the walk ends the try silently: the demo\'s exit', async () => {
    holdEye()
    startTryWalk()
    useWalk.getState().exit()
    await tick()
    expect(S().walking).toBe(false)
    expect(tryEyeFor(me())).toBeNull()
    expect(W().open).toBe(false)
  })

  it('spectating someone ends the try silently, and refuses a try while it lasts', async () => {
    holdEye()
    startTryWalk()
    const pk = getPublicKey(generateSecretKey())
    await spectate(pk)
    await tick()
    expect(S().walking).toBe(false)
    expect(tryEyeFor(me())).toBeNull()
    expect(W().open).toBe(false)
    // While spectating there is no head to walk from: the workshop stays, with a line.
    holdEye()
    expect(startTryWalk()).toBe(false)
    expect(W().open).toBe(true)
    expect(W().eyeEdit).toBe(true)
    expect(W().past).toHaveLength(1)
    expect(W().notice).toBe('WALK cannot start from here right now.')
    expect(tryEyeFor(me())).toBeNull()
  })

  it('is cleared by DONE, and by the workshop opening some other way meanwhile', async () => {
    holdEye()
    startTryWalk()
    W().openWorkshop()
    expect(tryEyeFor(me())).toBeNull()
    leaveWalk()
    await tick()
    expect(W().eyeEdit).toBe(false)
    W().setEyeEdit(true)
    useTryEye.setState({ pubkey: me(), shard: W().current() })
    W().setEyeEdit(false)
    expect(tryEyeFor(me())).toBeNull()
  })
})
