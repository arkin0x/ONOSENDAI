/**
 * A tap on someone's avatar opens their card: COPY TO WORKSHOP only when the
 * avatar is a shard, and the copy credits its author (arkinox, 2026-10-11).
 */
import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const xor = 'a'.repeat(64)
const operator = 'c'.repeat(64)
const plain = 'b'.repeat(64)
localStorage.setItem('onosendai:profiles', JSON.stringify({
  [xor]: { pubkey: xor, name: 'XOR', picture: null, about: null, nip05: null, at: 1, bot: true, operator },
  [operator]: { pubkey: operator, name: 'arkinox', picture: null, about: null, nip05: null, at: 1 },
  [plain]: { pubkey: plain, name: 'Case', picture: null, about: null, nip05: null, at: 1 },
}))

import { renderToStaticMarkup } from 'react-dom/server'
import { newShard, type ShardModel } from 'sno-core/shards'
// Loaded after the cache is seeded: a static import is hoisted above it.
const { creditOf, useWorkshop } = await import('../../store/useWorkshop')
const { parseProfile } = await import('../../store/useProfiles')
const { PersonCard } = await import('../PersonModal')
const { avatarCredit, copyAvatarToWorkshop } = await import('../../store/usePersonCard')

function octangula(): ShardModel {
  const s = newShard('xor')
  s.name = 'Stella Octangula'
  s.vertices = [{ p: [0, 0, 0], c: [0, 0.9, 1] }, { p: [1, 0, 0], c: [0, 0.9, 1] }, { p: [0, 1, 0], c: [0, 0.9, 1] }]
  s.faces = [[0, 1, 2]]
  s.mode = 'solid'
  return { ...s, id: `avatar:${xor}` }
}

const Stub = ({ shard }: { shard: ShardModel }): JSX.Element => <i className="stub-preview">{shard.name}</i>
const close = (): void => {}

describe('the card a tap on an avatar opens', () => {
  it('shows the preview and COPY TO WORKSHOP for a shard avatar, with the agent badge and its operator', () => {
    const html = renderToStaticMarkup(<PersonCard pubkey={xor} shard={octangula()} onClose={close} Preview={Stub} />)
    expect(html).toContain('COPY TO WORKSHOP')
    expect(html).toContain('stub-preview')
    expect(html).toContain('Stella Octangula')
    expect(html).toContain('AGENT')
    expect(html).toContain('arkinox')
    expect(html).toContain('npub1')
    expect(html).toContain('SPECTATE')
  })

  it('shows the profile without COPY for a default avatar', () => {
    const html = renderToStaticMarkup(<PersonCard pubkey={plain} shard={null} onClose={close} Preview={Stub} />)
    expect(html).toContain('Case')
    expect(html).not.toContain('COPY TO WORKSHOP')
    expect(html).not.toContain('stub-preview')
    expect(html).not.toContain('AGENT')
    expect(html).toContain('TARGET')
  })
})

describe('copying an avatar', () => {
  beforeEach(() => { useWorkshop.setState({ shards: [] }) })

  it('imports the shard into the workshop as a new model credited to its author', () => {
    const shard = octangula()
    const id = copyAvatarToWorkshop(shard, xor, plain)
    const copy = useWorkshop.getState().shards.find((s) => s.id === id)!
    expect(copy).toBeTruthy()
    expect(id).not.toBe(shard.id)
    expect(copy.name).toBe('Stella Octangula')
    expect(copy.vertices).toHaveLength(3)
    expect(creditOf(copy)).toEqual(avatarCredit(xor))
    expect(creditOf(copy)?.address).toBe(`11333:${xor}:`)
  })

  it('copies your own avatar uncredited', () => {
    const id = copyAvatarToWorkshop(octangula(), xor, xor)
    expect(creditOf(useWorkshop.getState().shards.find((s) => s.id === id)!)).toBeUndefined()
  })
})

describe('a bot profile names its operator', () => {
  it('reads the p tag marked operator, only on a bot', () => {
    const ev = { id: 'e', pubkey: xor, kind: 0, created_at: 1, sig: '', content: JSON.stringify({ name: 'XOR', bot: true }), tags: [['p', operator, '', 'operator']] }
    expect(parseProfile(ev)?.operator).toBe(operator)
    expect(parseProfile({ ...ev, content: JSON.stringify({ name: 'XOR' }) })?.operator).toBeUndefined()
    expect(parseProfile({ ...ev, tags: [['p', operator]] })?.operator).toBeUndefined()
  })
})
