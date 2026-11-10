/**
 * blossomChoice.test.ts: a server someone types sticks (owner 2026-11-10: "If
 * anyone adds any server manually, it should stick."). The owner typed
 * http://blossom.oslim.dev, a server he pays for, to upload audio; the next
 * upload offered it nowhere and started on blossom.band.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_BLOSSOM_SERVERS } from '../blossom'
import {
  LEGACY_SERVER_KEY, MAX_TYPED, choiceKey, initialServer, readChoice, rememberServer, serverAfterList, serverOptions,
} from '../blossomChoice'

const PK = 'ab'.repeat(32)
const OTHER = 'cd'.repeat(32)
const OSLIM = 'https://blossom.oslim.dev'

function memory(seed: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(seed))
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k) },
    setItem: (k, v) => { m.set(k, String(v)) },
  }
}

describe('remembering a typed server', () => {
  it('keeps it, normalized from http, as the last used and one of your own', () => {
    const st = memory()
    rememberServer(PK, 'http://blossom.oslim.dev/', st)
    expect(readChoice(PK, st)).toEqual({ last: OSLIM, typed: [OSLIM] })
  })

  it('a server from your kind 10063 is the last used, but not added to your typed ones', () => {
    const st = memory()
    rememberServer(PK, OSLIM, st)
    rememberServer(PK, 'https://list1.example', st, true)
    expect(readChoice(PK, st)).toEqual({ last: 'https://list1.example', typed: [OSLIM] })
  })

  it('puts the most recent first, each once, at most MAX_TYPED', () => {
    const st = memory()
    for (let i = 0; i < MAX_TYPED + 3; i++) rememberServer(PK, `https://s${i}.example`, st)
    rememberServer(PK, 'https://s5.example', st)
    const { typed } = readChoice(PK, st)
    expect(typed).toHaveLength(MAX_TYPED)
    expect(typed[0]).toBe('https://s5.example')
    expect(typed[1]).toBe(`https://s${MAX_TYPED + 2}.example`)
    expect(new Set(typed).size).toBe(typed.length)
  })

  it('a default used is the last used, but not one of your own, and your typed ones stay', () => {
    const st = memory()
    rememberServer(PK, OSLIM, st)
    rememberServer(PK, DEFAULT_BLOSSOM_SERVERS[1], st)
    expect(readChoice(PK, st)).toEqual({ last: DEFAULT_BLOSSOM_SERVERS[1], typed: [OSLIM] })
  })

  it('is kept per key', () => {
    const st = memory()
    rememberServer(PK, OSLIM, st)
    expect(readChoice(OTHER, st)).toEqual({ last: null, typed: [] })
  })

  it('ignores something that is not a server', () => {
    const st = memory()
    expect(rememberServer(PK, 'not a server', st)).toEqual({ last: null, typed: [] })
    expect(st.getItem(choiceKey(PK))).toBeNull()
  })

  it('survives storage that throws', () => {
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(readChoice(PK, broken)).toEqual({ last: null, typed: [] })
    expect(() => rememberServer(PK, OSLIM, broken)).not.toThrow()
  })

  it('reads a damaged record as nothing kept, dropping what is not a server', () => {
    expect(readChoice(PK, memory({ [choiceKey(PK)]: '{nope' }))).toEqual({ last: null, typed: [] })
    const st = memory({ [choiceKey(PK)]: JSON.stringify({ last: 7, typed: ['x y', OSLIM, OSLIM, DEFAULT_BLOSSOM_SERVERS[0], 3] }) })
    expect(readChoice(PK, st)).toEqual({ last: null, typed: [OSLIM] })
  })
})

describe('migration from the one server kept before', () => {
  it('reads the old key as the last used and, when not a default, one of your own', () => {
    const st = memory({ [LEGACY_SERVER_KEY]: 'http://blossom.oslim.dev' })
    expect(readChoice(PK, st)).toEqual({ last: OSLIM, typed: [OSLIM] })
    expect(readChoice(OTHER, st)).toEqual({ last: OSLIM, typed: [OSLIM] })
  })

  it('an old default is only the last used', () => {
    const st = memory({ [LEGACY_SERVER_KEY]: DEFAULT_BLOSSOM_SERVERS[2] })
    expect(readChoice(PK, st)).toEqual({ last: DEFAULT_BLOSSOM_SERVERS[2], typed: [] })
  })

  it('carries the old server into the first record written, and leaves the old key alone', () => {
    const st = memory({ [LEGACY_SERVER_KEY]: OSLIM })
    rememberServer(PK, 'https://mine.example', st)
    expect(readChoice(PK, st)).toEqual({ last: 'https://mine.example', typed: ['https://mine.example', OSLIM] })
    expect(st.getItem(LEGACY_SERVER_KEY)).toBe(OSLIM)
  })

  it('a key with a record of its own no longer reads the old one', () => {
    const st = memory({ [LEGACY_SERVER_KEY]: OSLIM, [choiceKey(PK)]: JSON.stringify({ last: null, typed: [] }) })
    expect(readChoice(PK, st)).toEqual({ last: null, typed: [] })
  })
})

describe('the options', () => {
  const mine = ['https://list1.example', OSLIM, 'https://list2.example']

  it('go last used, typed, your kind 10063, then the defaults, each once', () => {
    const stored = { last: 'https://typed2.example', typed: ['https://typed2.example', 'https://typed1.example', OSLIM] }
    expect(serverOptions(stored, mine)).toEqual([
      'https://typed2.example', 'https://typed1.example', OSLIM, 'https://list1.example', 'https://list2.example', ...DEFAULT_BLOSSOM_SERVERS,
    ])
  })

  it('a default used last comes first and is not repeated', () => {
    const stored = { last: DEFAULT_BLOSSOM_SERVERS[2], typed: [OSLIM] }
    expect(serverOptions(stored, [])).toEqual([DEFAULT_BLOSSOM_SERVERS[2], OSLIM, ...DEFAULT_BLOSSOM_SERVERS.filter((s) => s !== DEFAULT_BLOSSOM_SERVERS[2])])
  })

  it('with nothing kept and no list, the defaults alone', () => {
    expect(serverOptions({ last: null, typed: [] }, [])).toEqual(DEFAULT_BLOSSOM_SERVERS)
  })
})

describe('where the picker starts', () => {
  it('on the last server used, else the list first, else the first default', () => {
    expect(initialServer({ last: OSLIM, typed: [OSLIM] }, ['https://list1.example'])).toBe(OSLIM)
    expect(initialServer({ last: null, typed: [] }, ['https://list1.example'])).toBe('https://list1.example')
    expect(initialServer({ last: null, typed: [] }, [])).toBe(DEFAULT_BLOSSOM_SERVERS[0])
  })

  it('a kind 10063 that arrives late does not override a server this device chose', () => {
    expect(serverAfterList(OSLIM, { last: OSLIM, typed: [OSLIM] }, ['https://list1.example'], false)).toBe(OSLIM)
  })

  it('nor one the person picked while it was on its way', () => {
    expect(serverAfterList(DEFAULT_BLOSSOM_SERVERS[3], { last: null, typed: [] }, ['https://list1.example'], true)).toBe(DEFAULT_BLOSSOM_SERVERS[3])
  })

  it('with nothing chosen yet, the list first becomes the choice', () => {
    expect(serverAfterList(DEFAULT_BLOSSOM_SERVERS[0], { last: null, typed: [] }, ['https://list1.example'], false)).toBe('https://list1.example')
    expect(serverAfterList(DEFAULT_BLOSSOM_SERVERS[0], { last: null, typed: [] }, [], false)).toBe(DEFAULT_BLOSSOM_SERVERS[0])
  })
})
