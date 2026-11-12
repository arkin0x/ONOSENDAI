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
 *   pressing them goes on round the ring, WALK back to HOP; RECALL is there
 *   in BUILD too. At rest in HOP RECALL's slot is WALK (2026-11-11), and in
 *   WALK it is STOP while steps wait on their proofs.
 * - HOP and VIEW keep the pad they had.
 * - With the chain status strip up the commit block is a row taller, and the
 *   pad is lifted by that row wherever the block is drawn, BUILD included
 *   (review of #588: RECALL and BUILD stood over the scale keys). While
 *   spectating the SPECTATING bar holds that corner, so BUILD draws no block.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
import { viewEarth } from '../HyperspacePanel'
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
    // Plain forward again: no end zones, and the label says only what it is.
    expect((find('touchpad__key--forward').props as { 'aria-label'?: string })['aria-label']).toBe('Forward (W)')
    expect(drawn().some((b) => /touchpad__zone/.test(b.props.className ?? ''))).toBe(false)
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
    expect(find('touchpad__key--down').props.title).toBe('Down: hold to absorb a bounce (C or F)')
    expect(find('touchpad__key--jump').props.title).toBe('Jump (Space or R). Press again in the air to double jump.')
    useWalk.getState().setGravity(false)
    expect(find('touchpad__key--down').props.disabled).toBeFalsy()
    expect(find('touchpad__key--down').props.title).toBe('Down one cell (C or F)')
  })
})

describe('JUMP and DOWN on the left (arkinox, 2026-11-10)', () => {
  /** The keys drawn inside the element with class `cls`. */
  const inside = (cls: string): string[] => {
    const box = find(cls)
    const out: string[] = []
    const walk = (n: ReactNode): void => {
      if (Array.isArray(n)) { n.forEach(walk); return }
      if (!isValidElement(n)) return
      const m = /touchpad__key--(\S+)/.exec((n as Btn).props.className ?? '')
      if (m) out.push(m[1])
      walk((n as Btn).props.children)
    }
    walk(box.props.children)
    return out
  }

  it('JUMP and DOWN are in the left cluster, and the pad keeps GRAVITY, FORWARD, the sides and BACK', () => {
    useWalk.getState().enter()
    expect(inside('walkside')).toEqual(['jump', 'down'])
    expect(inside('touchpad')).toEqual(['gravity', 'forward', 'left', 'backward', 'right'])
  })

  it('under GRAVITY too, and nothing on the left outside WALK or while placing', () => {
    useWalk.getState().enter()
    useWalk.getState().setGravity(true)
    expect(inside('walkside')).toEqual(['jump', 'down'])
    useShards.setState({ pending: { type: 'message', text: 'hi' } })
    expect(drawn().some((b) => b.props.className === 'walkside')).toBe(false)
    useShards.getState().cancelDeploy()
    useWalk.getState().exit()
    expect(drawn().some((b) => b.props.className === 'walkside')).toBe(false)
  })

  it('the stylesheet stands the cluster over the menu button at the pad\'s height (lifted with it), the LOOK ball above it while it is drawn, and the pad without a JUMP row', () => {
    const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
    const rule = (sel: string): string => {
      const at = css.indexOf(`\n${sel} {`)
      expect(at).toBeGreaterThan(-1)
      return css.slice(at, css.indexOf('}', at))
    }
    expect(rule('.walkside')).toContain('left: var(--menu-left);')
    expect(rule('.walkside')).toContain('bottom: var(--walkside-bottom);')
    expect(css).toContain('--walkside-bottom: 92px;')
    // The pad's own bottom, which JUMP and DOWN sat on.
    expect(rule('.touchpad')).toContain('bottom: 92px;')
    // The LOOK ball is raised only while the row is drawn; otherwise it stays over the menu button.
    expect(rule('.orbsquare.walklook')).toContain('bottom: calc(var(--menu-bottom) + var(--menu-size) + var(--routeov-gap));')
    expect(rule('.app:has(.walkside) .orbsquare.walklook')).toContain('bottom: calc(var(--walkside-bottom) + var(--walkside-key) + var(--routeov-gap));')
    // With the HOSAKA mark too: the higher of the two, so it never touches JUMP.
    expect(rule('.app:has(.hosaka-pulse):has(.walkside) .walklook')).toContain('bottom: max(')
    // The pad lifted for the chain status strip: the row, and the ball on it, go up with it.
    expect(rule('.app:has(.touchpad.is-lifted)')).toContain('--walkside-bottom: 116px;')
    expect(css).toContain('.touchpad.is-lifted {\n  bottom: 116px;')
    expect(rule('.touchpad--mode-walk')).not.toContain('jump')
    expect(css).not.toContain('.touchpad__zone')
  })
})

describe('HOP and VIEW keep their pad', () => {
  it('six directions, the two scale keys and the readout', () => {
    expect(cells()).toEqual(expect.arrayContaining(['away', 'up', 'toward', 'left', 'right', 'zoomout', 'down', 'zoomin']))
    expect(cells()).not.toContain('forward')
    expect(drawn().some((b) => b.props.className === 'touchpad__hub')).toBe(true)
  })

  it('EARTH from the compass is a full VIEW: every direction, the Region key in its cell, VIEW lit, and no pin key even with a pin down (arkinox, 2026-11-11)', () => {
    viewEarth()
    S().dropPin({ x: 1n, y: 2n, z: 3n }, 'OLD PIN')
    expect(cells()).toEqual(expect.arrayContaining(['region', 'earth', 'cube', 'away', 'up', 'toward', 'left', 'right']))
    expect(cells()).not.toContain('pin')
    expect(keys().some((b) => (b.props.className ?? '').includes('is-standdown'))).toBe(false)
    expect(find('is-view').props.children).toBe('VIEW')
    // BUILD from the view keeps it, but region mode is VIEW's: no Region key there.
    useBuilder.getState().enter('build')
    expect(cells()).not.toContain('region')
    useBuilder.getState().exit()
    S().clearFocus()
  })
})

describe('the commit slot on screen', () => {
  it('VIEW goes to BUILD, BUILD is lit white and goes to HOP, and BUILD has RECALL', () => {
    S().viewHere()
    press(find('is-view'))
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

/** WALK out of the ring, in RECALL's slot at rest in HOP (arkinox, 2026-11-11). */
describe('WALK in RECALL\'s slot', () => {
  it('is there at rest in HOP, red, and enters WALK', () => {
    const walk = find('touchops__walk')
    expect(walk.props.className).toContain('touchops__cancel')
    expect(walk.props.title).toBe('Walk: first person, every press a step')
    expect((walk.props as { 'aria-label'?: string })['aria-label']).toBe('Walk: first person, every press a step')
    press(walk)
    expect(currentPadMode()).toBe('walk')
  })

  it('is RECALL, as before, with the cursor off your avatar, a move planned, or outside HOP', () => {
    S().moveCursor({ axis: 'x', dir: 1 })
    expect(drawn().some((b) => b.props.className?.includes('touchops__walk'))).toBe(false)
    expect(find('touchops__cancel').props.children).toBe('RECALL')
    S().cancel()
    expect(find('touchops__walk')).toBeTruthy()
    useCyberspace.setState({ plan: { status: 'paused' } as never })
    expect(drawn().some((b) => b.props.className?.includes('touchops__walk'))).toBe(false)
    useCyberspace.setState({ plan: null })
    // A proof computing or a cloud job: STOP or RECALL, never WALK.
    useCyberspace.setState({ proof: { ...S().proof, status: 'computing' } })
    expect(find('touchops__cancel').props.children).toBe('STOP')
    useCyberspace.setState({ proof: { ...S().proof, status: 'idle' }, cloud: { ...S().cloud, status: 'error' } })
    expect(find('touchops__cancel').props.children).toBe('RECALL')
    useCyberspace.setState({ cloud: { ...S().cloud, status: 'idle' } })
    S().viewHere()
    expect(drawn().some((b) => b.props.className?.includes('touchops__walk'))).toBe(false)
  })

  it('in WALK, RECALL and the mode button both go back to HOP', () => {
    useWalk.getState().enter()
    expect(find('is-walk').props.children).toBe('WALK')
    expect(find('touchops__cancel').props.children).toBe('RECALL')
    press(find('touchops__cancel'))
    expect(currentPadMode()).toBe('hop')
    useWalk.getState().enter()
    press(find('is-walk'))
    expect(currentPadMode()).toBe('hop')
  })

  // Must not regress (owner, 2026-11-11): steps ahead of their proofs make the slot STOP, which drops them back to the last proved step, still walking.
  it('in WALK with steps not yet proved, the slot is STOP and drops them back to the last proved step', () => {
    const start = { ...S().position }
    useWalk.getState().enter()
    useWalk.getState().press('up')
    useWalk.getState().press('right')
    expect(find('touchops__cancel').props.children).toBe('STOP')
    press(find('touchops__cancel'))
    expect(S().walking).toBe(true)
    expect(useWalk.getState().queue).toEqual([])
    expect(useWalk.getState().open).toBeNull()
    expect(S().proof.status).not.toBe('computing')
    expect(S().position).toEqual(start)
    expect(S().cursor).toEqual(start)
    expect(find('touchops__cancel').props.children).toBe('RECALL')
  })
})

describe('the pad and the commit block with the chain status strip up', () => {
  const lifted = (): boolean => (find('touchpad').props.className ?? '').split(' ').includes('is-lifted')
  const opsDrawn = (): boolean => drawn().some((b) => b.props.className?.split(' ').includes('touchops'))

  it('lifts the pad in HOP, VIEW, WALK and BUILD alike, and not without the strip', () => {
    useCyberspace.setState({ held: true })
    for (const mode of ['hop', 'view', 'build', 'hop'] as const) {
      expect(currentPadMode()).toBe(mode)
      expect(opsDrawn()).toBe(true)
      expect(find('touchops').props.className).toContain('touchops--status')
      expect(lifted()).toBe(true)
      press(find('touchops__commit'))
    }
    // The last press went on to VIEW; RECALL ends it, and HOP at rest has WALK.
    press(find('touchops__cancel'))
    press(find('touchops__walk'))
    expect(currentPadMode()).toBe('walk')
    expect(lifted()).toBe(true)
    useWalk.getState().exit()
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
