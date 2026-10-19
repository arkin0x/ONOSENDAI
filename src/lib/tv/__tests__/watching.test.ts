/**
 * watching.test.ts: the count of sets on now. A ping counts for SEEN_FOR_MS,
 * the set itself always counts, and a stale, future or other-kind event never does.
 */
import { describe, expect, it } from 'vitest'
import { MAX_HEARD, SEEN_FOR_MS, SKEW_S, WATCHING_KIND, Watchers, pingTemplate, watchingWords } from '../watching'

const ping = (pubkey: string, atMs: number) => ({ kind: WATCHING_KIND, pubkey, created_at: Math.floor(atMs / 1000) })

describe('who is watching', () => {
  it('is this set alone before anyone else is heard', () => {
    expect(new Watchers().count(1_000_000, 'me')).toBe(1)
  })

  it('counts each key heard lately once, this set among them', () => {
    const w = new Watchers()
    const t = 1_000_000_000
    expect(w.hear(ping('a', t), t)).toBe(true)
    w.hear(ping('b', t), t)
    w.hear(ping('a', t + 30_000), t + 30_000)
    // Its own ping, come back from the relay, is not counted twice.
    w.hear(ping('me', t), t)
    expect(w.count(t + 30_000, 'me')).toBe(3)
  })

  it('lets a key go SEEN_FOR_MS after its last ping', () => {
    const w = new Watchers()
    const t = 1_000_000_000
    w.hear(ping('a', t), t)
    w.hear(ping('b', t + 60_000), t + 60_000)
    expect(w.count(t + SEEN_FOR_MS, 'me')).toBe(3)
    expect(w.count(t + SEEN_FOR_MS + 1, 'me')).toBe(2)
    expect(w.count(t + 60_000 + SEEN_FOR_MS + 1, 'me')).toBe(1)
  })

  it('does not count a ping dated far from now, or another kind', () => {
    const w = new Watchers()
    const t = 1_000_000_000
    expect(w.hear(ping('old', t - (SKEW_S + 5) * 1000), t)).toBe(false)
    expect(w.hear(ping('ahead', t + (SKEW_S + 5) * 1000), t)).toBe(false)
    expect(w.hear({ kind: 23330, pubkey: 'chat', created_at: t / 1000 }, t)).toBe(false)
    expect(w.count(t, 'me')).toBe(1)
  })

  it('remembers MAX_HEARD keys at most, the oldest let go first', () => {
    const w = new Watchers()
    const t = 1_000_000_000
    for (let i = 0; i <= MAX_HEARD; i++) w.hear(ping(`k${i}`, t), t)
    expect(w.count(t, null)).toBe(MAX_HEARD)
    // k0 went: a fresh ping from it counts again, k1 goes in its place.
    w.hear(ping('k0', t), t)
    expect(w.count(t, null)).toBe(MAX_HEARD)
  })

  it('pings with no content, the kind and a t tag, dated now', () => {
    expect(pingTemplate(1234)).toEqual({ kind: 23334, created_at: 1234, tags: [['t', 'cyberspace-tv']], content: '' })
    expect(WATCHING_KIND).toBeGreaterThanOrEqual(20000)
    expect(WATCHING_KIND).toBeLessThan(30000)
  })

  it('says how many in the TV\'s words', () => {
    expect(watchingWords(1)).toBe('1 WATCHING')
    expect(watchingWords(1204)).toBe('1,204 WATCHING')
  })
})
