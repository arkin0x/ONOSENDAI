/**
 * noBroadcastTag.test.ts - the no-broadcast tag (spec §8.13) on what this
 * client signs: while the first-arrival tutorial runs for the identity on
 * screen, every public Cyberspace event carries `["no-broadcast"]`; never a
 * sealed entry, an item, a list, a DM, an auth or a mined template; and once
 * the run is finished, skipped or paused, nothing new carries it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

import { useCyberspace } from '../useCyberspace'
import { useTutorial } from '../useTutorial'
import { TUTORIAL_SCRIPT } from '../../tutorial/script'
import { PROGRESS_PREFIX } from '../../tutorial/gate'
import { NO_BROADCAST, TAGGED_KINDS, holdBroadcastWhile, noBroadcast, withNoBroadcast } from '../../lib/noBroadcast'
import { signedBytes } from '../../lib/bagSize'
import type { EventTemplate } from '../../lib/events'

const pubkey = (): string => useCyberspace.getState().identity.pubkey
const template = (kind: number, tags: string[][] = []): EventTemplate => ({ kind, created_at: 1_790_000_000, tags, content: '' })
const sign = (t: EventTemplate) => useCyberspace.getState().signEvent(t)
const tagCount = (e: { tags: string[][] }): number => e.tags.filter((t) => t[0] === NO_BROADCAST).length

/** The public Cyberspace events a tutorial run signs: a move, a bag, a public object, a listing, a comment, a reaction. */
const PUBLIC = [
  template(3333, [['A', 'hop']]),
  template(33330, [['d', 'lookup'], ['encrypted', 'aes-256-gcm', 'x', 'cyberspace:region']]),
  template(33331, [['d', 'tower']]),
  template(33340, [['d', 'item']]),
  template(1111, [['K', '3333']]),
  template(7, [['k', '3333']]),
]

/** What never carries it: a sealed entry, items inside a bag, a hidden object, an avatar (TV draws the newest; review), lists, a profile, DM parts, auths, a deletion, a chat envelope, a DNA, a tend. */
const NEVER = [
  template(33335, [['d', 'r'], ['encrypted', 'aes-256-gcm', 'x', 'cyberspace:region']]),
  template(3330), template(1), template(3340), template(3341), template(1063), template(3351),
  template(33331, [['d', 'hidden'], ['encrypted', 'aes-256-gcm', 'x', 'cyberspace:region']]),
  template(11333), template(0), template(3), template(10000), template(10002), template(10050), template(10063),
  template(13), template(1059), template(14),
  template(22242), template(24242), template(27235),
  template(5, [['k', '33331']]), template(23330), template(3350), template(3352),
]

/** A run going, as a first arrival's: the first step only, so NEXT finishes it. */
function startRun(): void {
  useTutorial.setState({ script: { steps: [TUTORIAL_SCRIPT.steps[0]] } })
  useTutorial.getState().start()
  expect(useTutorial.getState().active).toBe(true)
}

beforeEach(() => {
  localStorage.removeItem(PROGRESS_PREFIX + pubkey())
  useCyberspace.setState({ events: [], signerKind: 'local' })
})
afterEach(() => {
  if (useTutorial.getState().active) useTutorial.getState().pause()
  useTutorial.setState({ script: TUTORIAL_SCRIPT })
})

describe('withNoBroadcast (lib/noBroadcast)', () => {
  it('tags nothing while nothing holds broadcast', () => {
    for (const t of PUBLIC) expect(withNoBroadcast(t)).toBe(t)
  })

  it('while held: every public Cyberspace kind, once; never the rest; never a mined template', () => {
    const off = holdBroadcastWhile(() => true)
    try {
      for (const t of PUBLIC) {
        const out = withNoBroadcast(t)
        expect(out.tags.at(-1), `kind ${t.kind}`).toEqual([NO_BROADCAST])
        expect(tagCount(out)).toBe(1)
        // Already tagged: not again.
        expect(withNoBroadcast(out)).toBe(out)
        // What it was given is left as it was.
        expect(noBroadcast(t)).toBe(false)
      }
      for (const t of NEVER) expect(withNoBroadcast(t), `kind ${t.kind}`).toBe(t)
      // A template already mined (NIP-13): a tag added now would void the work.
      const mined = template(3333, [['A', 'hop'], ['nonce', '12', '8']])
      expect(withNoBroadcast(mined)).toBe(mined)
      expect([...TAGGED_KINDS].sort()).toEqual([1111, 3333, 33330, 33331, 33340, 7].sort())
    } finally { off() }
    expect(withNoBroadcast(PUBLIC[0])).toBe(PUBLIC[0])
  })

  it('a bag is measured with the tag it will be signed with (lib/bagSize)', () => {
    const bag = PUBLIC[1]
    const plain = signedBytes(bag)
    const off = holdBroadcastWhile(() => true)
    try { expect(signedBytes(bag)).toBe(plain + JSON.stringify([NO_BROADCAST]).length + 1) } finally { off() }
  })

  it('reads any tag named no-broadcast, whatever else it carries', () => {
    expect(noBroadcast({ tags: [['no-broadcast', 'tv']] })).toBe(true)
    expect(noBroadcast({ tags: [['no-broadcast'], ['no-broadcast']] })).toBe(true)
    expect(noBroadcast({ tags: [['nobroadcast'], ['t', 'no-broadcast']] })).toBe(false)
  })
})

describe('the store signs with it while the tutorial runs (store signEvent)', () => {
  it('no run: nothing is tagged', async () => {
    for (const t of PUBLIC) expect(noBroadcast(await sign(t))).toBe(false)
  })

  it('a run going: every public event is tagged, nothing else is', async () => {
    startRun()
    for (const t of PUBLIC) {
      const signed = await sign(t)
      expect(tagCount(signed), `kind ${t.kind}`).toBe(1)
      expect(signed.pubkey).toBe(pubkey())
    }
    for (const t of NEVER) expect(noBroadcast(await sign(t)), `kind ${t.kind}`).toBe(false)
  })

  it('stops with the run: finished, skipped or paused; an event signed during it keeps its tag', async () => {
    startRun()
    const during = await sign(PUBLIC[0])
    useTutorial.getState().next() // the last step's NEXT: finished
    expect(useTutorial.getState().active).toBe(false)
    expect(noBroadcast(await sign(PUBLIC[0]))).toBe(false)
    expect(noBroadcast(during)).toBe(true)

    localStorage.removeItem(PROGRESS_PREFIX + pubkey())
    startRun()
    expect(noBroadcast(await sign(PUBLIC[1]))).toBe(true)
    useTutorial.getState().end('skipped')
    expect(noBroadcast(await sign(PUBLIC[1]))).toBe(false)

    startRun()
    expect(noBroadcast(await sign(PUBLIC[2]))).toBe(true)
    useTutorial.getState().pause()
    expect(noBroadcast(await sign(PUBLIC[2]))).toBe(false)
  })

  it('a run is its player\'s only: another identity on screen signs untagged', async () => {
    startRun()
    useTutorial.setState({ pubkey: 'f'.repeat(64) })
    expect(noBroadcast(await sign(PUBLIC[0]))).toBe(false)
  })

  it('a minimized run is still a run: its events stay tagged', async () => {
    startRun()
    useTutorial.getState().setMinimized(true)
    expect(noBroadcast(await sign(PUBLIC[0]))).toBe(true)
  })
})
