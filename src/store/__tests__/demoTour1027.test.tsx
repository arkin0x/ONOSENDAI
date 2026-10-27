/**
 * demoTour1027.test.tsx - arkinox's second batch of /demo fixes (2026-10-27):
 * the scale chapter's wording and the Controls pad, the district on block
 * 101 at 2^0, the cameras of the cube and Earth steps, block 1 picked out,
 * the cyberspace-mcp link, the operator step gone, XOR's present position,
 * and the last step's three buttons. Nothing here reaches a relay: XOR's
 * chain comes from a stub (tourHeads), and lib/relay is offline in tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // LOCAL before the stores load: a server render (the last step's panel
  // below) sees a store's first state, and LIVE would show the status line
  // where GO LIVE stands.
  const m = new Map<string, string>([['onosendai:live', '0']])
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

import { renderToStaticMarkup } from 'react-dom/server'
import { coordToXyz } from 'cyberspace-core'
import { useCyberspace } from '../useCyberspace'
import { PREV_LIVE_KEY, STEP_ALIASES, tourCamera, tourHeads, useDemo } from '../useDemo'
import { useHyperspace } from '../useHyperspace'
import { usePad } from '../usePad'
import { BLOCK_101_ROOT, DEMO_DISTRICT, DEMO_SCRIPT, XOR_PUBKEY } from '../../demo/script'
import { markdownCaption, splitCaption, spokenText } from '../../demo/captionTokens'
import { CaptionText, Finish, watchTvFromTour } from '../../hud/DemoCoach'
import { readFileSync } from 'node:fs'
import { MCP_REPO_URL } from '../../lib/agentInvite'
import { landfallCoord } from '../../lib/hyperspace/landfall'
import { CYCLE, HUE_TURN_S } from '../../scene/TourLine'

const at = (id: string) => DEMO_SCRIPT.steps.find((s) => s.id === id)!
const go = (id: string) => useDemo.getState().goTo(DEMO_SCRIPT.steps.findIndex((s) => s.id === id))
const BLOCK1_HASH = '00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048'
const realRead = tourHeads.read

beforeEach(() => {
  if (useDemo.getState().active) useDemo.getState().exit()
  localStorage.removeItem(PREV_LIVE_KEY)
  useCyberspace.getState().clearFocus()
  useCyberspace.getState().clearPin()
  useHyperspace.getState().setDestination(null)
  tourHeads.read = async () => null
})
afterEach(() => {
  if (useDemo.getState().active) useDemo.getState().exit()
  tourHeads.read = realRead
})

describe('the scale chapter (3/10)', () => {
  it('1/4 reads as arkinox wrote it, two paragraphs, and opens the Controls pad', () => {
    const gibson = at('gibson')
    expect(gibson.caption).toBe('Cyberspace is three axes of 85 bits each. One step along an axis is a gibson, the smallest unit in cyberspace, which is roughly the size of a hydrogen atom.\nThe Controls panel shows your current zoom, which is 1:1 gibson scale at zoom 2^0. As you zoom out, the number of gibsons per cell increases by 2^zoom.')
    expect(gibson.scene).toMatchObject({ target: 'self', scale: 0, pad: true })
    usePad.getState().setOpen(false)
    useDemo.getState().start('gibson')
    expect(usePad.getState().open).toBe(true)
    // The paragraph break is kept for the panel to show (.demo__caption pre-line).
    expect(renderToStaticMarkup(<CaptionText caption={gibson.caption} />)).toContain('hydrogen atom.\nThe Controls panel')
  })

  it('2/4 makes no claim in meters, and frames closer', () => {
    const human = at('human')
    expect(human.caption).toBe('Each zoom level doubles what you see. 2^34 gibsons across is the scale the spec calls human height.')
    expect(human.caption).not.toMatch(/meter|metre/)
    expect(human.scene).toMatchObject({ scale: 34, distance: 12 })
  })
})

describe('the demo district (5/10)', () => {
  it('is block 101\'s port, at 2^0, and the found step stays at 2^0', () => {
    expect(DEMO_DISTRICT).toEqual({ coord: BLOCK_101_ROOT, label: 'BLOCK 101 · PORT' })
    expect(at('district').scene.scale).toBe(0)
    expect(at('found').scene.scale).toBe(0)
  })
})

describe('the step cameras', () => {
  it('the cube steps and the ride frame the cube 12 cells off; the rest set none', () => {
    for (const id of ['everything', 'line', 'ride']) expect(at(id).scene.distance, id).toBe(12)
    const set = DEMO_SCRIPT.steps.filter((s) => s.scene.distance !== undefined).map((s) => s.id).sort()
    expect(set).toEqual(['everything', 'human', 'landfall', 'line', 'ride'])
  })

  it('a step without one hands the rig no camera', () => {
    useDemo.getState().start('welcome')
    expect(useDemo.getState().camera).toBeNull()
    go('everything')
    expect(useDemo.getState().camera).toEqual({ distance: 12, dir: null, at: null })
    go('spawn')
    expect(useDemo.getState().camera).toBeNull()
  })

  it('looks down at block 1 from space: the camera is out along Earth\'s radius through the landfall', () => {
    const cam = tourCamera(at('landfall').scene, 'ab'.repeat(32))!
    expect(cam.distance).toBe(20)
    const c = coordToXyz(landfallCoord(BLOCK1_HASH))
    const half = Number(1n << 84n)
    const v = [Number(c.x) - half, Number(c.y) - half, Number(c.z) - half]
    const len = Math.hypot(...v)
    const dot = cam.dir!.reduce((sum, d, i) => sum + d * (v[i] / len), 0)
    expect(dot).toBeGreaterThan(0.999999)
    // Its own place is block 1's landfall, where the stop's view lands (review of #523).
    expect(cam.at).toEqual({ x: c.x, y: c.y, z: c.z })
    expect(tourCamera(at('everything').scene, 'ab'.repeat(32))!.at).toBeNull()
  })
})

describe('block 1 picked out (7/10 3/4)', () => {
  it('is the destination and wears the pin while the step is up, and both go back after', () => {
    useDemo.getState().start('landfall')
    expect(useHyperspace.getState().destination).toBe(1)
    const pin = useCyberspace.getState().pin!
    expect(pin.label).toBe('BLOCK 1')
    const c = coordToXyz(landfallCoord(BLOCK1_HASH))
    expect(pin.position).toEqual({ x: c.x, y: c.y, z: c.z })
    go('ride')
    expect(useHyperspace.getState().destination).toBeNull()
    expect(useCyberspace.getState().pin).toBeNull()
  })

  it('gives back a destination the visitor had before, and leaves no pin of its own', () => {
    // A pin of the visitor's own does not outlive the tour either way: the
    // tour's exit ends the view, and ending a view takes its pin (clearFocus).
    useHyperspace.getState().setDestination(5000)
    useDemo.getState().start('landfall')
    expect(useHyperspace.getState().destination).toBe(1)
    useDemo.getState().exit()
    expect(useHyperspace.getState().destination).toBe(5000)
    expect(useCyberspace.getState().pin).toBeNull()
  })
})

describe('the hyperspace line colors (7/10)', () => {
  it('go once round the hues every 12 seconds, not fifteen times a second', () => {
    expect(HUE_TURN_S).toBe(12)
    // burstColor takes the hue of 9.31 times what it is given.
    expect(CYCLE * 9.31 * HUE_TURN_S).toBeCloseTo(1, 9)
  })
})

describe('the agents chapter (9/10)', () => {
  it('1/2 names cyberspace-mcp as a link to its repo, opening in a new tab', () => {
    const agents = at('agents')
    expect(agents.caption).toBe('AI agents live in cyberspace too. An agent has its own key and its own movement chain, and it pays the same costs to move. Your agent can use {link:cyberspace-mcp} to enter cyberspace, move, build, and respond to your commands through an encrypted channel.')
    expect(splitCaption(agents.caption).filter((p) => 'link' in p)).toEqual([{ link: 'cyberspace-mcp' }])
    const html = renderToStaticMarkup(<CaptionText caption={agents.caption} />)
    expect(html).toContain(`<a class="demo__link" href="${MCP_REPO_URL}" target="_blank" rel="noopener noreferrer">cyberspace-mcp</a>`)
    expect(MCP_REPO_URL).toBe('https://github.com/arkin0x/cyberspace-mcp')
    expect(spokenText(agents.caption)).toContain('Your agent can use cyberspace-mcp to enter cyberspace')
    expect(markdownCaption(agents.caption)).toContain(`[cyberspace-mcp](${MCP_REPO_URL})`)
  })

  it('an unknown link name stays text, and is never a link', () => {
    expect(splitCaption('a {link:evil} b')).toEqual([{ text: 'a {link:evil} b' }])
    expect(renderToStaticMarkup(<CaptionText caption={'{link:constructor}'} />)).not.toContain('<a')
  })

  it('has no operator step; its old link lands on the agents step', () => {
    expect(DEMO_SCRIPT.steps.some((s) => s.id === 'operator')).toBe(false)
    expect(DEMO_SCRIPT.steps.filter((s) => s.chapter === 'agents').map((s) => s.id)).toEqual(['agents', 'xor'])
    expect(STEP_ALIASES.operator).toBe('agents')
    useDemo.getState().start('operator')
    expect(DEMO_SCRIPT.steps[useDemo.getState().index].id).toBe('agents')
    useDemo.getState().next()
    expect(DEMO_SCRIPT.steps[useDemo.getState().index].id).toBe('xor')
  })
})

describe('XOR where it stands (9/10 2/2)', () => {
  const XOR_AT = { position: { x: 11n, y: 22n, z: 33n }, plane: 1 as const }

  it('looks at XOR\'s chain head, read for XOR\'s key', async () => {
    const asked: string[] = []
    tourHeads.read = async (pk) => { asked.push(pk); return XOR_AT }
    useDemo.getState().start('xor')
    await vi.waitFor(() => expect(useCyberspace.getState().focus?.label).toBe('XOR'))
    expect(asked).toEqual([XOR_PUBKEY])
    expect(useCyberspace.getState().focus?.position).toEqual(XOR_AT.position)
  })

  it('stays where it was when XOR\'s chain cannot be read', async () => {
    tourHeads.read = async () => { throw new Error('no relay') }
    useDemo.getState().start('xor')
    await Promise.resolve(); await Promise.resolve()
    expect(useCyberspace.getState().focus).toBeNull()
  })

  it('a chain that arrives after the step has gone moves nothing', async () => {
    let answer: (v: typeof XOR_AT) => void = () => {}
    tourHeads.read = () => new Promise((r) => { answer = r })
    useDemo.getState().start('xor')
    go('menu')
    answer(XOR_AT)
    await Promise.resolve(); await Promise.resolve()
    expect(useCyberspace.getState().focus?.label).not.toBe('XOR')
  })
})

describe('the last step (10/10 3/3)', () => {
  it('shows GO LIVE, READ THE PROTOCOL and WATCH CYBERSPACE TV as three buttons, in that order, GO LIVE not red', () => {
    expect(at('live').panel).toBe('finish')
    const html = renderToStaticMarkup(<Finish />)
    const finish = html.slice(html.indexOf('demo__finish'))
    const order = ['GO LIVE', 'READ THE PROTOCOL', 'WATCH CYBERSPACE TV'].map((t) => finish.indexOf(t))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(finish).toContain('class="demo__btn demo__btn--live"')
    expect(finish).toContain('<a class="demo__btn demo__btn--read" href="https://github.com/arkin0x/cyberspace" target="_blank" rel="noopener noreferrer">READ THE PROTOCOL</a>')
    expect(finish).toContain('class="demo__btn demo__btn--tv"')
    // GO LIVE wears the app's green now, not the red it had.
    const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')
    const live = /\.demo__btn--live \{([^}]*)\}/.exec(css)![1]
    expect(live).toContain('var(--ok)')
    expect(live).not.toMatch(/#c4203a|#ff5470|--danger/)
    expect(/\.demo__finish \{([^}]*)\}/.exec(css)![1]).toContain('flex-direction: column')
  })
})

describe('WATCH CYBERSPACE TV pressed twice (review of #523)', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('waits for the Back once, and a second press before it lands does nothing', () => {
    const listen = vi.fn()
    vi.stubGlobal('window', {
      location: { pathname: '/demo/live' },
      history: { state: { tour: 1 }, back: vi.fn(), replaceState: vi.fn(), pushState: vi.fn() },
      addEventListener: listen,
      removeEventListener: vi.fn(),
    })
    useDemo.getState().start('live')
    watchTvFromTour()
    watchTvFromTour()
    expect(useDemo.getState().active).toBe(false)
    expect(listen.mock.calls.filter(([type]) => type === 'popstate')).toHaveLength(1)
  })
})
