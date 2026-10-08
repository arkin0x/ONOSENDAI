/**
 * builderHiding.test.ts - a deploy that is already hiding finishes where it
 * was placed, and is never told "kept" or wiped out by another.
 *
 * Found in the final review of the Builder (2026-10-07): pressing HIDE, then
 * tapping the Earth while the key was still being computed, ended BUILD with
 * "Your message is kept" and restored the draft while the hide went on and
 * published. And a hide finishing cleared whatever deploy was lined up by
 * then, not only its own.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { useCyberspace } from '../useCyberspace'
import { useShards } from '../useShards'
import { useToast } from '../useToast'
import { useBuilder } from '../useBuilder'
import { buildCursorOf } from '../../lib/buildCursor'

const S = () => useCyberspace.getState()
const B = () => useBuilder.getState()
const hidden = (text: string): number => useShards.getState().mine.filter((d) => d.text === text).length

beforeEach(() => {
  useShards.setState({ mine: [], pending: null, deployHeight: 0, deployStatus: 'idle', deployError: null })
  useBuilder.getState().exit()
  useBuilder.setState({ messageDraft: null })
  S().clearFocus()
  useToast.getState().dismiss()
  useCyberspace.setState({ live: false })
})

describe('the view ending while a message is already being hidden', () => {
  it('ends BUILD, says the hide finishes, keeps no draft, and the message is hidden once', async () => {
    useShards.getState().startDeployMessage('meet me at the fountain')
    const hiding = useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('working')
    // An Earth tap mid-hide.
    S().focusOn(S().position, 0, 'EARTH · tap')
    expect(B().active).toBe(false)
    expect(B().messageDraft).toBeNull()
    const meta = useToast.getState().toast?.meta ?? ''
    expect(meta).toMatch(/already being hidden, and it finishes at the place you chose/)
    expect(meta).not.toMatch(/kept/)
    await hiding
    expect(hidden('meet me at the fountain')).toBe(1)
    expect(useShards.getState().pending).toBeNull()
  })
})

describe('CANCEL while hiding', () => {
  it('does not pretend: the deploy stays lined up and finishes', async () => {
    useShards.getState().startDeployMessage('already on its way')
    const hiding = useShards.getState().deploy()
    useShards.getState().cancelDeploy()
    expect(useShards.getState().pending).not.toBeNull()
    await hiding
    expect(hidden('already on its way')).toBe(1)
  })
})

describe('a deploy lined up while an earlier one is still hiding', () => {
  it('survives the earlier one finishing, and BUILD stays on for it', async () => {
    useShards.getState().startDeployMessage('first')
    const first = useShards.getState().deploy()
    // A DEPLOY from the workshop while the first is still hiding.
    useShards.getState().startDeployMessage('second, lined up')
    await first
    expect(hidden('first')).toBe(1)
    const pending = useShards.getState().pending
    expect(pending?.type === 'message' ? pending.text : null).toBe('second, lined up')
    expect(B().active).toBe(true)
    useShards.getState().cancelDeploy()
  })
})

describe('a lined-up deploy BUILD has to end', () => {
  it('says plainly that its height and bag settings, and the hint message written, were not kept', () => {
    useShards.getState().startDeployMessage('a riddle goes with this')
    useShards.getState().setDeployBag({ riddle: 'under the third lamp' })
    S().focusOn(S().position, 0, 'EARTH · tap')
    const meta = useToast.getState().toast?.meta ?? ''
    expect(meta).toMatch(/Your message is kept/)
    expect(meta).toMatch(/Its height and bag settings, including the hint message you wrote, were not kept/)
  })
})

describe('views of the whole cube count as no view', () => {
  const center = { x: 1n << 84n, y: 1n << 84n, z: 1n << 84n }
  for (const [label, scale] of [['EARTH', 52], ['CYBERSPACE', 82], ['THE RIDE', 81]] as const) {
    it(`${label}: BUILD starts on your avatar, not at Earth's core`, () => {
      S().focusOn(center, 0, label, scale)
      B().enter('build')
      expect(S().cursor).toEqual(S().position)
    })
  }

  it('a stop view still starts the build cursor on the stop', () => {
    const stop = { x: 12345n, y: 67890n, z: 13579n }
    S().focusOn(stop, 0, 'BLOCK 900 · LANDFALL')
    B().enter('build')
    expect(buildCursorOf(S()).position).toEqual(stop)
  })
})
