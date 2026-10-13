/**
 * agentsPanelPublic.test.tsx: the AGENTS panel as a public BETA (arkinox,
 * 2026-10-13: "ship it so that we can make the agent panel public"). It
 * draws for someone with no agent, carries a BETA tag that says what beta
 * means, asks someone with no account of their own to log in first, and
 * offers SET UP DM INBOX when the relays answered that there is none, whose
 * confirmation says what is published and where before anything is signed.
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

// No relay is ever reached from here: publishing would fail the test.
vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  publishMany: vi.fn(async () => { throw new Error('nothing publishes in a test') }),
  query: vi.fn(async () => []),
  askEach: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

// A server render reads a store's initial state; here it reads the live one (as hudBuildOrder.test.ts does).
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { renderToStaticMarkup } from 'react-dom/server'
import { AgentsPanel, BETA_TIP, isChosenIdentity } from '../AgentsPanel'
import { DM_INBOX_CONFIRM, DM_INBOX_RELAYS_NOTE, DmInboxConfirmBody, DmInboxSetup } from '../DmInboxSetup'
import { DM_INBOX_TIP } from '../AgentTalk'
import { useCyberspace } from '../../store/useCyberspace'
import { useAgentDms } from '../../store/useAgentDms'
import { useMyAgentsAnswer } from '../../hooks/useMyAgents'
import { DEFAULT_DM_RELAYS } from '../../lib/inbox'

const PREF = 'onosendai:signer'
const me = (): string => useCyberspace.getState().identity.pubkey

/** Logged in as the current identity, the way LoginModal leaves it. */
function logIn(): void { localStorage.setItem(PREF, JSON.stringify({ kind: 'nip07', pubkey: me() })) }

/** The store as the relays would leave it: no agents, and my inbox as given. */
function answered(inbox: 'none' | 'ready' | 'loading'): void {
  useMyAgentsAnswer.setState({ me: me(), agents: [], status: 'ready' })
  useAgentDms.setState({ me: me(), myInbox: { status: inbox, relays: inbox === 'ready' ? ['wss://inbox.example'] : [] } })
}

afterEach(() => {
  localStorage.removeItem(PREF)
  useMyAgentsAnswer.setState({ me: '', agents: [], status: 'loading' })
  useAgentDms.setState({ me: '', myInbox: { status: 'loading', relays: [] }, inboxSetup: { status: 'idle', error: null } })
})

describe('the AGENTS panel, public as a BETA', () => {
  it('carries a BETA tag whose tooltip says what beta means here', () => {
    const html = renderToStaticMarkup(<AgentsPanel />)
    expect(html).toContain('>BETA<')
    expect(html).toContain('title="Beta: agents are new.')
    expect(BETA_TIP).toMatch(/never your funds/)
  })

  it('with no account of your own, says to log in first and offers nothing else', () => {
    answered('none')
    expect(isChosenIdentity(me())).toBe(false)
    const html = renderToStaticMarkup(<AgentsPanel />)
    expect(html).toContain('Log in with your Nostr account first.')
    expect(html).toContain('LOG IN')
    expect(html).not.toContain('COPY')
    expect(html).not.toContain('SET UP DM INBOX')
    expect(html).not.toContain('MINE')
  })

  it('logged in with no agent: COPY, MY AGENTS empty, and SET UP DM INBOX when you have none', () => {
    logIn()
    answered('none')
    expect(isChosenIdentity(me())).toBe(true)
    const html = renderToStaticMarkup(<AgentsPanel />)
    expect(html).toContain('COPY')
    expect(html).toContain('0 MINE')
    expect(html).toContain('No agents yet.')
    expect(html).toContain('SET UP DM INBOX')
    // The button only: the confirmation opens on a tap, and nothing is sent by drawing it.
    expect(html).not.toContain('PUBLISH')
  })

  it('does not offer SET UP DM INBOX when you have one, or while it is being looked up', () => {
    logIn()
    answered('ready')
    expect(renderToStaticMarkup(<AgentsPanel />)).not.toContain('SET UP DM INBOX')
    answered('loading')
    expect(renderToStaticMarkup(<AgentsPanel />)).not.toContain('SET UP DM INBOX')
  })

  it('another identity\'s saved login does not count as yours', () => {
    localStorage.setItem(PREF, JSON.stringify({ kind: 'nip07', pubkey: 'f'.repeat(64) }))
    expect(isChosenIdentity(me())).toBe(false)
    expect(isChosenIdentity('')).toBe(false)
  })
})

describe('SET UP DM INBOX, before anything is signed', () => {
  it('the button alone draws no confirmation', () => {
    const html = renderToStaticMarkup(<DmInboxSetup />)
    expect(html).toContain('SET UP DM INBOX')
    expect(html).not.toContain(DM_INBOX_CONFIRM.slice(0, 30))
  })

  it('the confirmation says what is published (a kind 10050 of relays, public, no message content) and lists the relays', () => {
    const html = renderToStaticMarkup(<DmInboxConfirmBody />)
    expect(DM_INBOX_CONFIRM).toMatch(/kind 10050/)
    expect(DM_INBOX_CONFIRM).toMatch(/public list of the relays/)
    expect(DM_INBOX_CONFIRM).toMatch(/never message content/)
    expect(DM_INBOX_RELAYS_NOTE).toMatch(/free/)
    expect(DM_INBOX_RELAYS_NOTE).toMatch(/NIP-42/)
    for (const r of DEFAULT_DM_RELAYS) expect(html).toContain(r)
  })

  it('shows why the last try failed', () => {
    expect(renderToStaticMarkup(<DmInboxConfirmBody error="Not published: blocked: no" />)).toContain('Not published: blocked: no')
  })

  it('the NO DM INBOX tip no longer says this app never publishes it, and names the tap and the confirmation', () => {
    expect(DM_INBOX_TIP).not.toMatch(/never publishes/)
    expect(DM_INBOX_TIP).toMatch(/SET UP DM INBOX publishes one, only when you tap it and confirm/)
  })

  it('no em or en dash in anything shown', () => {
    for (const t of [BETA_TIP, DM_INBOX_CONFIRM, DM_INBOX_RELAYS_NOTE, DM_INBOX_TIP]) expect(t).not.toMatch(/[\u2013\u2014]/)
  })
})
