/**
 * useAgentUpdates.test.ts: the AGENTS panel's update check end to end, with
 * fake relays and fake IndexedDB (arkinox, 2026-11-23). Releases are signed
 * by a throwaway key passed as the trusted one, since the first release is
 * not out. "I'VE UPDATED" is kept per identity (arkinox, 2026-11-19: all
 * local data per npub, in IndexedDB) by agent and version, and the notice
 * comes back when the agent's newer events still run the old version.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

vi.mock('../../lib/relay', () => ({
  askEach: vi.fn(async () => { throw new Error('no relay is reached from here') }),
  relaySet: () => ['wss://relay.test'],
}))

import { appAddress, noticeFor } from '../../lib/mcpUpdates'
import { openAgentUpdateDb, readDismissals } from '../../lib/agentUpdateDb'
import type { NostrEvent } from '../../lib/events'
import { checkAgentUpdates, dismissAgentUpdate, useAgentUpdatesState, type CheckDeps } from '../useAgentUpdates'

const releaseSk = generateSecretKey()
const RELEASE = getPublicKey(releaseSk)
const agentSk = generateSecretKey()
const AGENT = getPublicKey(agentSk)
const ME = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
let now = 1_800_000_000

function release(version: string, minSafe?: string, sk = releaseSk): NostrEvent {
  const key = getPublicKey(sk)
  return finalizeEvent({
    kind: 30063, created_at: now - 1000, content: 'A fix.',
    tags: [['d', `cyberspace-mcp@${version}`], ['i', 'cyberspace-mcp'], ['version', version], ['c', 'main'], ['f', 'linux-x86_64'], ['e', 'e'.repeat(64)], ['a', appAddress(key)], ['security', 'true'], ...(minSafe ? [['min_allowed_version', minSafe]] : [])],
  }, sk) as NostrEvent
}

function hop(version: string | null, at: number): NostrEvent {
  return finalizeEvent({ kind: 3333, created_at: at, content: '', tags: [['C', 'ab'.repeat(32)], version ? ['client', 'cyberspace-mcp', '', '', version] : ['client', 'cyberspace-mcp']] }, agentSk) as NostrEvent
}

/** Fake relays: the release events and the agent's events, by filter. */
function relays(releases: NostrEvent[], agentEvents: NostrEvent[]): CheckDeps {
  return {
    releasePubkey: RELEASE,
    ask: async (_relays, filter, onEvent) => {
      const f = filter as { kinds?: number[]; authors?: string[] }
      const source = f.kinds?.includes(30063) ? releases : agentEvents
      for (const ev of source) if (!f.authors || f.authors.includes(ev.pubkey)) onEvent(ev)
      return []
    },
    openDb: openDbOnce,
    nowS: () => now,
  }
}
let openDbOnce: () => Promise<IDBDatabase>

const notice = () => {
  const s = useAgentUpdatesState.getState()
  return noticeFor(s.seen, s.versions[AGENT] ?? null, s.dismissed[AGENT] ?? null)
}

beforeEach(() => {
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  // A fresh database per test, opened once like the app's.
  let opened: Promise<IDBDatabase> | null = null
  openDbOnce = () => (opened ??= openAgentUpdateDb())
  useAgentUpdatesState.setState({ me: '', checked: false, seen: { latest: null, minSafe: null, security: null }, versions: {}, dismissed: {} })
  now = 1_800_000_000
})

describe('the update check', () => {
  it('below the minimum: must; behind but safe: available; no version: nothing', async () => {
    await checkAgentUpdates(ME, [AGENT], relays([release('0.3.0', '0.2.0')], [hop('0.1.0', now - 50)]))
    expect(useAgentUpdatesState.getState().checked).toBe(true)
    expect(notice()).toMatchObject({ level: 'must', latest: '0.3.0', running: '0.1.0', security: true })

    await checkAgentUpdates(ME, [AGENT], relays([release('0.3.0', '0.2.0')], [hop('0.2.0', now - 50)]))
    expect(notice()).toMatchObject({ level: 'available', latest: '0.3.0' })

    await checkAgentUpdates(ME, [AGENT], relays([release('0.3.0', '0.2.0')], [hop(null, now - 50)]))
    expect(notice()).toBeNull()
  })

  it('a release from another key, or a forged one, is ignored', async () => {
    const stranger = generateSecretKey()
    const forged = { ...release('9.0.0', '9.0.0', stranger), pubkey: RELEASE }
    await checkAgentUpdates(ME, [AGENT], relays([release('9.0.0', '9.0.0', stranger), forged], [hop('0.1.0', now - 50)]))
    expect(useAgentUpdatesState.getState().seen.latest).toBeNull()
    expect(notice()).toBeNull()
  })

  it('the minimum is kept per identity and never lowered, even when a relay hides the release that raised it', async () => {
    await checkAgentUpdates(ME, [AGENT], relays([release('0.3.0', '0.2.0')], [hop('0.1.0', now - 50)]))
    // A new session (the state starts over) whose relay hides 0.3.0 and offers only an old release.
    useAgentUpdatesState.setState({ me: '', checked: false, seen: { latest: null, minSafe: null, security: null }, versions: {}, dismissed: {} })
    await new Promise((r) => setTimeout(r, 20))
    await checkAgentUpdates(ME, [AGENT], relays([release('0.1.5')], [hop('0.1.0', now - 50)]))
    expect(useAgentUpdatesState.getState().seen.minSafe).toBe('0.2.0')
    // To the kept minimum, never to the older release this relay offered.
    expect(notice()).toMatchObject({ level: 'must', latest: '0.2.0' })
  })

  it("I'VE UPDATED is stored per identity by agent and version, and the notice comes back while the agent is still old", async () => {
    const deps = relays([release('0.3.0', '0.2.0')], [hop('0.1.0', now - 50)])
    await checkAgentUpdates(ME, [AGENT], deps)
    expect(notice()).not.toBeNull()
    await dismissAgentUpdate(ME, AGENT, deps)
    expect(notice()).toBeNull()

    const db = await openDbOnce()
    expect(await readDismissals(db, ME)).toEqual({ [AGENT]: { agent: AGENT, target: '0.3.0', level: 'must', from: '0.1.0', at: now } })
    // Another identity on this device never sees it.
    expect(await readDismissals(db, OTHER)).toEqual({})

    // A new session reads it back: still hidden while nothing newer was signed.
    useAgentUpdatesState.setState({ me: '', checked: false, seen: { latest: null, minSafe: null, security: null }, versions: {}, dismissed: {} })
    await checkAgentUpdates(ME, [AGENT], deps)
    expect(notice()).toBeNull()

    // A newer event from the agent, still on 0.1.0: the notice is back, saying so.
    now += 600
    await checkAgentUpdates(ME, [AGENT], relays([release('0.3.0', '0.2.0')], [hop('0.1.0', now - 1)]))
    expect(notice()).toMatchObject({ level: 'must', stillOn: '0.1.0' })

    // Updated for real: gone.
    await checkAgentUpdates(ME, [AGENT], relays([release('0.3.0', '0.2.0')], [hop('0.1.0', now - 300), hop('0.3.0', now)]))
    expect(notice()).toBeNull()
  })

  it('a switch to another identity starts clean and does not carry the dismissal', async () => {
    const deps = relays([release('0.3.0', '0.2.0')], [hop('0.1.0', now - 50)])
    await checkAgentUpdates(ME, [AGENT], deps)
    await dismissAgentUpdate(ME, AGENT, deps)
    await checkAgentUpdates(OTHER, [AGENT], deps)
    expect(useAgentUpdatesState.getState().me).toBe(OTHER)
    expect(notice()).toMatchObject({ level: 'must', stillOn: null })
  })

  it('with IndexedDB failing to open, the check still finishes and I\'VE UPDATED works for the session', async () => {
    const deps: CheckDeps = { ...relays([release('0.3.0', '0.2.0')], [hop('0.1.0', now - 50)]), openDb: async () => { throw new Error('blocked') } }
    await checkAgentUpdates(ME, [AGENT], deps)
    expect(useAgentUpdatesState.getState().checked).toBe(true)
    expect(notice()).toMatchObject({ level: 'must' })
    await dismissAgentUpdate(ME, AGENT, deps)
    expect(notice()).toBeNull()
  })

  it('with every relay failing, the check still finishes and nags about nothing', async () => {
    const deps: CheckDeps = { ...relays([], []), ask: async () => { throw new Error('down') } }
    await checkAgentUpdates(ME, [AGENT], deps)
    expect(useAgentUpdatesState.getState().checked).toBe(true)
    expect(notice()).toBeNull()
  })
})

describe('the last check, kept on the device (the owner, 2026-11-24: MY AGENTS empty for minutes)', () => {
  /** Relays that never answer, and a device that kept `kept`. */
  function silent(kept: unknown, keep = vi.fn()): CheckDeps {
    return { releasePubkey: RELEASE, ask: () => new Promise(() => undefined), openDb: openDbOnce, nowS: () => now, readKept: async () => kept, keep }
  }

  it('stands for the first check at once, with its notice, while the relays are still asked', async () => {
    const seen = { latest: { id: 'd'.repeat(64), created_at: 1, version: '0.3.0', minSafe: '0.2.0', security: true }, minSafe: '0.2.0', security: '0.3.0' }
    void checkAgentUpdates(ME, [AGENT], silent({ releasePubkey: RELEASE, seen, versions: { [AGENT]: { version: '0.1.0', at: now - 50 } } }))
    await vi.waitFor(() => { expect(useAgentUpdatesState.getState().checked).toBe(true) })
    expect(notice()).toMatchObject({ level: 'must', latest: '0.3.0', running: '0.1.0' })
  })

  it('not when it does not know every agent on the list', async () => {
    const seen = { latest: null, minSafe: null, security: null }
    const readKept = vi.fn(async () => ({ releasePubkey: RELEASE, seen, versions: {} }))
    void checkAgentUpdates(ME, [AGENT], { ...silent(null), readKept })
    await vi.waitFor(() => { expect(readKept).toHaveBeenCalled() })
    await new Promise((r) => setTimeout(r, 30))
    expect(useAgentUpdatesState.getState()).toMatchObject({ me: ME, checked: false })
  })

  it('not when it was kept under another release key', async () => {
    const seen = { latest: null, minSafe: null, security: null }
    const readKept = vi.fn(async () => ({ releasePubkey: 'f'.repeat(64), seen, versions: { [AGENT]: null } }))
    void checkAgentUpdates(ME, [AGENT], { ...silent(null), readKept })
    await vi.waitFor(() => { expect(readKept).toHaveBeenCalled() })
    await new Promise((r) => setTimeout(r, 30))
    expect(useAgentUpdatesState.getState()).toMatchObject({ me: ME, checked: false })
  })

  it('a notice dismissed with I\'VE UPDATED stays hidden while the kept check stands in', async () => {
    const seen = { latest: { id: 'd'.repeat(64), created_at: 1, version: '0.3.0', minSafe: '0.2.0', security: true }, minSafe: '0.2.0', security: '0.3.0' }
    const versions = { [AGENT]: { version: '0.1.0', at: now - 50 } }
    // A first check shows the notice, and I'VE UPDATED is kept in IndexedDB.
    void checkAgentUpdates(ME, [AGENT], silent({ releasePubkey: RELEASE, seen, versions }))
    await vi.waitFor(() => { expect(notice()).not.toBeNull() })
    await dismissAgentUpdate(ME, AGENT, silent(null))
    expect(notice()).toBeNull()
    // The next visit: a fresh state, the kept check stands in, and the dismissal with it.
    useAgentUpdatesState.setState({ me: '', checked: false, seen: { latest: null, minSafe: null, security: null }, versions: {}, dismissed: {} })
    void checkAgentUpdates(ME, [AGENT], silent({ releasePubkey: RELEASE, seen, versions }))
    await vi.waitFor(() => { expect(useAgentUpdatesState.getState().checked).toBe(true) })
    expect(notice()).toBeNull()
  })

  it('a finished check is kept for next time, per identity', async () => {
    const keep = vi.fn()
    await checkAgentUpdates(ME, [AGENT], { ...relays([release('0.3.0', '0.2.0')], [hop('0.1.0', now - 50)]), readKept: async () => undefined, keep })
    expect(keep).toHaveBeenCalledWith(ME, expect.objectContaining({ releasePubkey: RELEASE, versions: { [AGENT]: { version: '0.1.0', at: now - 50 } } }))
  })
})
