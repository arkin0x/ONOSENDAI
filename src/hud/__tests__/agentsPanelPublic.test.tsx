/**
 * agentsPanelPublic.test.tsx: the AGENTS panel as a public BETA (arkinox,
 * 2026-10-13: "ship it so that we can make the agent panel public"). It
 * draws for someone with no agent, carries a BETA tag that says what beta
 * means, never asks anyone to log in (arkinox, 2026-11-11: the generated key
 * is an npub too), has the ACTIVATE field for an agent's npub, and offers
 * SET UP DM INBOX to an extension or a bunker when the relays answered that
 * there is none, whose confirmation says what is published and where before
 * anything is signed. The generated key publishes its inbox by itself, and
 * only once there is an agent.
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { ACTIVATED, AgentsPanel, BETA_TIP } from '../AgentsPanel'
import { DM_INBOX_CONFIRM, DM_INBOX_RELAYS_NOTE, DmInboxConfirmBody, DmInboxSetup } from '../DmInboxSetup'
import { DM_INBOX_TIP } from '../AgentTalk'
import { MINTED_KEY, useCyberspace } from '../../store/useCyberspace'
import { useAgentDms } from '../../store/useAgentDms'
import { useMyAgentsAnswer } from '../../hooks/useMyAgents'
import { DEFAULT_DM_RELAYS } from '../../lib/inbox'

const PREF = 'onosendai:signer'
const me = (): string => useCyberspace.getState().identity.pubkey

/** Logged in as the current identity, the way LoginModal leaves it. */
function logIn(): void { localStorage.setItem(PREF, JSON.stringify({ kind: 'nip07', pubkey: me() })) }

/** The store as the relays would leave it: no agents, and my inbox as given. */
function answered(inbox: 'none' | 'ready' | 'loading', agents: string[] = []): void {
  useMyAgentsAnswer.setState({ me: me(), agents, status: 'ready' })
  useAgentDms.setState({ me: me(), myInbox: { status: inbox, relays: inbox === 'ready' ? ['wss://inbox.example'] : [], ...(inbox === 'none' ? { complete: true } : {}) } })
}

/** The key on screen is the one this app generated on this device. */
function generatedKey(): void {
  useCyberspace.setState({ signerKind: 'local' })
  localStorage.setItem(MINTED_KEY, me())
}

afterEach(() => {
  localStorage.removeItem(PREF)
  localStorage.removeItem(MINTED_KEY)
  useCyberspace.setState({ signerKind: 'local' })
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

  it('on the generated local key: INVITE AN AGENT, COPY and the ACTIVATE field, never a login prompt', () => {
    generatedKey()
    answered('none')
    const html = renderToStaticMarkup(<AgentsPanel />)
    expect(html).toContain('Invite an agent')
    expect(html).toContain('COPY')
    expect(html).toContain('ACTIVATE')
    expect(html).toContain('placeholder="Paste your agent&#x27;s npub"')
    expect(html).toContain('0 MINE')
    expect(html).not.toMatch(/LOG IN|Log in/)
    // No agent yet: the inbox is not published, and there is no button for it.
    expect(html).not.toContain('SET UP DM INBOX')
    expect(html).not.toContain('SETTING UP DM INBOX')
  })

  it('on an extension that is not your saved login, the same panel: no login prompt', () => {
    useCyberspace.setState({ signerKind: 'nip07' })
    answered('none')
    const html = renderToStaticMarkup(<AgentsPanel />)
    expect(html).not.toMatch(/LOG IN|Log in/)
    expect(html).toContain('COPY')
    expect(html).toContain('ACTIVATE')
  })

  it('the explanation says to paste the npub and tap ACTIVATE, not to follow from another account', () => {
    // The explanation is behind its pill, so it is read from the source.
    const source = readFileSync(join(__dirname, '..', 'AgentsPanel.tsx'), 'utf8').replace(/\s+/g, ' ')
    expect(source).toContain('Paste the npub your agent sends back and tap ACTIVATE')
    expect(source).not.toMatch(/npub from your Nostr account/)
    expect(ACTIVATED).not.toMatch(/[\u2013\u2014]/)
  })

  it('on the generated key with an agent and no inbox: it is being set up by itself, no button', () => {
    generatedKey()
    answered('none', ['a'.repeat(64)])
    const html = renderToStaticMarkup(<AgentsPanel />)
    expect(html).toContain('SETTING UP DM INBOX')
    expect(html).not.toContain('>SET UP DM INBOX')
  })

  it('on the generated key, a "none" not every relay gave is asked again, never published', () => {
    generatedKey()
    answered('none', ['a'.repeat(64)])
    useAgentDms.setState({ myInbox: { status: 'none', relays: [] } })
    const html = renderToStaticMarkup(<AgentsPanel />)
    expect(html).toContain('ASK AGAIN')
    expect(html).not.toContain('SETTING UP DM INBOX')
  })

  it('a pasted nsec (a local signer, not a key made here) keeps the button and its confirmation', () => {
    useCyberspace.setState({ signerKind: 'local' })
    localStorage.setItem(MINTED_KEY, 'f'.repeat(64))
    answered('none')
    expect(renderToStaticMarkup(<AgentsPanel />)).toContain('SET UP DM INBOX')
  })

  it('logged in with an extension and no agent: COPY, MY AGENTS empty, and SET UP DM INBOX when you have none', () => {
    logIn()
    useCyberspace.setState({ signerKind: 'nip07' })
    answered('none')
    const html = renderToStaticMarkup(<AgentsPanel />)
    expect(html).toContain('COPY')
    expect(html).toContain('0 MINE')
    expect(html).toContain('No agents yet.')
    expect(html).toContain('SET UP DM INBOX')
    // The button only: the confirmation opens on a tap, and nothing is sent by drawing it.
    expect(html).not.toContain('PUBLISH')
  })

  it('does not offer SET UP DM INBOX when you have one, or while it is being looked up', () => {
    useCyberspace.setState({ signerKind: 'nip07' })
    answered('ready')
    expect(renderToStaticMarkup(<AgentsPanel />)).not.toContain('SET UP DM INBOX')
    answered('loading')
    expect(renderToStaticMarkup(<AgentsPanel />)).not.toContain('SET UP DM INBOX')
  })
})

describe('SET UP DM INBOX, before anything is signed', () => {
  it('the button alone draws no confirmation', () => {
    useCyberspace.setState({ signerKind: 'nip07' })
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
