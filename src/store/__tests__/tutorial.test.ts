/**
 * tutorial.test.ts - the first-arrival tutorial's switch and engine
 * (first-arrival tutorial design, 2026-11-10, T1 and T3):
 *
 * - off unless this device's switch is on, and ?tutorial=1 / =0 set it;
 * - shown only to a brand-new identity on the bare address, after its relay
 *   check has an answer;
 * - progress kept per player pubkey: a reload resumes, an ended run stays
 *   ended, RESTART begins again;
 * - the publishing switch is never touched (the player's moves are real);
 * - a step's own wait counts, and the next step comes up by itself.
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

// Whether the key on screen was made on this page load: the test says (by default not, so the relay check decides).
const minted = vi.hoisted(() => ({ onLoad: false }))
vi.mock('../useCyberspace', async (orig) => {
  const real = await orig<typeof import('../useCyberspace')>()
  return { ...real, keyMintedOnLoad: () => (minted.onLoad ? real.useCyberspace.getState().identity.pubkey : null) }
})

import { MINTED_KEY, useCyberspace } from '../useCyberspace'
import { ADVANCE_MS, isNewArrival, registerTutorialWatcher, useTutorial, watchFirstArrival } from '../useTutorial'
import { useDemo } from '../useDemo'
import { PROGRESS_PREFIX, TUTORIAL_SWITCH_KEY, applyTutorialFlag, readProgress, tutorialEnabled, tutorialSwitch, writeProgress } from '../../tutorial/gate'
import { TUTORIAL_SCRIPT } from '../../tutorial/script'
import type { TutorialScript } from '../../tutorial/types'

const pubkey = (): string => useCyberspace.getState().identity.pubkey
const g = globalThis as { window?: unknown }
let hadWindow: unknown

/** The bare address, as a first arrival lands on it. */
function atAddress(pathname: string): void {
  g.window = { location: { pathname, search: '', hash: '' }, history: { state: null, replaceState: () => {} } }
}

beforeEach(() => {
  hadWindow = g.window
  atAddress('/')
  minted.onLoad = false
  if (useTutorial.getState().active) useTutorial.getState().pause()
  useTutorial.setState({ script: TUTORIAL_SCRIPT })
  localStorage.removeItem(TUTORIAL_SWITCH_KEY)
  localStorage.removeItem(PROGRESS_PREFIX + pubkey())
  // A key this app made on this device, with no chain, and the relays found none.
  localStorage.setItem(MINTED_KEY, pubkey())
  useCyberspace.setState({ events: [], signerKind: 'local', selfCheck: { pubkey: pubkey(), status: 'none' } })
})
afterEach(() => {
  if (useTutorial.getState().active) useTutorial.getState().pause()
  if (useDemo.getState().active) useDemo.getState().exit()
  g.window = hadWindow
  vi.useRealTimers()
})

describe('the device switch (off in production)', () => {
  it('is off and unshown until set', () => {
    expect(tutorialSwitch()).toBe(null)
    expect(tutorialEnabled()).toBe(false)
  })

  it('?tutorial=1 turns it on and ?tutorial=0 off, and the flag leaves the address', () => {
    const replaced: string[] = []
    const history = { state: null, replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { replaced.push(String(url)) } }
    expect(applyTutorialFlag({ pathname: '/', search: '?tutorial=1&x=2', hash: '#h' }, history)).toBe(true)
    expect(tutorialEnabled()).toBe(true)
    expect(replaced.pop()).toBe('/?x=2#h')
    expect(applyTutorialFlag({ pathname: '/', search: '?tutorial=0', hash: '' }, history)).toBe(false)
    expect(tutorialSwitch()).toBe(false)
    expect(replaced.pop()).toBe('/')
    // No flag: nothing set, the address left alone.
    expect(applyTutorialFlag({ pathname: '/', search: '?x=1', hash: '' }, history)).toBe(null)
    expect(replaced).toEqual([])
  })
})

describe('first arrival', () => {
  it('starts nothing with the switch off, even for a brand-new identity', () => {
    expect(isNewArrival()).toBe(true)
    const stop = watchFirstArrival()
    expect(useTutorial.getState().active).toBe(false)
    stop()
  })

  it('starts at the welcome for a brand-new identity on the bare address', () => {
    localStorage.setItem(TUTORIAL_SWITCH_KEY, 'on')
    const stop = watchFirstArrival()
    const t = useTutorial.getState()
    expect(t.active).toBe(true)
    expect(t.script.steps[t.index].id).toBe('welcome')
    expect(readProgress(pubkey())).toEqual({ step: 'welcome' })
    stop()
  })

  it('a key made on this page load is new at once, whatever the relays have yet to say', () => {
    localStorage.setItem(TUTORIAL_SWITCH_KEY, 'on')
    minted.onLoad = true
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'checking' } })
    const stop = watchFirstArrival()
    expect(useTutorial.getState().active).toBe(true)
    stop()
  })

  it('waits for the relay check before judging a key made on an earlier load', () => {
    localStorage.setItem(TUTORIAL_SWITCH_KEY, 'on')
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'checking' } })
    const stop = watchFirstArrival()
    expect(useTutorial.getState().active).toBe(false)
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'none' } })
    expect(useTutorial.getState().active).toBe(true)
    stop()
  })

  it('is not for an identity with a chain, an imported key, another address, or under the tour', () => {
    localStorage.setItem(TUTORIAL_SWITCH_KEY, 'on')
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'found' } })
    // The relays found a chain the device has not loaded yet: not new.
    expect(isNewArrival()).toBe(false)
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'none' }, signerKind: 'nip07' })
    expect(isNewArrival()).toBe(false)
    useCyberspace.setState({ signerKind: 'local' })
    atAddress('/demo')
    let stop = watchFirstArrival()
    expect(useTutorial.getState().active).toBe(false)
    stop()
    atAddress('/workshop')
    stop = watchFirstArrival()
    expect(useTutorial.getState().active).toBe(false)
    stop()
  })

  it('resumes a run left unfinished at its step, and never one that ended', () => {
    localStorage.setItem(TUTORIAL_SWITCH_KEY, 'on')
    const script: TutorialScript = { steps: [{ id: 'a', title: 'A', caption: 'a' }, { id: 'b', title: 'B', caption: 'b' }] }
    useTutorial.setState({ script })
    writeProgress(pubkey(), { step: 'b' })
    // A chain since then (they moved): resumed anyway, it is theirs.
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'found' } })
    let stop = watchFirstArrival()
    expect(useTutorial.getState().active).toBe(true)
    expect(useTutorial.getState().index).toBe(1)
    stop()
    useTutorial.getState().end('skipped')
    expect(readProgress(pubkey())).toEqual({ step: 'b', ended: 'skipped' })
    stop = watchFirstArrival()
    expect(useTutorial.getState().active).toBe(false)
    stop()
  })
})

describe('the engine', () => {
  it('never touches the publishing switch: the player is LIVE as before, and stays so', () => {
    useCyberspace.getState().setLive(true)
    useTutorial.getState().start()
    expect(useCyberspace.getState().live).toBe(true)
    useTutorial.getState().next() // FIND IT on the welcome, the last step in this slice
    expect(useTutorial.getState().active).toBe(false)
    expect(readProgress(pubkey())?.ended).toBe('finished')
    expect(useCyberspace.getState().live).toBe(true)
  })

  it('RESTART begins again from the first step for any identity, and pause keeps the step', () => {
    writeProgress(pubkey(), { step: 'welcome', ended: 'finished' })
    useTutorial.getState().start({ restart: true })
    expect(useTutorial.getState().active).toBe(true)
    expect(readProgress(pubkey())).toEqual({ step: 'welcome' })
    useTutorial.getState().pause()
    expect(useTutorial.getState().active).toBe(false)
    expect(readProgress(pubkey())).toEqual({ step: 'welcome' })
  })

  it('a step\'s own wait counts, and the next step comes up by itself; SKIP goes on without it; a gate holds', () => {
    vi.useFakeTimers()
    let fire: (() => void) | null = null
    registerTutorialWatcher('test-wait' as never, (onDone) => { fire = onDone; return () => { fire = null } })
    const script: TutorialScript = { steps: [
      { id: 'w', title: 'W', caption: 'w', wait: 'test-wait' as never },
      { id: 'g', title: 'G', caption: 'g', wait: 'test-wait' as never, gate: true },
      { id: 'z', title: 'Z', caption: 'z' },
    ] }
    useTutorial.setState({ script })
    useTutorial.getState().start()
    expect(useTutorial.getState().done).toBe(false)
    fire!()
    expect(useTutorial.getState().done).toBe(true)
    expect(useTutorial.getState().index).toBe(0)
    vi.advanceTimersByTime(ADVANCE_MS)
    expect(useTutorial.getState().index).toBe(1)
    // A gate: NEXT does nothing until the wait has happened.
    useTutorial.getState().next()
    expect(useTutorial.getState().index).toBe(1)
    fire!()
    vi.advanceTimersByTime(ADVANCE_MS)
    expect(useTutorial.getState().index).toBe(2)
    expect(readProgress(pubkey())).toEqual({ step: 'z' })
  })

  it('goes away for another identity and for the /demo tour, keeping progress', () => {
    localStorage.setItem(TUTORIAL_SWITCH_KEY, 'on')
    const stop = watchFirstArrival()
    expect(useTutorial.getState().active).toBe(true)
    useDemo.getState().start()
    expect(useTutorial.getState().active).toBe(false)
    expect(readProgress(pubkey())).toEqual({ step: 'welcome' })
    stop()
  })
})
