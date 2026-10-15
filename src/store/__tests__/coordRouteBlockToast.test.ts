/**
 * coordRouteBlockToast.test.ts - a /C/ link that names a block lands on its
 * stop and says so in a toast that waits to be tapped, never on a clock, in
 * arkinox's words (2026-10-14): a port by its merkle root, a landfall by its
 * root, its block hash or its own stop coordinate. Unknown hex says nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const look = vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
  // Which lookup finds the argument, and what stop sits in the row.
  return { byRootOrHash: -1, byLandfallCoord: -1, stop: null as unknown }
})

vi.mock('../../lib/hyperspace/compactIndex', async (orig) => ({
  ...(await orig<typeof import('../../lib/hyperspace/compactIndex')>()),
  rowByRootOrHash: () => look.byRootOrHash,
  rowByLandfallCoord: () => look.byLandfallCoord,
  stopAt: () => look.stop,
}))

import { useCyberspace } from '../useCyberspace'
import { startCoordRoute } from '../useCoordRoute'
import { toastClockMs, useToast } from '../useToast'
import { landfallCoord, landfallCoordApprox } from '../../lib/hyperspace/landfall'

const PORT_ROOT = '6edfc6badd201e338a5003ac86485f273838406c7825caae704e71824c985e93'
const LF_ROOT = '0cfb54e522b07bd1a381adc774ec1851590ef4c3add83958135106534569f970'
const LF_HASH = '000000000000000000010538edbfd2d5b809a33dd83f284aeea41c6d0d96968a'
const LF_COORD = landfallCoord(LF_HASH).toString(16).padStart(64, '0')

const PORT = { height: 971270, kind: 'port', merkleRoot: PORT_ROOT, blockHash: null, coordExact: BigInt('0x' + PORT_ROOT), coordApprox: BigInt('0x' + PORT_ROOT) }
const landfall = () => ({ height: 900000, kind: 'landfall', merkleRoot: LF_ROOT, blockHash: LF_HASH, coordExact: null, coordApprox: landfallCoordApprox(LF_HASH) })

const PORT_TEXT = "A hyperspace port is a bitcoin block's merkle root read as a cyberspace coordinate."
const LANDFALL_TEXT = "A hyperspace landfall is a bitcoin block's hash read as a point on Earth's surface."

function visit(hex: string): () => void {
  return startCoordRoute({ pathname: `/C/${hex}`, search: '', hash: '' }, { replaceState: vi.fn() })
}

beforeEach(() => {
  useToast.getState().dismiss()
  useCyberspace.getState().clearFocus()
  look.byRootOrHash = -1
  look.byLandfallCoord = -1
  look.stop = null
})

function expectSticky(label: string, meta: string): void {
  const toast = useToast.getState().toast
  expect(toast?.label).toBe(label)
  expect(toast?.meta).toBe(meta)
  expect(toast?.sticky).toBe(true)
  expect(toastClockMs(toast!)).toBeNull()
  useToast.getState().dismiss()
  expect(useToast.getState().toast).toBeNull()
}

describe('the block a /C/ link names', () => {
  it("a port's merkle root: the port toast", () => {
    look.byRootOrHash = 0; look.stop = PORT
    const stop = visit(PORT_ROOT)
    expectSticky('Block 971,270 · port', PORT_TEXT)
    stop()
  })

  it("a landfall's merkle root: the view goes to the landfall, with its toast", () => {
    look.byRootOrHash = 0; look.stop = landfall()
    const stop = visit(LF_ROOT)
    expectSticky('Block 900,000 · landfall', LANDFALL_TEXT)
    expect(useCyberspace.getState().focus?.label).toBe('BLOCK 900000 · LANDFALL')
    stop()
  })

  it("a block hash: the same landfall toast", () => {
    look.byRootOrHash = 0; look.stop = landfall()
    const stop = visit(LF_HASH)
    expectSticky('Block 900,000 · landfall', LANDFALL_TEXT)
    stop()
  })

  it("a landfall's own stop coordinate: found by coordinate, the same toast", () => {
    look.byLandfallCoord = 0; look.stop = landfall()
    const stop = visit(LF_COORD)
    expectSticky('Block 900,000 · landfall', LANDFALL_TEXT)
    stop()
  })

  it('unknown hex: a plain view, no toast', () => {
    const stop = visit('a'.repeat(63) + '0')
    expect(useToast.getState().toast).toBeNull()
    stop()
  })
})
