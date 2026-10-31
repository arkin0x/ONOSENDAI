import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyHopLevel1 } from 'cyberspace-core'
import { activeIn, bestChainLength, chainLength, dropUnlistedV1Hops, keyChains, respawnCount, spawnsOf } from '../countingRules'
import type { NostrEvent } from '../events'
import { loadV1HopList } from '../v1HopList'
import { GRANDFATHERED_V1_HOPS as GUARD } from '../v1HopListGuard'
import raw from './vectors/unlisted-v1-hops.json'

// The real events of the two identities whose only hop failed the census 1
// audit (grandfathered-v1-hops.txt): a spawn and one h24 hop each, 2026-09-03.
const events = raw as NostrEvent[]
const KEYS = [...new Set(events.map((e) => e.pubkey))]
const hopOf = (pk: string): NostrEvent => events.find((e) => e.pubkey === pk && e.tags.some((t) => t[0] === 'A' && t[1] === 'hop'))!
const LISTED_HOP = 'a11938c376d8b53032d9a704a3db3fc1d82add779c164fe589f922889a88ab9f'

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

/** What is inside the parentheses that open at `open`, balanced. */
function callArgs(text: string, open: number): string {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i)
  }
  throw new Error('unbalanced parentheses')
}

/**
 * Every way this source could reach core's default list, which in a build and in
 * dev is the guard: a call with no `grandfathered` in its own parentheses, a
 * reference that is not a call, an alias or namespace import that this scan
 * could not follow, or the list and its reader imported directly.
 */
function guardProblems(source: string): string[] {
  const text = stripComments(source)
  const out: string[] = []
  if (/import\s*\(\s*['"]cyberspace-core['"]\s*\)/.test(text) || /import\s+\*\s+as\s+\w+\s+from\s+['"]cyberspace-core['"]/.test(text)) out.push('a namespace import of core')
  let rest = text
  for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]cyberspace-core['"]/g)) {
    rest = rest.replace(m[0], '')
    for (const raw of m[1].split(',')) {
      const name = raw.trim()
      if (name.startsWith('type ')) continue
      if (/^verifyHopLevel1\s+as\s/.test(name)) out.push('an aliased verifyHopLevel1')
      if (/^(GRANDFATHERED_V1_HOPS|isGrandfatheredV1Hop)\b/.test(name)) out.push(`imports ${name}`)
    }
  }
  for (const m of rest.matchAll(/\bverifyHopLevel1\b(\()?/g)) {
    if (!m[1]) out.push('verifyHopLevel1 used without calling it')
    else if (!/\bgrandfathered\b/.test(callArgs(rest, m.index + m[0].length - 1))) out.push('a call to verifyHopLevel1 with no list of its own')
  }
  return out
}

describe('the version 1 hop list, loaded lazily', () => {
  it('is the census, from its own chunk', async () => {
    const list = await loadV1HopList()
    expect(list.size).toBeGreaterThanOrEqual(2658)
    expect(list.has(LISTED_HOP)).toBe(true)
    for (const pk of KEYS) expect(list.has(hopOf(pk).id)).toBe(false)
    expect(await loadV1HopList()).toBe(list)
  })

  it('the guard throws when read, and never answers', () => {
    expect(() => GUARD.has(LISTED_HOP)).toThrow(/explicit `grandfathered`/)
    expect(() => GUARD.size).toThrow(/explicit `grandfathered`/)
  })

  it('every call in the app passes its own list, because in a build and in dev the default is the guard', () => {
    let calls = 0
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name !== '__tests__' && e.name !== 'fixtures') walk(path)
        } else if (/\.tsx?$/.test(e.name) && !/v1HopList(Guard)?\.ts$/.test(e.name)) {
          const text = readFileSync(path, 'utf8')
          expect(guardProblems(text), path).toEqual([])
          calls += [...stripComments(text).matchAll(/\bverifyHopLevel1\(/g)].length
        }
      }
    }
    walk('src')
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it('the scan catches every way of reaching the guard', () => {
    const IMPORT = "import { verifyHopLevel1 } from 'cyberspace-core'\n"
    const good = `${IMPORT}const x = () => verifyHopLevel1({ a: 1, grandfathered: new Set() }, { order: 'cost' })\n`
    expect(guardProblems(good)).toEqual([])
    expect(guardProblems(`${IMPORT}const grandfathered = new Set(); f(verifyHopLevel1({ a: g(1), grandfathered }))\n`)).toEqual([])
    // A bare call, above a good one, and far above it: the list must be in the call's own parentheses.
    expect(guardProblems(`${IMPORT}verifyHopLevel1(claim)\n${good.slice(IMPORT.length)}`)).toHaveLength(1)
    expect(guardProblems(`${IMPORT}function audit(c) { return verifyHopLevel1(c) }\n\n// ...\n${good.slice(IMPORT.length)}`)).toHaveLength(1)
    // The word after the call does not count, nor in a comment inside it.
    expect(guardProblems(`${IMPORT}verifyHopLevel1(claim); const y = { grandfathered: 1 }\n`)).toHaveLength(1)
    expect(guardProblems(`${IMPORT}verifyHopLevel1(claim /* grandfathered: none */)\n`)).toHaveLength(1)
    // Ways of hiding the call from the scan.
    expect(guardProblems("import { verifyHopLevel1 as check } from 'cyberspace-core'\ncheck(claim)\n")).not.toEqual([])
    expect(guardProblems("import * as core from 'cyberspace-core'\ncore.verifyHopLevel1(claim)\n")).not.toEqual([])
    expect(guardProblems(`${IMPORT}const check = verifyHopLevel1\ncheck(claim)\n`)).not.toEqual([])
    expect(guardProblems("const core = await import('cyberspace-core')\n")).not.toEqual([])
    // The other two ways to the guard itself.
    expect(guardProblems("import { GRANDFATHERED_V1_HOPS } from 'cyberspace-core'\n")).not.toEqual([])
    expect(guardProblems("import { isGrandfatheredV1Hop } from 'cyberspace-core'\n")).not.toEqual([])
  })

  // In a build, a read of core's list throws. A new core that reads it by default somewhere would stay green here,
  // since tests load core with its real list, and then refuse every local hop in production; on the cloud path that
  // failure runs clearCloudJob (store/useCyberspace), which throws away a proof already paid for. So a core bump that
  // changes these lines has to come here first.
  it("core reads its list only where it did when the guard was written, and never by default on a path this app uses", () => {
    const dist = 'node_modules/cyberspace-core/dist'
    const files = readdirSync(dist).filter((f) => f.endsWith('.js') && f !== 'grandfathered_v1_hops.js')
    expect(files.filter((f) => readFileSync(join(dist, f), 'utf8').includes('grandfathered_v1_hops.js')).sort()).toEqual(['index.js', 'residue.js'])
    expect(readFileSync(join(dist, 'index.js'), 'utf8').split('\n').filter((l) => l.includes('grandfathered_v1_hops.js')).map((l) => l.trim()))
      .toEqual(["export * from './grandfathered_v1_hops.js';"])
    const residue = stripComments(readFileSync(join(dist, 'residue.js'), 'utf8'))
    expect(residue.split('\n').filter((l) => l.includes('GRANDFATHERED_V1_HOPS')).map((l) => l.trim())).toEqual([
      "import { GRANDFATHERED_V1_HOPS } from './grandfathered_v1_hops.js';",
      'export function isGrandfatheredV1Hop(eventId, list = GRANDFATHERED_V1_HOPS) {',
      'if (isGrandfatheredV1Hop(claim.eventId, claim.grandfathered ?? GRANDFATHERED_V1_HOPS)) {',
    ])
    for (const f of files) {
      const text = stripComments(readFileSync(join(dist, f), 'utf8'))
      for (const m of text.matchAll(/\b(function )?verifyHopLevel1\(/g)) {
        if (!m[1]) expect(callArgs(text, m.index + m[0].length - 1), f).toMatch(/\bgrandfathered\b/)
      }
      for (const m of text.matchAll(/\b(function )?isGrandfatheredV1Hop\(/g)) {
        if (!m[1]) expect(callArgs(text, m.index + m[0].length - 1), f).toContain(',')
      }
    }
  })

  it('a listed hop is accepted through the real list, and not through an empty one', async () => {
    const list = await loadV1HopList()
    const claim = {
      from: { x: 1n, y: 2n, z: 3n, plane: 0 as const }, to: { x: 2n, y: 2n, z: 3n, plane: 0 as const }, previousEventIdHex: 'ab'.repeat(32),
      proof: 'cd'.repeat(32), nonce: null, openings: null, eventId: LISTED_HOP,
    }
    expect(verifyHopLevel1({ ...claim, grandfathered: list })).toEqual([])
    expect(verifyHopLevel1({ ...claim, grandfathered: new Set() })).toEqual(['form:mn', 'form:mp'])
  })
})

describe('dropUnlistedV1Hops', () => {
  it('without it, the failed hops count: the counting rules check no proof', () => {
    for (const pk of KEYS) {
      expect(chainLength(events, pk)).toBe(2)
      expect(bestChainLength(events, pk)).toBe(2)
    }
  })

  it('takes the failed hops off every chain rule, and the spawn still stands', async () => {
    const kept = dropUnlistedV1Hops(events, await loadV1HopList())
    expect(kept).toHaveLength(events.length - KEYS.length)
    for (const pk of KEYS) {
      const hop = hopOf(pk)
      expect(chainLength(kept, pk)).toBe(1)
      expect(bestChainLength(kept, pk)).toBe(1)
      expect(spawnsOf(kept, pk)).toHaveLength(1)
      expect(respawnCount(kept, pk)).toBe(0)
      // Active in the minute of the spawn, not in a window holding only the hop.
      const spawn = spawnsOf(kept, pk)[0].created_at
      expect(spawn).toBeLessThan(hop.created_at)
      expect(activeIn(events, pk, spawn, hop.created_at)).toBe(true)
      expect(activeIn(kept, pk, spawn, hop.created_at)).toBe(false)
      expect(keyChains(kept, pk).chainLength).toBe(1)
    }
  })

  it('ends a chain at the event before the hop: nothing after it counts', async () => {
    const pk = KEYS[0]
    const hop = hopOf(pk)
    const next: NostrEvent = {
      ...hop,
      id: 'ee'.repeat(32),
      created_at: hop.created_at + 1,
      tags: hop.tags.map((t) => (t[0] === 'e' && t[3] === 'previous' ? [t[0], hop.id, t[2], t[3]] : t)).concat([['mn', '00'.repeat(8)], ['mp', 'ab']]),
    }
    const kept = dropUnlistedV1Hops([...events, next], new Set())
    expect(kept.some((e) => e.id === next.id)).toBe(true) // it carries mn and mp, so this does not touch it
    expect(chainLength(kept, pk)).toBe(1)
  })

  // Taking an event away treats it as if it never existed; a signed hop still decides these two (spec 8.7.3).
  it('a fork stays dead when a branch is an unlisted hop, whichever branch is listed', async () => {
    const pk = KEYS[0]
    const hop = hopOf(pk)
    const twin = { ...hop, id: 'f0'.repeat(32), created_at: hop.created_at + 5 }
    const forked = [...events, twin]
    expect(chainLength(forked, pk)).toBe(0)
    // Both unlisted, and one listed with the other not: taking away the unlisted one would revive the chain.
    expect(chainLength(dropUnlistedV1Hops(forked, new Set(['ab'.repeat(32)])), pk)).toBe(0)
    expect(chainLength(dropUnlistedV1Hops(forked, new Set([twin.id])), pk)).toBe(0)
    expect(chainLength(dropUnlistedV1Hops(forked, new Set([hop.id])), pk)).toBe(0)
  })

  it('a newest spawn that also carries `A hop` stays, and the chain stays invalid from it', () => {
    const pk = KEYS[0]
    const spawn = events.find((e) => e.pubkey === pk && e.id !== hopOf(pk).id)!
    const newest = { ...spawn, id: 'f1'.repeat(32), created_at: hopOf(pk).created_at + 10, tags: [...spawn.tags, ['A', 'hop']] }
    const input = [...events, newest]
    expect(chainLength(input, pk)).toBe(0)
    expect(dropUnlistedV1Hops(input, new Set(['ab'.repeat(32)])).some((e) => e.id === newest.id)).toBe(true)
    expect(chainLength(dropUnlistedV1Hops(input, new Set(['ab'.repeat(32)])), pk)).toBe(0)
  })

  it('leaves everything else alone: listed hops, hops with mn or mp, spawns, other kinds and actions', () => {
    const hop = hopOf(KEYS[0])
    // Each names a previous of its own: sharing the hop's would be a fork, which keeps it.
    const after = (n: string): string[][] => hop.tags.map((t) => (t[0] === 'e' && t[3] === 'previous' ? [t[0], n.repeat(32), t[2], t[3]] : t))
    const withMn = { ...hop, id: '01'.repeat(32), tags: [...after('c1'), ['mn', '00'.repeat(8)]] }
    const withMp = { ...hop, id: '02'.repeat(32), tags: [...after('c2'), ['mp', 'ab']] }
    const other = { ...hop, id: '03'.repeat(32), kind: 1 }
    const sidestep = { ...hop, id: '04'.repeat(32), tags: after('c4').map((t) => (t[0] === 'A' ? ['A', 'sidestep'] : t)) }
    const spawn = events.find((e) => e.pubkey === KEYS[0] && e.id !== hop.id)!
    const input = [withMn, withMp, other, sidestep, spawn, hop]
    expect(dropUnlistedV1Hops(input, new Set([hop.id]))).toEqual(input)
    expect(dropUnlistedV1Hops(input, new Set())).toEqual(input.slice(0, 5))
  })
})
