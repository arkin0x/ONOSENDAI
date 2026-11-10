/**
 * walkPad.test.tsx - WALK's own pad (arkinox, 2026-11-02) and the mode
 * button's ring on screen.
 *
 * - No scale keys in WALK: FAR, up and NEAR are one FORWARD; down is
 *   BACKWARD; + and the 2^ readout are JUMP; - is DOWN.
 * - Each key takes the step its keyboard key takes (lib/walkKeys.ts), so the
 *   pad and the keys cannot disagree: pressed from the same place, they land
 *   on the same place.
 * - The commit slot reads WALK in WALK, BUILD (lit white) in BUILD, and
 *   pressing them goes on round the ring; RECALL is there in BUILD too.
 * - HOP and VIEW keep the pad they had.
 * - With the chain status strip up the commit block is a row taller, and the
 *   pad is lifted by that row wherever the block is drawn, BUILD included
 *   (review of #588: RECALL and BUILD stood over the scale keys). While
 *   spectating the SPECTATING bar holds that corner, so BUILD draws no block.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
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
  // The pad's hold-to-repeat timers.
  ;(globalThis as { window?: unknown }).window ??= globalThis
})
vi.mock('../../lib/workers', () => ({ postProof: vi.fn(), cancelProof: vi.fn(), setProofHandler: vi.fn() }))
vi.mock('../../lib/relay', async (orig) => ({
  ...(await orig() as object),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

// A spectated avatar with nothing on the relay: the scene watches their spawn.
vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async () => []),
  watchAuthor: vi.fn(() => () => {}),
}))

// A server render reads a zustand store's initial state; here each hook reads
// the live state, as a mounted component does.
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { TouchControls } from '../TouchControls'
import { useCyberspace } from '../../store/useCyberspace'
import { useBuilder } from '../../store/useBuilder'
import { useWalk } from '../../store/useWalk'
import { useShards } from '../../store/useShards'
import { walkKeyDown, walkKeysReleased } from '../../hooks/useKeyboard'
import { walkFacing } from '../../lib/walkEye'
import { currentPadMode } from '../../store/padMode'
import { placeSpawn } from '../../store/fixtures/placeSpawn'
import { spectate, stopSpectating } from '../../lib/spectator'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const S = () => useCyberspace.getState()

type Btn = ReactElement<{ className?: string; title?: string; disabled?: boolean; children?: ReactNode; onPointerDown?: (e: unknown) => void; onPointerUp?: () => void }>

/** Every element TouchControls draws itself, its hooks run inside a render. */
function drawn(): Btn[] {
  let out: ReactNode = null
  renderToString(createElement(() => { out = TouchControls(); return null }))
  const all: Btn[] = []
  const walk = (n: ReactNode): void => {
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (!isValidElement(n)) return
    all.push(n as Btn)
    walk((n as Btn).props.children)
  }
  walk(out)
  return all
}
const keys = (): Btn[] => drawn().filter((b) => b.props.className?.split(' ').includes('touchpad__key'))
const cells = (): string[] => keys().map((b) => /touchpad__key--(\S+)/.exec(b.props.className ?? '')?.[1] ?? '')
const find = (cls: string): Btn => {
  const b = drawn().find((x) => x.props.className?.split(' ').includes(cls))
  if (!b) throw new Error(`no ${cls}`)
  return b
}
const press = (b: Btn): void => {
  b.props.onPointerDown?.({ preventDefault: () => {}, stopPropagation: () => {}, clientX: 0, clientY: 0 })
  b.props.onPointerUp?.()
}
const keyDown = (code: string): void => {
  // One key at a time, each let go before the next: none is held into a diagonal.
  walkKeysReleased()
  walkKeyDown({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, preventDefault: () => {} })
}

beforeEach(async () => {
  stopSpectating()
  useCyberspace.setState({ held: false })
  useShards.setState({ pending: null, placedLast: null, deployStatus: 'idle' })
  useWalk.getState().exit()
  useBuilder.getState().exit()
  S().clearFocus()
  await placeSpawn()
  S().cancel()
  useWalk.getState().setGravity(false)
})

describe('the WALK pad', () => {
  it('has FORWARD, BACKWARD, the sides, JUMP and DOWN, and no scale keys or readout', () => {
    useWalk.getState().enter()
    expect(cells()).toEqual(['gravity', 'forward', 'left', 'backward', 'right', 'jump', 'down'])
    expect(drawn().some((b) => b.props.className === 'touchpad__hub')).toBe(false)
    expect(find('touchpad__key--forward').props.title).toBe('Forward (W)')
    expect(find('touchpad__key--backward').props.title).toBe('Backward (S)')
    expect(find('touchpad__key--jump').props.children).toContain('JUMP')
  })

  // Each key from a fresh WALK at the same head, against its keyboard key.
  const pairs: Array<[string, string]> = [
    ['touchpad__key--forward', 'KeyW'],
    ['touchpad__key--backward', 'KeyS'],
    ['touchpad__key--left', 'KeyA'],
    ['touchpad__key--right', 'KeyD'],
    ['touchpad__key--jump', 'Space'],
    ['touchpad__key--jump', 'KeyR'],
    ['touchpad__key--down', 'KeyC'],
    ['touchpad__key--down', 'KeyF'],
  ]
  for (const [cls, code] of pairs) {
    it(`${cls.replace('touchpad__key--', '').toUpperCase()} steps where ${code} does`, () => {
      const home = { ...S().position }
      useWalk.getState().enter()
      keyDown(code)
      const byKey = { ...S().cursor }
      useWalk.getState().exit()
      expect(byKey).not.toEqual(home)

      useWalk.getState().enter()
      press(find(cls))
      expect(S().cursor).toEqual(byKey)
      useWalk.getState().exit()
    })
  }

  it('FORWARD and BACKWARD are opposite, and JUMP and DOWN are opposite', () => {
    const home = S().position
    const delta = (cls: string): bigint[] => {
      useWalk.getState().enter()
      press(find(cls))
      const c = S().cursor
      useWalk.getState().exit()
      return [c.x - home.x, c.y - home.y, c.z - home.z]
    }
    expect(delta('touchpad__key--backward')).toEqual(delta('touchpad__key--forward').map((d) => -d))
    expect(delta('touchpad__key--down')).toEqual(delta('touchpad__key--jump').map((d) => -d))
  })

  it('FORWARD and BACKWARD go the way you face, as W and S do: at 45 degrees, diagonally, mirrored', () => {
    const home = S().position
    const delta = (act: () => void): bigint[] => {
      useWalk.getState().enter()
      useCyberspace.setState({ screenAxes: { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } })
      const t = Math.PI / 4
      Object.assign(walkFacing, { valid: true, forward: { x: Math.sin(t), y: 0, z: -Math.cos(t) }, right: { x: Math.cos(t), y: 0, z: Math.sin(t) } })
      act()
      const c = S().cursor
      useWalk.getState().exit()
      walkFacing.valid = false
      return [c.x - home.x, c.y - home.y, c.z - home.z]
    }
    expect(delta(() => press(find('touchpad__key--forward')))).toEqual([1n, 0n, -1n])
    expect(delta(() => press(find('touchpad__key--backward')))).toEqual([-1n, 0n, 1n])
    expect(delta(() => keyDown('KeyW'))).toEqual([1n, 0n, -1n])
    expect(delta(() => keyDown('KeyS'))).toEqual([-1n, 0n, 1n])
  })

  it('under GRAVITY DOWN stays on and says it absorbs a bounce (review of #649), and JUMP says jump', () => {
    useWalk.getState().enter()
    useWalk.getState().setGravity(true)
    expect(find('touchpad__key--down').props.disabled).toBeFalsy()
    expect(find('touchpad__key--down').props.title).toBe('Down: absorbs a bounce (C or F)')
    expect(find('touchpad__key--jump').props.title).toBe('Jump (Space or R)')
    useWalk.getState().setGravity(false)
    expect(find('touchpad__key--down').props.disabled).toBeFalsy()
    expect(find('touchpad__key--down').props.title).toBe('Down one cell (C or F)')
  })
})

describe('HOP and VIEW keep their pad', () => {
  it('six directions, the two scale keys and the readout', () => {
    expect(cells()).toEqual(expect.arrayContaining(['away', 'up', 'toward', 'left', 'right', 'zoomout', 'down', 'zoomin']))
    expect(cells()).not.toContain('forward')
    expect(drawn().some((b) => b.props.className === 'touchpad__hub')).toBe(true)
  })
})

describe('the commit slot on screen', () => {
  it('WALK goes to BUILD, BUILD is lit white and goes to HOP, and BUILD has RECALL', () => {
    useWalk.getState().enter()
    expect(find('touchops').props.className).toContain('touchops--mode-walk')
    press(find('is-walk'))
    expect(currentPadMode()).toBe('build')

    expect(find('touchpad').props.className).toContain('touchpad--mode-build')
    expect(find('touchops').props.className).toContain('touchops--mode-build')
    const build = find('is-build')
    expect(build.props.className).toContain('is-on')
    expect(build.props.children).toBe('BUILD')
    expect(find('touchops__cancel').props.children).toBe('RECALL')
    press(build)
    expect(currentPadMode()).toBe('hop')
  })

  it('RECALL in BUILD goes back to HOP; both wait while a deploy is lined up', () => {
    useBuilder.getState().enter('build')
    useShards.setState({ pending: { type: 'message', text: 'hi' } })
    expect(find('is-build').props.disabled).toBe(true)
    expect(find('touchops__cancel').props.disabled).toBe(true)
    press(find('is-build'))
    expect(useBuilder.getState().active).toBe(true)
    useShards.getState().cancelDeploy()
    useBuilder.getState().enter('build')

    expect(find('touchops__cancel').props.disabled).toBe(false)
    press(find('touchops__cancel'))
    expect(useBuilder.getState().active).toBe(false)
    expect(currentPadMode()).toBe('hop')
  })
})

describe('the pad and the commit block with the chain status strip up', () => {
  const lifted = (): boolean => (find('touchpad').props.className ?? '').split(' ').includes('is-lifted')
  const opsDrawn = (): boolean => drawn().some((b) => b.props.className?.split(' ').includes('touchops'))

  it('lifts the pad in HOP, VIEW, WALK and BUILD alike, and not without the strip', () => {
    useCyberspace.setState({ held: true })
    for (const mode of ['hop', 'view', 'walk', 'build', 'hop'] as const) {
      expect(currentPadMode()).toBe(mode)
      expect(opsDrawn()).toBe(true)
      expect(find('touchops').props.className).toContain('touchops--status')
      expect(lifted()).toBe(true)
      press(find('touchops__commit'))
    }
    // Nothing to report: no hold, no conflict, LOCAL.
    useCyberspace.setState({ held: false, chainConflict: null, canonicalLate: 0, live: false })
    useBuilder.getState().enter('build')
    expect(find('touchops').props.className).not.toContain('touchops--status')
    expect(lifted()).toBe(false)
  })

  it('draws no commit block in BUILD while spectating, and so lifts nothing', async () => {
    useCyberspace.setState({ held: true })
    useBuilder.getState().enter('build')
    await spectate(getPublicKey(generateSecretKey()))
    expect(useBuilder.getState().active).toBe(true)
    expect(opsDrawn()).toBe(false)
    expect(lifted()).toBe(false)
  })
})
