/**
 * viewPanel.test.ts - the Settings panel (titled View until arkinox renamed
 * it, 2026-11-02), the one home of the scene's switches
 * (arkinox, 2026-10-09: toggles "in the style of the Proof Chain panel's show
 * chain trail toggle, not buttons. Each on its own row, each with a title and
 * short subtitle in gray", then moved together into a View panel).
 *
 * Eleven Field rows with a Switch each: Terrain dots, hX boxes, Hide avatar in
 * WALK, Look sphere in WALK, Gravity in WALK, Hard Mode Gravity, Chain trail, Region keys,
 * Headlamp, Spatial Audio, Glow and Sync hidden list. Each
 * drives the flag its old control drove and is remembered
 * the same way. The old controls are gone: no chips under Movement proof, no
 * trail switch in Proof chain, no checkbox in the Region keys list.
 */

import { describe, expect, it, vi } from 'vitest'
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
})
vi.mock('../../lib/workers', async (orig) => ({ ...(await orig() as object), postProof: () => {}, cancelProof: () => {} }))

// The Region keys modal renders through a portal into document.body; here
// there is no document, and the element itself is what is rendered.
vi.mock('react-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  createPortal: (el: ReactElement) => el,
}))

// A server render reads a zustand store's server snapshot, which is its
// initial state; here each store's hook reads the live state, as a mounted
// component in the browser does.
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { FLUID_PAUSED_HINT, ViewPanel, WALK_LIMITS_HINT } from '../ViewPanel'
import { ProofPanel } from '../ProofPanel'
import { ChainPanel } from '../ChainPanel'
import { SecretsModal } from '../SecretsModal'
import { Switch } from '../ui/Switch'
import { LAYERS_KEY, useLayers } from '../../store/useLayers'
import { useCyberspace } from '../../store/useCyberspace'
import { useWalk } from '../../store/useWalk'
import { GRAVITY_KEY, HARD_GRAVITY_KEY } from '../../store/walkGravity'
import { HARD_GRAVITY_HINT, HARD_GRAVITY_TITLE, SPATIAL_AUDIO_HINT, SPATIAL_AUDIO_TITLE } from '../ViewPanel'
import { FLUID_KEY, useFluidWalk } from '../../store/fluidSwitch'

type SwitchEl = ReactElement<{ id: string; checked: boolean; onCheckedChange: (v: boolean) => void }>

/** The View panel's switch with this id, as the panel returns it now (its hooks run inside a render). */
function viewSwitch(id: string): SwitchEl {
  let out: ReactNode = null
  renderToString(createElement(() => { out = ViewPanel(); return null }))
  const find = (node: ReactNode): SwitchEl | null => {
    if (Array.isArray(node)) {
      for (const n of node) { const hit = find(n); if (hit) return hit }
      return null
    }
    if (!isValidElement(node)) return null
    const props = node.props as { id?: string; children?: ReactNode }
    if (node.type === Switch && props.id === id) return node as SwitchEl
    return find(props.children)
  }
  const hit = find(out)
  if (!hit) throw new Error(`no switch ${id}`)
  return hit
}

/** The opening tag of the rendered switch with this id. */
function switchTag(html: string, id: string): string {
  const m = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))
  if (!m) throw new Error(`no switch ${id}`)
  return m[0]
}

const view = (): string => renderToString(createElement(ViewPanel))

/** [switch id, title as rendered, subtitle], in the panel's order. */
const ROWS: Array<[string, string, string]> = [
  ['view-terrain-dots', 'Terrain dots', 'Terrain difficulty: warmer dots cost more work to hop to.'],
  ['view-hx-boxes', '<span class="view__hx">h</span>X boxes', 'The math barriers where moving costs increase.'],
  ['view-walk-avatar', 'Hide avatar in WALK', 'Walk without your own avatar around the camera.'],
  ['view-walk-look', 'Look sphere in WALK', 'A ball in the bottom right to drag and look around.'],
  ['view-walk-gravity', 'Gravity in WALK', 'Fall, land and jump.'],
  ['view-walk-gravity-hard', 'Hard Mode Gravity', 'Gravity will not turn off if there is nothing to catch your fall.'],
  ['view-walk-fluid', 'Fluid WALK', 'Hold to glide. Moves still land on whole gibsons.'],
  ['view-walk-limits', 'Pause fluid walk when your chain falls behind', WALK_LIMITS_HINT],
  ['view-chain-trail', 'Chain trail', 'The red line of your movement history.'],
  ['view-region-keys', 'Region keys', 'Green cages on the regions you hold keys for.'],
  ['view-headlamp', 'Headlamp', 'Light shards from your view so their shape and depth show.'],
  ['view-spatial-audio', 'Spatial Audio', 'See spatial audio sources and fade perimeters.'],
  ['view-glow', 'Glow', 'Light and fog that objects cast.'],
  ['view-hides-sync', 'Sync hidden list', 'Your hidden things on every device signed in as you.'],
]

describe('the Settings panel', () => {
  it('is a panel titled Settings with fourteen switches, one to a row, each a title and a gray subtitle, in order', () => {
    const html = view()
    expect(html).toMatch(/^<section class="panel panel--view">/)
    expect(html).toContain('<h2>Settings</h2>')
    expect(html).not.toContain('<h2>View</h2>')
    expect(html.match(/class="ui-field"/g)).toHaveLength(ROWS.length)
    expect(html.match(/role="switch"/g)).toHaveLength(ROWS.length)
    let at = 0
    for (const [id, title, hint] of ROWS) {
      const label = `<label class="ui-field__text" for="${id}"><span class="ui-field__label">${title}</span><span class="ui-field__hint">${hint.replace("'", '&#x27;')}</span></label>`
      const where = html.indexOf(label)
      expect(where, id).toBeGreaterThan(at)
      at = where
      expect(switchTag(html, id)).toContain('role="switch"')
    }
  })

  it('Terrain dots and hX boxes drive the layer store, remembered on this device', () => {
    expect(useLayers.getState()).toMatchObject({ dots: true, boxes: true })
    expect(switchTag(view(), 'view-terrain-dots')).toContain('aria-checked="true"')

    viewSwitch('view-terrain-dots').props.onCheckedChange(false)
    expect(useLayers.getState()).toMatchObject({ dots: false, boxes: true })
    expect(JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null')).toEqual({ dots: false, boxes: true, walkAvatarHidden: false, walkLookSphere: true, headlamp: true, spatialAudio: false, glow: true, walkLimits: true })
    expect(switchTag(view(), 'view-terrain-dots')).toContain('aria-checked="false"')
    expect(switchTag(view(), 'view-hx-boxes')).toContain('aria-checked="true"')

    viewSwitch('view-hx-boxes').props.onCheckedChange(false)
    viewSwitch('view-terrain-dots').props.onCheckedChange(true)
    expect(useLayers.getState()).toMatchObject({ dots: true, boxes: false })
    expect(JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null')).toEqual({ dots: true, boxes: false, walkAvatarHidden: false, walkLookSphere: true, headlamp: true, spatialAudio: false, glow: true, walkLimits: true })
    expect(viewSwitch('view-hx-boxes').props.checked).toBe(false)

    viewSwitch('view-hx-boxes').props.onCheckedChange(true)
    expect(useLayers.getState()).toMatchObject({ dots: true, boxes: true })
  })

  it('Hide avatar in WALK starts off and drives the layer store, remembered on this device', () => {
    expect(useLayers.getState().walkAvatarHidden).toBe(false)
    expect(switchTag(view(), 'view-walk-avatar')).toContain('aria-checked="false"')
    viewSwitch('view-walk-avatar').props.onCheckedChange(true)
    expect(useLayers.getState().walkAvatarHidden).toBe(true)
    expect(JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null')).toMatchObject({ walkAvatarHidden: true })
    expect(switchTag(view(), 'view-walk-avatar')).toContain('aria-checked="true"')
    viewSwitch('view-walk-avatar').props.onCheckedChange(false)
    expect(useLayers.getState().walkAvatarHidden).toBe(false)
  })

  it('Look sphere in WALK starts on and drives the layer store, remembered on this device', () => {
    expect(useLayers.getState().walkLookSphere).toBe(true)
    expect(switchTag(view(), 'view-walk-look')).toContain('aria-checked="true"')
    viewSwitch('view-walk-look').props.onCheckedChange(false)
    expect(useLayers.getState().walkLookSphere).toBe(false)
    expect(JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null')).toMatchObject({ walkLookSphere: false })
    expect(switchTag(view(), 'view-walk-look')).toContain('aria-checked="false"')
    viewSwitch('view-walk-look').props.onCheckedChange(true)
    expect(useLayers.getState().walkLookSphere).toBe(true)
  })

  it('Headlamp starts on and drives the layer store, remembered on this device', () => {
    expect(useLayers.getState().headlamp).toBe(true)
    expect(switchTag(view(), 'view-headlamp')).toContain('aria-checked="true"')
    viewSwitch('view-headlamp').props.onCheckedChange(false)
    expect(useLayers.getState().headlamp).toBe(false)
    expect(JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null')).toMatchObject({ headlamp: false })
    expect(switchTag(view(), 'view-headlamp')).toContain('aria-checked="false"')
    viewSwitch('view-headlamp').props.onCheckedChange(true)
    expect(useLayers.getState().headlamp).toBe(true)
    expect(JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null')).toMatchObject({ headlamp: true })
  })

  it('Glow starts on and drives the layer store, remembered on this device', () => {
    expect(useLayers.getState().glow).toBe(true)
    expect(switchTag(view(), 'view-glow')).toContain('aria-checked="true"')
    viewSwitch('view-glow').props.onCheckedChange(false)
    expect(useLayers.getState().glow).toBe(false)
    expect(JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null')).toMatchObject({ glow: false })
    viewSwitch('view-glow').props.onCheckedChange(true)
    expect(useLayers.getState().glow).toBe(true)
  })

  it('Gravity in WALK says no key in its subtitle (arkinox, 2026-11-02: no trailing Z)', () => {
    expect(view()).toContain('<span class="ui-field__hint">Fall, land and jump.</span>')
    expect(view()).not.toContain('jump. Z.')
  })

  it('Spatial Audio is the owner\'s title and line, no dash, and starts off; it drives the layer store, remembered on this device (arkinox, 2026-11-22)', () => {
    expect(SPATIAL_AUDIO_TITLE).toBe('Spatial Audio')
    expect(SPATIAL_AUDIO_HINT).toBe('See spatial audio sources and fade perimeters.')
    const html = view()
    expect(html).toContain('<label class="ui-field__text" for="view-spatial-audio"><span class="ui-field__label">Spatial Audio</span><span class="ui-field__hint">See spatial audio sources and fade perimeters.</span></label>')
    expect(html).not.toContain('Sound spheres')
    expect(html).not.toMatch(/Spatial Audio\s*[-\u2013\u2014]/)
    expect(useLayers.getState().spatialAudio).toBe(false)
    expect(switchTag(html, 'view-spatial-audio')).toContain('aria-checked="false"')
    viewSwitch('view-spatial-audio').props.onCheckedChange(true)
    expect(useLayers.getState().spatialAudio).toBe(true)
    expect(JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null')).toMatchObject({ spatialAudio: true })
    expect(switchTag(view(), 'view-spatial-audio')).toContain('aria-checked="true"')
    viewSwitch('view-spatial-audio').props.onCheckedChange(false)
    expect(useLayers.getState().spatialAudio).toBe(false)
    expect(JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null')).toMatchObject({ spatialAudio: false })
  })

  it('Fluid WALK drives the switch, remembered on this device', () => {
    useFluidWalk.setState({ on: false })
    expect(switchTag(view(), 'view-walk-fluid')).toContain('aria-checked="false"')
    viewSwitch('view-walk-fluid').props.onCheckedChange(true)
    expect(useFluidWalk.getState().on).toBe(true)
    expect(localStorage.getItem(FLUID_KEY)).toBe('on')
    expect(switchTag(view(), 'view-walk-fluid')).toContain('aria-checked="true"')
    viewSwitch('view-walk-fluid').props.onCheckedChange(false)
    expect(useFluidWalk.getState().on).toBe(false)
    expect(localStorage.getItem(FLUID_KEY)).toBe('off')
  })

  it('Fluid WALK paused for the chain keeps your choice on the switch and says it is paused; a tap turns it off, ends the pause and keeps it off (arkinox, 2026-11-22)', () => {
    useFluidWalk.setState({ on: true, paused: true, resumedAt: 0 })
    const html = view()
    expect(switchTag(html, 'view-walk-fluid')).toContain('aria-checked="true"')
    expect(html).toContain(`<span class="ui-field__hint">${FLUID_PAUSED_HINT}</span>`)
    expect(FLUID_PAUSED_HINT).not.toMatch(/\u2014/)
    viewSwitch('view-walk-fluid').props.onCheckedChange(false)
    expect(useFluidWalk.getState()).toMatchObject({ on: false, paused: false, resumedAt: 0 })
    expect(localStorage.getItem(FLUID_KEY)).toBe('off')
    const after = view()
    expect(switchTag(after, 'view-walk-fluid')).toContain('aria-checked="false"')
    expect(after).not.toContain(FLUID_PAUSED_HINT)
  })

  it('Gravity in WALK starts off and drives the walk, remembered on this device', () => {
    expect(useWalk.getState().gravity).toBe(false)
    expect(switchTag(view(), 'view-walk-gravity')).toContain('aria-checked="false"')
    viewSwitch('view-walk-gravity').props.onCheckedChange(true)
    expect(useWalk.getState().gravity).toBe(true)
    expect(localStorage.getItem(GRAVITY_KEY)).toBe('on')
    expect(switchTag(view(), 'view-walk-gravity')).toContain('aria-checked="true"')
    viewSwitch('view-walk-gravity').props.onCheckedChange(false)
    expect(useWalk.getState().gravity).toBe(false)
    expect(localStorage.getItem(GRAVITY_KEY)).toBe('off')
  })

  it('Hard Mode Gravity, in the owner\'s words with no dash, starts off and drives the walk, remembered on this device (arkinox, 2026-11-22)', () => {
    expect(HARD_GRAVITY_TITLE).toBe('Hard Mode Gravity')
    expect(HARD_GRAVITY_HINT).toBe('Gravity will not turn off if there is nothing to catch your fall.')
    expect(HARD_GRAVITY_TITLE + HARD_GRAVITY_HINT).not.toMatch(/[\u2013\u2014]/)
    expect(useWalk.getState().hardGravity).toBe(false)
    expect(switchTag(view(), 'view-walk-gravity-hard')).toContain('aria-checked="false"')
    viewSwitch('view-walk-gravity-hard').props.onCheckedChange(true)
    expect(useWalk.getState().hardGravity).toBe(true)
    expect(localStorage.getItem(HARD_GRAVITY_KEY)).toBe('on')
    expect(switchTag(view(), 'view-walk-gravity-hard')).toContain('aria-checked="true"')
    viewSwitch('view-walk-gravity-hard').props.onCheckedChange(false)
    expect(useWalk.getState().hardGravity).toBe(false)
    expect(localStorage.getItem(HARD_GRAVITY_KEY)).toBe('off')
  })

  it('Chain trail drives showTrail, remembered on this device', () => {
    expect(useCyberspace.getState().showTrail).toBe(true)
    expect(switchTag(view(), 'view-chain-trail')).toContain('aria-checked="true"')

    viewSwitch('view-chain-trail').props.onCheckedChange(false)
    expect(useCyberspace.getState().showTrail).toBe(false)
    expect(localStorage.getItem('onosendai:showTrail')).toBe('0')
    expect(switchTag(view(), 'view-chain-trail')).toContain('aria-checked="false"')

    viewSwitch('view-chain-trail').props.onCheckedChange(true)
    expect(useCyberspace.getState().showTrail).toBe(true)
    expect(localStorage.getItem('onosendai:showTrail')).toBe('1')
  })

  it('Region keys drives showSecrets, the flag the scene draws the cages from, off until turned on, remembered on this device', () => {
    // Off by default (arkinox, 2026-11-12): a device that never touched the switch saved nothing.
    expect(useCyberspace.getState().showSecrets).toBe(false)
    expect(switchTag(view(), 'view-region-keys')).toContain('aria-checked="false"')

    viewSwitch('view-region-keys').props.onCheckedChange(true)
    expect(useCyberspace.getState().showSecrets).toBe(true)
    expect(localStorage.getItem('onosendai:showSecrets')).toBe('1')
    expect(switchTag(view(), 'view-region-keys')).toContain('aria-checked="true"')

    viewSwitch('view-region-keys').props.onCheckedChange(false)
    expect(useCyberspace.getState().showSecrets).toBe(false)
    expect(localStorage.getItem('onosendai:showSecrets')).toBe('0')
  })

  it('touches no other flag: each switch changes only its own', () => {
    // From every switch on (Region keys starts off: turned on first).
    useCyberspace.getState().setShowSecrets(true)
    const flags = () => ({ ...useLayers.getState(), trail: useCyberspace.getState().showTrail, keys: useCyberspace.getState().showSecrets })
    const pick = ({ dots, boxes, trail, keys }: ReturnType<typeof flags>) => ({ dots, boxes, trail, keys })
    const all = { dots: true, boxes: true, trail: true, keys: true }
    expect(pick(flags())).toEqual(all)
    const named: Array<[string, keyof typeof all]> = [
      ['view-terrain-dots', 'dots'], ['view-hx-boxes', 'boxes'], ['view-chain-trail', 'trail'], ['view-region-keys', 'keys'],
    ]
    for (const [id, flag] of named) {
      viewSwitch(id).props.onCheckedChange(false)
      expect(pick(flags()), id).toEqual({ ...all, [flag]: false })
      viewSwitch(id).props.onCheckedChange(true)
    }
  })
})

describe('the switches have one home: their old controls are gone', () => {
  it('the Movement proof panel has no layer chips and no switch', () => {
    const html = renderToString(createElement(ProofPanel))
    expect(html).toContain('KEYRING')
    expect(html).not.toContain('REGION KEYS')
    expect(html).not.toContain('proof__layers')
    expect(html).not.toContain('hX BOXES')
    expect(html).not.toContain('role="switch"')
  })

  it('the Proof chain panel has no trail switch', () => {
    const html = renderToString(createElement(ChainPanel))
    expect(html).toContain('Proof chain')
    expect(html).not.toContain('chain-show-trail')
    expect(html).not.toContain('Show chain trail')
    expect(html).not.toContain('role="switch"')
  })

  it('the KEYRING list (once Region keys) has no draw-in-the-scene checkbox', () => {
    if (typeof document === 'undefined') (globalThis as { document?: unknown }).document = { body: {} }
    const html = renderToString(createElement(SecretsModal, { onClose: () => {} }))
    expect(html).toContain('Keyring')
    expect(html).not.toContain('secrets-draw')
    expect(html).not.toContain('Draw them in the scene')
    expect(html).not.toContain('ui-checkbox')
  })
})

describe('the tutorial is not in Settings (owner, 2026-11-13: moved into the menu\'s Tutorial panel)', () => {
  it('has no tutorial switch, RESUME or RESTART, whatever the switch says', async () => {
    const { useTutorialSwitch } = await import('../../tutorial/gate')
    for (const value of [null, true, false]) {
      useTutorialSwitch.setState({ value })
      expect(view()).not.toContain('view-tutorial')
      expect(view()).not.toContain('TUTORIAL')
    }
    useTutorialSwitch.setState({ value: null })
  })
})

describe('Sync hidden list (owner ruling, 2026-11-15)', () => {
  it('starts on, turns off and on, is remembered on this device, and says what it does in EXPLAIN', async () => {
    const { useHidesSync } = await import('../../store/hidesSync')
    expect(useHidesSync.getState().enabled).toBe(true)
    expect(switchTag(view(), 'view-hides-sync')).toContain('aria-checked="true"')
    viewSwitch('view-hides-sync').props.onCheckedChange(false)
    expect(useHidesSync.getState().enabled).toBe(false)
    expect(localStorage.getItem('onosendai:hides-sync')).toBe('0')
    expect(switchTag(view(), 'view-hides-sync')).toContain('aria-checked="false"')
    viewSwitch('view-hides-sync').props.onCheckedChange(true)
    expect(localStorage.getItem('onosendai:hides-sync')).toBe('1')
    // EXPLAIN is folded until tapped: its words, from the panel's element tree.
    const words = (n: ReactNode): string => (typeof n === 'string' ? n : Array.isArray(n) ? n.map(words).join('') : isValidElement(n) ? words((n.props as { children?: ReactNode }).children) : '')
    const explain = words((ViewPanel() as ReactElement<{ children: ReactNode }>).props.children).replace(/\s+/g, ' ')
    expect(explain).toContain('Your list of hidden things is saved to the relay, encrypted so only you can read it.')
    expect(explain).toContain('Any device signed in as you shows the same list')
    expect(explain).toContain('no NIP-44')
    expect(explain).not.toContain('—')
  })

  it('a signer with no NIP-44 says so under the switch', async () => {
    const { useHidesSync } = await import('../../store/hidesSync')
    useHidesSync.setState({ enabled: true, status: 'unsupported', note: 'Your signer has no NIP-44 encryption, so your list of hidden things stays on this device.' })
    expect(view()).toContain('Your signer has no NIP-44 encryption')
    useHidesSync.setState({ status: 'idle', note: null })
  })
})
