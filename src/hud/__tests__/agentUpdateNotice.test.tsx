/**
 * agentUpdateNotice.test.tsx: the update notice under an agent in MY AGENTS
 * (arkinox, 2026-11-23: "YOU MUST UPDATE cyberspace-mcp TO VERSION X" and an
 * "I've updated" button). His words exactly, the security line only for a
 * security release, the calm UPDATE AVAILABLE line, nothing for an unknown
 * version, and the rows drawn only once the check is done, so a notice never
 * pushes them down.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  publishMany: vi.fn(async () => { throw new Error('nothing publishes in a test') }),
  query: vi.fn(async () => []),
  askEach: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

// A server render reads a store's initial state; here it reads the live one (as agentsPanelPublic.test.tsx does).
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { renderToStaticMarkup } from 'react-dom/server'
import { AgentsPanel } from '../AgentsPanel'
import { AgentUpdateNotice, HowToUpdate, SECURITY_WHY, mustUpdateWords, stillOnWords, updateAvailableWords } from '../AgentUpdateNotice'
import { useCyberspace } from '../../store/useCyberspace'
import { useAgentDms } from '../../store/useAgentDms'
import { useMyAgentsAnswer } from '../../hooks/useMyAgents'
import { useAgentUpdatesState } from '../../store/useAgentUpdates'
import type { Release, Seen } from '../../lib/mcpUpdates'

const AGENT = 'c'.repeat(64)
const me = (): string => useCyberspace.getState().identity.pubkey
const rel = (version: string, minSafe: string | null, security: boolean): Release => ({ id: 'd'.repeat(64), created_at: 1, version, minSafe, security })

function state(seen: Seen, version: string | null, checked = true): void {
  useMyAgentsAnswer.setState({ me: me(), agents: [AGENT], status: 'ready' })
  useAgentDms.setState({ me: me(), myInbox: { status: 'ready', relays: ['wss://inbox.example'] } })
  useAgentUpdatesState.setState({ me: me(), checked, seen, versions: { [AGENT]: { version, at: 100 } }, dismissed: {} })
}

afterEach(() => {
  useMyAgentsAnswer.setState({ me: '', agents: [], status: 'loading' })
  useAgentUpdatesState.setState({ me: '', checked: false, seen: { latest: null, minSafe: null, security: null }, versions: {}, dismissed: {} })
})

describe('the update notice in MY AGENTS', () => {
  it('below the minimum safe version: his words, the security line, I\'VE UPDATED and HOW TO UPDATE', () => {
    state({ latest: rel('0.3.0', '0.2.0', true), minSafe: '0.2.0', security: '0.3.0' }, '0.1.0')
    const html = renderToStaticMarkup(<AgentsPanel />)
    expect(mustUpdateWords('0.3.0')).toBe('YOU MUST UPDATE cyberspace-mcp TO VERSION 0.3.0')
    expect(html).toContain('YOU MUST UPDATE cyberspace-mcp TO VERSION 0.3.0')
    expect(html).toContain(SECURITY_WHY)
    expect(html).toContain('Running: 0.1.0')
    expect(html).toContain('I&#x27;VE UPDATED')
    expect(html).toContain('HOW TO UPDATE')
    expect(html).toContain('agentupd--must')
    expect(html).toContain('role="alert"')
  })

  it('no security line when the newer releases fix no security problem', () => {
    state({ latest: rel('0.3.0', '0.2.0', false), minSafe: '0.2.0', security: null }, '0.1.0')
    const html = renderToStaticMarkup(<AgentsPanel />)
    expect(html).toContain('YOU MUST UPDATE cyberspace-mcp TO VERSION 0.3.0')
    expect(html).not.toContain(SECURITY_WHY)
  })

  it('behind the latest but safe: the calm line', () => {
    state({ latest: rel('0.3.0', '0.2.0', false), minSafe: '0.2.0', security: null }, '0.2.0')
    const html = renderToStaticMarkup(<AgentsPanel />)
    expect(html).toContain(updateAvailableWords('0.3.0'))
    expect(html).toContain('UPDATE AVAILABLE: cyberspace-mcp 0.3.0')
    expect(html).not.toContain('YOU MUST UPDATE')
    expect(html).not.toContain('agentupd--must')
  })

  it('an unknown version, or a current one: nothing', () => {
    state({ latest: rel('0.3.0', '0.2.0', true), minSafe: '0.2.0', security: '0.3.0' }, null)
    expect(renderToStaticMarkup(<AgentsPanel />)).not.toContain('agentupd')
    state({ latest: rel('0.3.0', '0.2.0', true), minSafe: '0.2.0', security: '0.3.0' }, '0.3.0')
    expect(renderToStaticMarkup(<AgentsPanel />)).not.toContain('agentupd')
  })

  it('the rows wait for the first check (LOADING), so a notice never pushes them down', () => {
    state({ latest: rel('0.3.0', '0.2.0', true), minSafe: '0.2.0', security: '0.3.0' }, '0.1.0', false)
    const html = renderToStaticMarkup(<AgentsPanel />)
    expect(html).toContain('LOADING')
    expect(html).not.toContain('SPECTATE')
    state({ latest: rel('0.3.0', '0.2.0', true), minSafe: '0.2.0', security: '0.3.0' }, '0.1.0', true)
    expect(renderToStaticMarkup(<AgentsPanel />)).toContain('SPECTATE')
  })

  it('back after I\'VE UPDATED: says the version it is still on', () => {
    const html = renderToStaticMarkup(<AgentUpdateNotice notice={{ level: 'must', latest: '0.3.0', running: '0.1.0', security: false, stillOn: '0.1.0' }} onUpdated={() => undefined} />)
    expect(html).toContain(stillOnWords('0.1.0'))
    expect(html).toContain('Still on version 0.1.0.')
  })

  it('no em or en dash, and no emoji, in anything shown', () => {
    const shown = [mustUpdateWords('1.2.3'), updateAvailableWords('1.2.3'), SECURITY_WHY, stillOnWords('1.2.3'),
      renderToStaticMarkup(<AgentUpdateNotice notice={{ level: 'available', latest: '0.3.0', running: '0.2.0', security: false, stillOn: null }} onUpdated={() => undefined} />)]
    for (const t of shown) {
      expect(t).not.toMatch(/[–—]/)
      expect(t).not.toMatch(/\p{Extended_Pictographic}/u)
    }
  })
})

describe('HOW TO UPDATE', () => {
  it('lists the README commands for the version to update to, then restart', () => {
    const html = renderToStaticMarkup(<HowToUpdate version="0.3.0" />)
    expect(html).toContain('git pull &amp;&amp; npm ci --omit=dev --ignore-scripts')
    expect(html).toContain('npm i -g github:arkin0x/cyberspace-mcp#v0.3.0')
    expect(html).toContain('Then restart serve.')
  })
})
