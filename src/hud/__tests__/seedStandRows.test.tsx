/**
 * seedStandRows.test.tsx: the deploy bar offers a seed TURN everywhere, and
 * SNAP TO EARTH and FINE ROTATION only in dataspace (DECK-0008 §5.7; owner
 * ruling 2026-11-10: "Planted in dataspace, the option to align to earth
 * should be toggleable"), at any height, where a shard's waits for 27.
 */
import { renderToStaticMarkup } from 'react-dom/server'
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
  onAuthChange: () => () => {},
  signInFailed: () => false,
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { BASE_CAPS } from 'sno-core/seeds'
import { useCyberspace } from '../../store/useCyberspace'
import { useShards } from '../../store/useShards'
import { DeployBar } from '../DeployBar'
import { ORIGINAL_DNAS } from '../../lib/seeds/originalDnas'

function render(): string {
  for (const store of [useShards, useCyberspace] as const) Object.assign(store.getInitialState(), store.getState())
  return renderToStaticMarkup(<DeployBar />)
}

/** A seed lined up at height 7, after the plane is set (a plane change stands a deploy down). */
function lineUp(plane: 0 | 1): void {
  useCyberspace.setState({ plane, anchorPlane: plane, focus: null })
  useShards.getState().startDeploySeed({ text: ORIGINAL_DNAS[5].text, caps: BASE_CAPS, scale: 0, title: '' })
  useShards.setState({ deployHeight: 7 })
}

beforeEach(() => { useShards.setState({ pending: null }) })

describe('a seed on the deploy bar', () => {
  it('in dataspace: TURN and SNAP TO EARTH at height 7; FINE ROTATION once it is snapped', () => {
    lineUp(0)
    let html = render()
    expect(html).toContain('TURN')
    expect(html).toContain('SNAP TO EARTH')
    expect(html).not.toContain('FINE ROTATION')
    useShards.setState({ deployUp: true })
    html = render()
    expect(html).toContain('bottom to Earth')
    expect(html).toContain('FINE ROTATION')
  })

  it('in ideaspace: TURN only; there is no Earth to stand on', () => {
    lineUp(1)
    useShards.setState({ deployUp: true })
    const html = render()
    expect(html).toContain('TURN')
    expect(html).not.toContain('SNAP TO EARTH')
    expect(html).not.toContain('FINE ROTATION')
  })
})
