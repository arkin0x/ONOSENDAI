/**
 * mcpUpdates.test.ts: reading the cyberspace-mcp release key's NIP-82
 * releases and an agent's version as strictly as cyberspace-mcp does
 * (arkinox, 2026-11-23). The first release is not out yet, so every release
 * here is signed by a throwaway key passed as the trusted one; the compiled-in
 * release key is checked to be the real one and never this throwaway.
 */
import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import {
  agentVersionOf, appAddress, clientVersion, foldReleases, NOTHING_SEEN, noticeFor, parseRelease, parseRunning,
  RELEASE_PUBKEY, runningBelow, updateSteps, type AgentVersion, type Dismissal, type Seen,
} from '../mcpUpdates'
import type { NostrEvent } from '../events'

const releaseSk = generateSecretKey()
const RELEASE = getPublicKey(releaseSk)
const strangerSk = generateSecretKey()
const agentSk = generateSecretKey()
const AGENT = getPublicKey(agentSk)
const NOW = 1_800_000_000
const E = 'e'.repeat(64)

/** A kind 30063 as scripts/publish-update-notice.mjs builds it. */
function releaseTags(version: string, extra: { minSafe?: string; security?: boolean } = {}, key = RELEASE): string[][] {
  return [
    ['d', `cyberspace-mcp@${version}`], ['i', 'cyberspace-mcp'], ['version', version], ['c', 'main'],
    ['f', 'linux-x86_64'], ['f', 'darwin-arm64'], ['e', E], ['a', appAddress(key)], ['commit', 'c'.repeat(40)],
    ['security', extra.security ? 'true' : 'false'],
    ...(extra.minSafe ? [['min_allowed_version', extra.minSafe]] : []),
  ]
}

function release(version: string, extra: { minSafe?: string; security?: boolean; at?: number; tags?: string[][]; sk?: Uint8Array } = {}): NostrEvent {
  const sk = extra.sk ?? releaseSk
  return finalizeEvent({ kind: 30063, created_at: extra.at ?? NOW - 100, content: 'Fixes things.', tags: extra.tags ?? releaseTags(version, extra, getPublicKey(sk)) }, sk) as NostrEvent
}

function agentEvent(tag: string[] | null, at: number, sk = agentSk): NostrEvent {
  return finalizeEvent({ kind: 3333, created_at: at, content: '', tags: tag ? [['C', 'ab'.repeat(32)], tag] : [['C', 'ab'.repeat(32)]] }, sk) as NostrEvent
}

const seenOf = (...events: NostrEvent[]): Seen => foldReleases(NOTHING_SEEN, events, RELEASE, NOW)

describe('the release key', () => {
  it('is the cyberspace-mcp release key, compiled in', () => {
    expect(RELEASE_PUBKEY).toBe('5afe1212a3d7c7062166dcc8774c8a0f6c1399c1e0d9cc47ba0f72a94d877073')
    expect(RELEASE_PUBKEY).not.toBe(RELEASE)
  })
})

describe('a release (kind 30063)', () => {
  it('is read when the release key signed it and its shape is exact', () => {
    const r = parseRelease(release('0.2.0', { minSafe: '0.1.5', security: true }), RELEASE, NOW)
    expect(r).toMatchObject({ version: '0.2.0', minSafe: '0.1.5', security: true })
  })

  it('is ignored from any other key, even one with a good signature', () => {
    expect(parseRelease(release('0.2.0', { sk: strangerSk }), RELEASE, NOW)).toBeNull()
    // The compiled-in key is the default trust: a throwaway release is nothing to it.
    expect(parseRelease(release('0.2.0'), RELEASE_PUBKEY, NOW)).toBeNull()
  })

  it('is ignored when forged: a tag changed after signing, or the pubkey swapped', () => {
    const ev = release('0.2.0')
    expect(parseRelease({ ...ev, tags: ev.tags.map((t) => (t[0] === 'version' ? ['version', '9.9.9'] : t[0] === 'd' ? ['d', 'cyberspace-mcp@9.9.9'] : t)) }, RELEASE, NOW)).toBeNull()
    const theirs = release('0.2.0', { sk: strangerSk })
    expect(parseRelease({ ...theirs, pubkey: RELEASE }, RELEASE, NOW)).toBeNull()
    expect(parseRelease({ ...ev, sig: 'z'.repeat(128) }, RELEASE, NOW)).toBeNull()
  })

  it('is ignored when malformed', () => {
    const base = releaseTags('0.2.0')
    const without = (name: string): string[][] => base.filter((t) => t[0] !== name)
    const swap = (name: string, value: string[]): string[][] => base.map((t) => (t[0] === name ? value : t))
    const bad: Array<[string, string[][]]> = [
      ['a v in the version', swap('version', ['version', 'v0.2.0'])],
      ['a pre-release', [...swap('version', ['version', '0.2.0-rc.1']).map((t) => (t[0] === 'd' ? ['d', 'cyberspace-mcp@0.2.0-rc.1'] : t))]],
      ['seven digits', swap('version', ['version', '1234567.0.0'])],
      ['d that names another version', swap('d', ['d', 'cyberspace-mcp@0.3.0'])],
      ['another app', swap('i', ['i', 'other-app'])],
      ['another channel', swap('c', ['c', 'beta'])],
      ['no a', without('a')],
      ['an a to another listing', swap('a', ['a', `32267:${'f'.repeat(64)}:cyberspace-mcp`])],
      ['two a', [...base, ['a', appAddress(RELEASE)]]],
      ['no f', without('f')],
      ['no e', without('e')],
      ['a bad e', [...base, ['e', 'nope']]],
      ['the version twice', [...base, ['version', '0.2.0']]],
      ['a value too many', swap('c', ['c', 'main', 'extra'])],
      ['a minimum above the version', [...base, ['min_allowed_version', '0.3.0']]],
      ['a malformed minimum', [...base, ['min_allowed_version', '0.1']]],
      ['security that is not true or false', swap('security', ['security', 'yes'])],
      ['a short commit', swap('commit', ['commit', 'abc'])],
    ]
    for (const [why, tags] of bad) {
      expect(parseRelease(release('0.2.0', { tags }), RELEASE, NOW), why).toBeNull()
    }
    expect(parseRelease(release('0.2.0', { at: NOW + 3600 }), RELEASE, NOW), 'dated an hour ahead').toBeNull()
    expect(parseRelease({ ...release('0.2.0'), kind: 1 }, RELEASE, NOW)).toBeNull()
    expect(parseRelease(null, RELEASE, NOW)).toBeNull()
    expect(parseRelease('junk', RELEASE, NOW)).toBeNull()
  })

  it('latest is the highest version, never the newest event; the minimum and the security mark are the highest seen', () => {
    const newer = release('0.3.0', { at: NOW - 500, minSafe: '0.2.0', security: true })
    const backport = release('0.2.5', { at: NOW - 10, minSafe: '0.1.0' })
    const seen = seenOf(newer, backport)
    expect(seen.latest?.version).toBe('0.3.0')
    expect(seen.minSafe).toBe('0.2.0')
    expect(seen.security).toBe('0.3.0')
    // Folding a lower minimum later never lowers it.
    expect(foldReleases(seen, [release('0.3.1', { minSafe: '0.1.0' })], RELEASE, NOW).minSafe).toBe('0.2.0')
  })

  it('a forged or stranger release in the mix changes nothing', () => {
    const real = release('0.2.0')
    const stranger = release('9.0.0', { sk: strangerSk, minSafe: '9.0.0' })
    expect(seenOf(real, stranger)).toEqual(seenOf(real))
  })
})

describe('an agent\'s version', () => {
  it('is the fifth element of its cyberspace-mcp client tag', () => {
    expect(clientVersion({ tags: [['client', 'cyberspace-mcp', '', '', '0.1.0']] })).toBe('0.1.0')
    expect(clientVersion({ tags: [['client', 'cyberspace-mcp', '', '', '0.2.0-rc.1']] })).toBe('0.2.0-rc.1')
    expect(clientVersion({ tags: [['client', 'cyberspace-mcp']] })).toBeNull()
    expect(clientVersion({ tags: [['client', 'cyberspace-mcp', '', '', 'latest']] })).toBeNull()
    expect(clientVersion({ tags: [['client', 'ONOSENDAI']] })).toBeUndefined()
    expect(clientVersion({ tags: [] })).toBeUndefined()
  })

  it('comes from its newest cyberspace-mcp event, signed by it, not dated ahead', () => {
    const tag = (v: string): string[] => ['client', 'cyberspace-mcp', '', '', v]
    const events = [
      agentEvent(tag('0.1.0'), NOW - 300),
      agentEvent(tag('0.2.0'), NOW - 100),
      agentEvent(['client', 'ONOSENDAI'], NOW - 10),
      agentEvent(null, NOW - 5),
      agentEvent(tag('0.0.1'), NOW + 3600),
    ]
    expect(agentVersionOf(events, AGENT, NOW)).toEqual({ version: '0.2.0', at: NOW - 100 })
    // Someone else's event, or one whose signature does not hold, does not speak for the agent.
    const forged = { ...agentEvent(tag('0.0.1'), NOW - 50), tags: [['client', 'cyberspace-mcp', '', '', '0.0.9']] }
    const stranger = agentEvent(tag('0.0.1'), NOW - 40, strangerSk)
    expect(agentVersionOf([...events, forged, { ...stranger, pubkey: AGENT }, stranger], AGENT, NOW)).toEqual({ version: '0.2.0', at: NOW - 100 })
  })

  it('is never read from an item kind or kind 1: a moved item keeps the client tag of the copy that first signed it', () => {
    const tag = (v: string): string[] => ['client', 'cyberspace-mcp', '', '', v]
    const hop = agentEvent(tag('0.3.0'), NOW - 300)
    const items = [3330, 3340, 3341, 1063, 1].map((kind, i) => finalizeEvent({ kind, created_at: NOW - 10 + i, content: '', tags: [tag('0.1.0')] }, agentSk) as NostrEvent)
    expect(agentVersionOf([hop, ...items], AGENT, NOW)).toEqual({ version: '0.3.0', at: NOW - 300 })
    expect(agentVersionOf(items, AGENT, NOW)).toBeNull()
  })

  it('is unknown when its newest cyberspace-mcp event writes none, and absent when it has none', () => {
    expect(agentVersionOf([agentEvent(['client', 'cyberspace-mcp', '', '', '0.1.0'], NOW - 300), agentEvent(['client', 'cyberspace-mcp'], NOW - 10)], AGENT, NOW)).toEqual({ version: null, at: NOW - 10 })
    expect(agentVersionOf([agentEvent(['client', 'ONOSENDAI'], NOW - 10)], AGENT, NOW)).toBeNull()
  })

  it('a pre-release is below its release', () => {
    expect(parseRunning('0.2.0-rc.1')).toEqual({ v: [0, 2, 0], pre: true })
    expect(runningBelow('0.2.0-rc.1', '0.2.0')).toBe(true)
    expect(runningBelow('0.2.0', '0.2.0')).toBe(false)
    expect(runningBelow('0.10.0', '0.9.0')).toBe(false)
  })
})

describe('the notice', () => {
  const seen = seenOf(release('0.3.0', { minSafe: '0.2.0', security: true }))
  const at = (version: string | null, t = NOW - 100): AgentVersion => ({ version, at: t })

  it('below the minimum safe version: must, to the latest, with the security flag', () => {
    expect(noticeFor(seen, at('0.1.0'), null)).toEqual({ level: 'must', latest: '0.3.0', running: '0.1.0', security: true, stillOn: null })
  })

  it('behind the latest but safe: available', () => {
    expect(noticeFor(seen, at('0.2.0'), null)).toMatchObject({ level: 'available', latest: '0.3.0', running: '0.2.0' })
    const calm = seenOf(release('0.3.0'))
    expect(noticeFor(calm, at('0.2.0'), null)).toMatchObject({ level: 'available', security: false })
  })

  it('nothing when the version is unknown, the agent is current, or no release is known', () => {
    expect(noticeFor(seen, at(null), null)).toBeNull()
    expect(noticeFor(seen, null, null)).toBeNull()
    expect(noticeFor(seen, at('0.3.0'), null)).toBeNull()
    expect(noticeFor(seen, at('0.4.0'), null)).toBeNull()
    expect(noticeFor(NOTHING_SEEN, at('0.0.1'), null)).toBeNull()
  })

  it('a kept minimum still names a version when no release was heard this time, and never a version below it', () => {
    expect(noticeFor({ latest: null, minSafe: '0.2.0', security: null }, at('0.1.0'), null)).toMatchObject({ level: 'must', latest: '0.2.0' })
    // Only an older release heard this time: update to the minimum, not to the older release.
    const older = seenOf(release('0.1.5'))
    expect(noticeFor({ ...older, minSafe: '0.2.0' }, at('0.1.0'), null)).toMatchObject({ level: 'must', latest: '0.2.0' })
    expect(noticeFor({ ...older, minSafe: '0.2.0' }, at('0.1.5'), null)).toMatchObject({ level: 'must', latest: '0.2.0' })
  })

  it("I'VE UPDATED hides it until a newer event still runs an old version, then it is back with that version", () => {
    const d: Dismissal = { agent: AGENT, target: '0.3.0', level: 'must', from: '0.1.0', at: NOW }
    expect(noticeFor(seen, at('0.1.0', NOW - 100), d)).toBeNull()
    expect(noticeFor(seen, at('0.1.0', NOW + 60), d)).toMatchObject({ level: 'must', stillOn: '0.1.0' })
    // Updated, but only part way: still behind, still said.
    expect(noticeFor(seen, at('0.2.0', NOW + 60), d)).toMatchObject({ level: 'available', stillOn: '0.2.0' })
    expect(noticeFor(seen, at('0.3.0', NOW + 60), d)).toBeNull()
  })

  it('a dismissal of an older latest, or of a calmer notice, does not hide a newer or louder one', () => {
    const older: Dismissal = { agent: AGENT, target: '0.2.5', level: 'must', from: '0.1.0', at: NOW }
    expect(noticeFor(seen, at('0.1.0'), older)).toMatchObject({ level: 'must', stillOn: null })
    const calm: Dismissal = { agent: AGENT, target: '0.3.0', level: 'available', from: '0.1.0', at: NOW }
    expect(noticeFor(seen, at('0.1.0'), calm)).toMatchObject({ level: 'must', stillOn: null })
  })

  it('the update commands are the README\'s, pinned to the latest version', () => {
    const steps = updateSteps('0.3.0')
    expect(steps.map((s) => s.command)).toEqual([
      'git pull && npm ci --omit=dev --ignore-scripts',
      'npm i -g github:arkin0x/cyberspace-mcp#v0.3.0',
      'npx github:arkin0x/cyberspace-mcp serve',
      null,
    ])
    expect(steps[3]).toMatchObject({ label: 'From a release bundle', words: expect.stringMatching(/check its signature/) })
  })
})
