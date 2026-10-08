/**
 * hudBuildOrder.test.ts - in BUILD mode the Position panel is the first
 * panel in the menu (arkinox, 2026-10-08: "Position panel gets promoted to
 * top/first panel while active"), on a phone and a desktop alike, and it
 * goes back to its own place when the mode ends.
 *
 * The left column comes first on both: side by side on a desktop, stacked
 * above the right column on a phone (styles.css, max-width 1100px). So
 * "first" is the first panel of the left column, right under the brand.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'

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

// A server render reads a zustand store's server snapshot, which is its
// initial state. The two stores Hud orders by read the live state instead;
// everything else about them is the real thing.
vi.mock('../../store/useBuilder', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../store/useBuilder')>()
  const live = real.useBuilder
  return { ...real, useBuilder: Object.assign((sel: (s: ReturnType<typeof live.getState>) => unknown) => sel(live.getState()), live) }
})
vi.mock('../../store/useCyberspace', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../store/useCyberspace')>()
  const live = real.useCyberspace
  return { ...real, useCyberspace: Object.assign((sel: (s: ReturnType<typeof live.getState>) => unknown) => sel(live.getState()), live) }
})

import { Hud } from '../Hud'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'

/** The names of the components in each column, in order, as Hud lays them out. */
function columns(): { left: string[]; right: string[] } {
  let tree: ReactElement | null = null
  // Hud's hooks need a render to run in; its returned tree is what is read.
  renderToString(createElement(() => { tree = Hud({}); return null }))
  const names = (col: ReactNode): string[] => {
    const kids = (col as ReactElement<{ children: ReactNode[] }>).props.children
    return (Array.isArray(kids) ? kids : [kids])
      .filter((k): k is ReactElement => isValidElement(k) && typeof k.type === 'function')
      .map((k) => (k.type as { name: string }).name)
  }
  const [left, right] = (tree! as ReactElement<{ children: ReactNode[] }>).props.children
  return { left: names(left), right: names(right) }
}

afterEach(() => {
  useBuilder.getState().exit()
  useCyberspace.getState().clearFocus()
})

describe('the Position panel in BUILD mode', () => {
  it('is in its own place, in the right column, while the mode is off', () => {
    const { left, right } = columns()
    expect(left).not.toContain('PositionPanel')
    expect(right).toContain('PositionPanel')
  })

  it('is the first panel, under the brand, while the mode is on, and only there', () => {
    useBuilder.getState().enter('build')
    const { left, right } = columns()
    expect(left.slice(0, 2)).toEqual(['Brand', 'PositionPanel'])
    expect(right).not.toContain('PositionPanel')
  })

  it('outranks a move under way, which otherwise leads the menu', () => {
    useCyberspace.setState({ proof: { ...useCyberspace.getState().proof, status: 'computing' } })
    try {
      expect(columns().left.slice(0, 2)).toEqual(['Brand', 'ProofPanel'])
      useBuilder.getState().enter('build')
      expect(columns().left.slice(0, 3)).toEqual(['Brand', 'PositionPanel', 'ProofPanel'])
    } finally {
      useCyberspace.setState({ proof: { ...useCyberspace.getState().proof, status: 'idle' } })
    }
  })

  it('goes back to its own place on exit', () => {
    useBuilder.getState().enter('build')
    useBuilder.getState().exit()
    const { left, right } = columns()
    expect(left).not.toContain('PositionPanel')
    expect(right).toContain('PositionPanel')
  })
})
