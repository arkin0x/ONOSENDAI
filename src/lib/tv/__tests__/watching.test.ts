/**
 * watching.test.ts: the count of sets on now. A ping counts for SEEN_FOR_MS,
 * the set itself always counts, and a stale, future, other-kind or untagged
 * event never does.
 */
import { describe, expect, it } from 'vitest'
import { MAX_HEARD, SEEN_FOR_MS, SKEW_S, WATCHING_KIND, Watchers, pingTemplate, watchingWords } from '../watching'

const NOW_S = 1_792_400_000
const ping = (pubkey: string, createdS = NOW_S) => ({ kind: WATCHING_KIND, pubkey, created_at: createdS, tags: [['t', 'cyberspace-tv']] })

describe('who is watching', () => {
  it('is this set alone before anyone else is heard', () => {
    expect(new Watchers().count(1_000, 'me')).toBe(1)
  })

  it('counts each key heard lately once, this set among them', () => {
    const w = new Watchers()
    expect(w.hear(ping('a'), 0, NOW_S)).toBe(true)
    w.hear(ping('b'), 0, NOW_S)
    w.hear(ping('a'), 30_000, NOW_S + 30)
    // Its own ping, come back from the relay, is not counted twice.
    w.hear(ping('me'), 0, NOW_S)
    expect(w.count(30_000, 'me')).toBe(3)
  })

  it('lets a key go SEEN_FOR_MS after its last ping', () => {
    const w = new Watchers()
    w.hear(ping('a'), 0, NOW_S)
    w.hear(ping('b'), 60_000, NOW_S + 60)
    expect(w.count(SEEN_FOR_MS, 'me')).toBe(3)
    expect(w.count(SEEN_FOR_MS + 1, 'me')).toBe(2)
    expect(w.count(60_000 + SEEN_FOR_MS + 1, 'me')).toBe(1)
  })

  it('times arrivals on the clock that only goes forward, so a wall clock set back over-counts nothing', () => {
    // The wall clock jumps back an hour between the two pings; arrival order stays true.
    const w = new Watchers()
    w.hear(ping('a', NOW_S), 0, NOW_S)
    w.hear(ping('b', NOW_S - 3600), 50_000, NOW_S - 3600)
    expect(w.count(SEEN_FOR_MS + 1, null)).toBe(1)
  })

  it('does not count a ping dated far from now, another kind, or one without the TV\'s tag', () => {
    const w = new Watchers()
    expect(w.hear(ping('old', NOW_S - SKEW_S - 5), 0, NOW_S)).toBe(false)
    expect(w.hear(ping('ahead', NOW_S + SKEW_S + 5), 0, NOW_S)).toBe(false)
    expect(w.hear({ ...ping('chat'), kind: 23330 }, 0, NOW_S)).toBe(false)
    expect(w.hear({ ...ping('other app'), tags: [] }, 0, NOW_S)).toBe(false)
    expect(w.hear({ ...ping('other tag'), tags: [['t', 'something-else']] }, 0, NOW_S)).toBe(false)
    expect(w.count(0, 'me')).toBe(1)
  })

  it('remembers MAX_HEARD keys at most, the least lately heard let go first', () => {
    const w = new Watchers()
    for (let i = 0; i <= MAX_HEARD; i++) w.hear(ping(`k${i}`), i, NOW_S)
    expect(w.count(MAX_HEARD, null)).toBe(MAX_HEARD)
    // k0 went. k1 heard again moves to the back, so the next one in pushes k2 out, not k1.
    w.hear(ping('k1'), MAX_HEARD + 1, NOW_S)
    w.hear(ping('new'), MAX_HEARD + 2, NOW_S)
    // Counting as k1 adds no one when k1 is among those kept; as k2, one.
    expect(w.count(MAX_HEARD + 2, 'k1')).toBe(MAX_HEARD)
    expect(w.count(MAX_HEARD + 2, 'k2')).toBe(MAX_HEARD + 1)
  })

  it('pings with no content, the kind and the TV\'s t tag, dated now', () => {
    expect(pingTemplate(1234)).toEqual({ kind: 23334, created_at: 1234, tags: [['t', 'cyberspace-tv']], content: '' })
    expect(WATCHING_KIND).toBeGreaterThanOrEqual(20000)
    expect(WATCHING_KIND).toBeLessThan(30000)
  })

  it('says how many in the TV\'s words', () => {
    expect(watchingWords(1)).toBe('1 WATCHING')
    expect(watchingWords(1204)).toBe('1,204 WATCHING')
  })
})
