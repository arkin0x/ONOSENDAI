/**
 * viewPanel.test.ts - the View panel, the one home of the scene's switches
 * (arkinox, 2026-10-09: toggles "in the style of the Proof Chain panel's show
 * chain trail toggle, not buttons. Each on its own row, each with a title and
 * short subtitle in gray", then moved together into a View panel).
 *
 * Four Field rows with a Switch each: Terrain dots, hX boxes, Chain trail and
 * Region keys. Each drives the flag its old control drove and is remembered
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

import { ViewPanel } from '../ViewPanel'
import { ProofPanel } from '../ProofPanel'
import { ChainPanel } from '../ChainPanel'
import { SecretsModal } from '../SecretsModal'
import { Switch } from '../ui/Switch'
import { LAYERS_KEY, useLayers } from '../../store/useLayers'
import { useCyberspace } from '../../store/useCyberspace'

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
  ['view-chain-trail', 'Chain trail', 'The red line of your movement history.'],
  ['view-region-keys', 'Region keys', 'Green cages on the regions you hold keys for.'],
]

describe('the View panel', () => {
  it('is a panel titled View with four switches, one to a row, each a title and a gray subtitle, in order', () => {
    const html = view()
    expect(html).toMatch(/^<section class="panel panel--view">/)
    expect(html).toContain('<h2>View</h2>')
    expect(html.match(/class="ui-field"/g)).toHaveLength(4)
    expect(html.match(/role="switch"/g)).toHaveLength(4)
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
    expect(JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null')).toEqual({ dots: false, boxes: true })
    expect(switchTag(view(), 'view-terrain-dots')).toContain('aria-checked="false"')
    expect(switchTag(view(), 'view-hx-boxes')).toContain('aria-checked="true"')

    viewSwitch('view-hx-boxes').props.onCheckedChange(false)
    viewSwitch('view-terrain-dots').props.onCheckedChange(true)
    expect(useLayers.getState()).toMatchObject({ dots: true, boxes: false })
    expect(JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null')).toEqual({ dots: true, boxes: false })
    expect(viewSwitch('view-hx-boxes').props.checked).toBe(false)

    viewSwitch('view-hx-boxes').props.onCheckedChange(true)
    expect(useLayers.getState()).toMatchObject({ dots: true, boxes: true })
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

  it('Region keys drives showSecrets, the flag the scene draws the cages from, remembered on this device', () => {
    expect(useCyberspace.getState().showSecrets).toBe(true)
    expect(switchTag(view(), 'view-region-keys')).toContain('aria-checked="true"')

    viewSwitch('view-region-keys').props.onCheckedChange(false)
    expect(useCyberspace.getState().showSecrets).toBe(false)
    expect(localStorage.getItem('onosendai:showSecrets')).toBe('0')
    expect(switchTag(view(), 'view-region-keys')).toContain('aria-checked="false"')

    viewSwitch('view-region-keys').props.onCheckedChange(true)
    expect(useCyberspace.getState().showSecrets).toBe(true)
    expect(localStorage.getItem('onosendai:showSecrets')).toBe('1')
  })

  it('touches no other flag: each switch changes only its own', () => {
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
    expect(html).toContain('REGION KEYS')
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

  it('the Region keys list has no draw-in-the-scene checkbox', () => {
    if (typeof document === 'undefined') (globalThis as { document?: unknown }).document = { body: {} }
    const html = renderToString(createElement(SecretsModal, { onClose: () => {} }))
    expect(html).toContain('Region keys')
    expect(html).not.toContain('secrets-draw')
    expect(html).not.toContain('Draw them in the scene')
    expect(html).not.toContain('ui-checkbox')
  })
})
