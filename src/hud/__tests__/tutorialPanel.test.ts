/**
 * tutorialPanel.test.ts - the menu's Tutorial panel, the one home of the
 * first-arrival tutorial's controls since the owner moved them out of
 * Settings (2026-11-13): the device switch, RESUME TUTORIAL (shown when this
 * identity has a run to pick up) and RESTART TUTORIAL. Drawn switched off
 * too, showing only the switch, so it can be turned back on.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
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

// A server render reads a zustand store's server snapshot; here each store's hook reads the live state.
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { TutorialPanel } from '../TutorialPanel'
import { Switch } from '../ui/Switch'
import { useTutorial } from '../../store/useTutorial'
import { useCyberspace } from '../../store/useCyberspace'
import { useTv } from '../../store/useTv'
import { useDemo } from '../../store/useDemo'
import { TUTORIAL_SWITCH_KEY, readProgress, useTutorialSwitch, writeProgress } from '../../tutorial/gate'

type SwitchEl = ReactElement<{ id: string; checked: boolean; onCheckedChange: (v: boolean) => void }>

const panel = (): string => renderToString(createElement(TutorialPanel))
const pubkey = (): string => useCyberspace.getState().identity.pubkey
const RESUME = /<button class="avatars__go"( disabled="")?>RESUME TUTORIAL<\/button>/
const RESTART = /<button class="avatars__go"( disabled="")?>RESTART TUTORIAL<\/button>/

function theSwitch(): SwitchEl {
  let out: ReactNode = null
  renderToString(createElement(() => { out = TutorialPanel(); return null }))
  const find = (node: ReactNode): SwitchEl | null => {
    if (Array.isArray(node)) { for (const n of node) { const hit = find(n); if (hit) return hit } return null }
    if (!isValidElement(node)) return null
    const props = node.props as { id?: string; children?: ReactNode }
    if (node.type === Switch) return node as SwitchEl
    return find(props.children)
  }
  const hit = find(out)
  if (!hit) throw new Error('no switch')
  return hit
}

afterEach(() => {
  if (useTutorial.getState().active) useTutorial.getState().pause()
  useTutorial.setState({ active: false })
  useTutorialSwitch.setState({ value: null })
  localStorage.removeItem(TUTORIAL_SWITCH_KEY)
  writeProgress(pubkey(), null)
  useTv.setState({ on: false })
  useCyberspace.setState({ transit: null })
})

describe('the Tutorial panel', () => {
  it('on, with no run kept: the switch with its label, and RESTART only', () => {
    const html = panel()
    expect(html).toMatch(/^<section class="panel panel--tutorial">/)
    expect(html).toContain('<h2>Tutorial</h2>')
    expect(html).toContain('<span class="ui-field__label">Tutorial</span><span class="ui-field__hint">Guide a new identity on arrival.</span>')
    expect(html).toMatch(/id="tutorial-switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*id="tutorial-switch"/)
    expect(html).toMatch(RESTART)
    expect(html.match(RESTART)![1]).toBeUndefined()
    expect(html).not.toContain('RESUME TUTORIAL')
    // One restart, not two: START TUTORIAL is gone.
    expect(html).not.toContain('>START TUTORIAL<')
    expect(html.match(/RESTART TUTORIAL/g)).toHaveLength(1)
  })

  it('with a run kept for this identity: RESUME beside RESTART, both off while it runs', () => {
    writeProgress(pubkey(), { step: 'move', ended: 'skipped' })
    let html = panel()
    expect(html.indexOf('RESUME TUTORIAL')).toBeGreaterThan(0)
    expect(html.indexOf('RESUME TUTORIAL')).toBeLessThan(html.indexOf('RESTART TUTORIAL'))
    expect(html.match(RESUME)![1]).toBeUndefined()
    useTutorial.setState({ active: true })
    html = panel()
    expect(html.match(RESUME)![1]).toBe(' disabled=""')
    expect(html.match(RESTART)![1]).toBe(' disabled=""')
  })

  it('both are off over TV, the tour and on the line', () => {
    writeProgress(pubkey(), { step: 'move' })
    useTv.setState({ on: true })
    expect(panel().match(RESUME)![1]).toBe(' disabled=""')
    useTv.setState({ on: false })
    useDemo.setState({ active: true })
    expect(panel().match(RESTART)![1]).toBe(' disabled=""')
    useDemo.setState({ active: false })
    useCyberspace.setState({ transit: {} as never })
    expect(panel().match(RESUME)![1]).toBe(' disabled=""')
    expect(panel().match(RESTART)![1]).toBe(' disabled=""')
  })

  it('switched off: drawn, with only the switch; the switch turns it off and back on, and off puts a run away', () => {
    writeProgress(pubkey(), { step: 'move' })
    useTutorialSwitch.setState({ value: false })
    const html = panel()
    expect(html).toContain('<h2>Tutorial</h2>')
    expect(html).toContain('aria-checked="false"')
    expect(html).not.toContain('RESUME TUTORIAL')
    expect(html).not.toContain('RESTART TUTORIAL')
    theSwitch().props.onCheckedChange(true)
    expect(useTutorialSwitch.getState().value).toBe(true)
    expect(localStorage.getItem(TUTORIAL_SWITCH_KEY)).toBe('on')
    expect(panel()).toContain('RESUME TUTORIAL')
    const paused = vi.spyOn(useTutorial.getState(), 'pause')
    theSwitch().props.onCheckedChange(false)
    expect(paused).toHaveBeenCalled()
    expect(localStorage.getItem(TUTORIAL_SWITCH_KEY)).toBe('off')
    expect(readProgress(pubkey())?.step).toBe('move')
  })
})
