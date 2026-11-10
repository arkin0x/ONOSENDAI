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
import { ADVANCE_MS, choiceOffered, isNewArrival, registerTutorialChoice, registerTutorialEffect, registerTutorialWatcher, runTutorialEffect, useTutorial, watchFirstArrival } from '../useTutorial'
import { useDemo } from '../useDemo'
import { PROGRESS_PREFIX, TUTORIAL_SWITCH_KEY, applyTutorialFlag, noteLanding, readProgress, setTutorialSwitch, tutorialEnabled, tutorialSwitch, useTutorialSwitch, writeProgress } from '../../tutorial/gate'
import { useTv } from '../useTv'
import { TUTORIAL_SCRIPT } from '../../tutorial/script'
import type { TutorialScript } from '../../tutorial/types'

const pubkey = (): string => useCyberspace.getState().identity.pubkey
const g = globalThis as { window?: unknown }
let hadWindow: unknown

/** The address the page landed on (main.tsx notes it before the first render). */
function atAddress(pathname: string): void {
  g.window = { location: { pathname, search: '', hash: '' }, history: { state: null, replaceState: () => {} } }
  noteLanding(pathname)
}
/** The switch on, as ?tutorial=1 leaves it. */
const switchOn = (): void => setTutorialSwitch(true)
/** The decision waits for the saved chain's read (savedChainLoaded): let it land. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  hadWindow = g.window
  atAddress('/')
  minted.onLoad = false
  if (useTutorial.getState().active) useTutorial.getState().pause()
  useTutorial.setState({ script: TUTORIAL_SCRIPT })
  localStorage.removeItem(TUTORIAL_SWITCH_KEY)
  useTutorialSwitch.setState({ value: null })
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
    // A value that is neither on nor off: nothing changes, and it stays on the address.
    expect(applyTutorialFlag({ pathname: '/', search: '?tutorial=yes', hash: '' }, history)).toBe(null)
    expect(tutorialSwitch()).toBe(false)
    expect(replaced).toEqual([])
    // The row reads the same switch at once.
    expect(useTutorialSwitch.getState().value).toBe(false)
  })
})

describe('first arrival', () => {
  it('starts nothing with the switch off, even for a brand-new identity', async () => {
    expect(isNewArrival()).toBe(true)
    const stop = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().active).toBe(false)
    stop()
  })

  it('starts at the welcome for a brand-new identity on the bare address', async () => {
    switchOn()
    const stop = watchFirstArrival()
    await flush()
    const t = useTutorial.getState()
    expect(t.active).toBe(true)
    expect(t.script.steps[t.index].id).toBe('welcome')
    expect(readProgress(pubkey())).toEqual({ step: 'welcome' })
    stop()
  })

  it('a key made on this page load is new at once, whatever the relays have yet to say', async () => {
    switchOn()
    minted.onLoad = true
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'checking' } })
    const stop = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().active).toBe(true)
    stop()
  })

  it('waits for the relay check before judging a key made on an earlier load, and through an answer that could not say', async () => {
    switchOn()
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'checking' } })
    const stop = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().active).toBe(false)
    // Offline: the self-sync asks again later, and the tutorial waits for it.
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'unknown', cause: { kind: 'offline' } } })
    await flush()
    expect(useTutorial.getState().active).toBe(false)
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'none' } })
    await flush()
    expect(useTutorial.getState().active).toBe(true)
    stop()
  })

  it('is not for an identity with a chain, an imported key, another address, or under the tour or TV', async () => {
    switchOn()
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'found' } })
    // The relays found a chain the device has not loaded yet: not new.
    expect(isNewArrival()).toBe(false)
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'none' }, signerKind: 'nip07' })
    expect(isNewArrival()).toBe(false)
    useCyberspace.setState({ signerKind: 'local' })
    atAddress('/demo')
    let stop = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().active).toBe(false)
    stop()
    atAddress('/workshop')
    stop = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().active).toBe(false)
    stop()
    // Landed on a /C/ link whose view put / on the address since: still not a first arrival.
    atAddress('/C/abc')
    ;(g.window as { location: { pathname: string } }).location.pathname = '/'
    stop = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().active).toBe(false)
    stop()
    atAddress('/')
    useDemo.getState().start()
    stop = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().active).toBe(false)
    stop()
    useDemo.getState().exit()
    useTv.setState({ on: true })
    useTutorial.getState().start()
    expect(useTutorial.getState().active).toBe(false)
    useTv.setState({ on: false })
  })

  it('resumes a run left unfinished at its step, and never one that ended', async () => {
    switchOn()
    const script: TutorialScript = { steps: [{ id: 'a', title: 'A', caption: 'a' }, { id: 'b', title: 'B', caption: 'b' }] }
    useTutorial.setState({ script })
    writeProgress(pubkey(), { step: 'b' })
    // A chain since then (they moved): resumed anyway, it is theirs.
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'found' } })
    let stop = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().active).toBe(true)
    expect(useTutorial.getState().index).toBe(1)
    stop()
    useTutorial.getState().end('skipped')
    expect(readProgress(pubkey())).toEqual({ step: 'b', ended: 'skipped' })
    stop = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().active).toBe(false)
    stop()
  })

  it('reads stored progress that is corrupt as none, and a step no longer in the script as the first', async () => {
    localStorage.setItem(PROGRESS_PREFIX + pubkey(), '{not json')
    expect(readProgress(pubkey())).toBe(null)
    localStorage.setItem(PROGRESS_PREFIX + pubkey(), JSON.stringify({ step: 7 }))
    expect(readProgress(pubkey())).toBe(null)
    localStorage.setItem(PROGRESS_PREFIX + pubkey(), JSON.stringify({ step: 'welcome', ended: 'maybe' }))
    expect(readProgress(pubkey())).toBe(null)
    switchOn()
    writeProgress(pubkey(), { step: 'a-step-since-removed' })
    const stop = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().active).toBe(true)
    expect(useTutorial.getState().index).toBe(0)
    stop()
  })
})

describe('the script', () => {
  it('has unique ids, starts at the welcome, and no modal step waits or gates', () => {
    const ids = TUTORIAL_SCRIPT.steps.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe('welcome')
    for (const s of TUTORIAL_SCRIPT.steps) if (s.modal) { expect(s.wait, s.id).toBeUndefined(); expect(s.gate, s.id).toBeUndefined() }
  })

  it('has no em dash in any line the player reads', () => {
    for (const s of TUTORIAL_SCRIPT.steps) for (const t of [s.title, s.caption, s.captionDone, s.explain, s.hint, s.go]) if (t) expect(t, s.id).not.toMatch(/\u2014/)
  })
})

describe('the engine', () => {
  it('never touches the publishing switch: the player is LIVE as before, and stays so', () => {
    useTutorial.setState({ script: { steps: [TUTORIAL_SCRIPT.steps[0]] } })
    useCyberspace.getState().setLive(true)
    useTutorial.getState().start()
    expect(useCyberspace.getState().live).toBe(true)
    useTutorial.getState().next() // FIND IT on the welcome, here the last step
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

  it('goes away for the /demo tour and for TV, keeping progress', async () => {
    switchOn()
    const stop = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().active).toBe(true)
    useDemo.getState().start()
    expect(useTutorial.getState().active).toBe(false)
    expect(readProgress(pubkey())).toEqual({ step: 'welcome' })
    useDemo.getState().exit()
    useTutorial.getState().start({ at: 'welcome' })
    useTv.setState({ on: true })
    expect(useTutorial.getState().active).toBe(false)
    useTv.setState({ on: false })
    stop()
  })

  it('goes away when another identity signs in, and that identity has its own progress', async () => {
    switchOn()
    const stop = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().active).toBe(true)
    const me = pubkey()
    const other = 'f'.repeat(64)
    const was = useCyberspace.getState().identity
    useCyberspace.setState({ identity: { ...was, pubkey: other } })
    expect(useTutorial.getState().active).toBe(false)
    expect(readProgress(me)).toEqual({ step: 'welcome' })
    expect(readProgress(other)).toBe(null)
    useCyberspace.setState({ identity: was })
    stop()
  })

  it('passing the last step with its wait still to do is a skip, not a finish', () => {
    registerTutorialWatcher('never-wait' as never, () => () => {})
    useTutorial.setState({ script: { steps: [{ id: 'only', title: 'O', caption: 'o', wait: 'never-wait' as never }] } })
    useTutorial.getState().start()
    useTutorial.getState().next()
    expect(readProgress(pubkey())).toEqual({ step: 'only', ended: 'skipped' })
  })

  it('branches: a choice goes to its step, NEXT on the way through passes over branches, a branch\'s NEXT finishes', () => {
    useTutorial.setState({ script: { steps: [
      { id: 'c', title: 'C', caption: 'c', modal: true, choices: [{ id: 'go-b', label: 'B', about: 'b', step: 'b' }] },
      { id: 'b', title: 'B', caption: 'b', branch: true },
      { id: 'after', title: 'A', caption: 'a' },
    ] } })
    useTutorial.getState().start()
    useTutorial.getState().choose('go-b')
    expect(useTutorial.getState().script.steps[useTutorial.getState().index].id).toBe('b')
    useTutorial.getState().next()
    expect(useTutorial.getState().active).toBe(false)
    expect(readProgress(pubkey())).toEqual({ step: 'b', ended: 'finished' })
    useTutorial.getState().start({ restart: true })
    useTutorial.getState().next()
    expect(useTutorial.getState().script.steps[useTutorial.getState().index].id).toBe('after')
  })

  it('a choice that names `when` is offered only once registered, and its run happens after the tutorial ends', () => {
    const dungeon = { id: 'd', label: 'D', about: 'd', when: 'test-dungeon' }
    useTutorial.setState({ script: { steps: [{ id: 'c', title: 'C', caption: 'c', modal: true, choices: [dungeon] }] } })
    expect(choiceOffered(dungeon)).toBe(false)
    useTutorial.getState().start()
    useTutorial.getState().choose('d')
    // Not offered: nothing happens.
    expect(useTutorial.getState().active).toBe(true)
    let ran = false
    registerTutorialChoice('test-dungeon', { run: () => { ran = useTutorial.getState().active === false } })
    expect(choiceOffered(dungeon)).toBe(true)
    useTutorial.getState().choose('d')
    expect(ran).toBe(true)
    expect(readProgress(pubkey())?.ended).toBe('finished')
  })

  it('the script offers HYPERSPACE and AGENTS, and the dungeon only once Track C registers it', () => {
    const choice = TUTORIAL_SCRIPT.steps.find((st) => st.id === 'choice')!
    expect(choice.choices!.filter(choiceOffered).map((c) => c.id)).toEqual(['hyperspace', 'agents'])
    for (const c of choice.choices!) if (c.step) expect(TUTORIAL_SCRIPT.steps.find((st) => st.id === c.step)?.branch, c.id).toBe(true)
  })

  it('a coach button runs its effect only when tapped', () => {
    let runs = 0
    registerTutorialEffect('test-action', () => { runs++ })
    useTutorial.setState({ script: { steps: [{ id: 'a', title: 'A', caption: 'a', action: { label: 'GO', effect: 'test-action' } }] } })
    useTutorial.getState().start()
    expect(runs).toBe(0)
    runTutorialEffect('test-action')
    expect(runs).toBe(1)
  })
  it('a step that needs WALK goes back to the WALK step when not walking, and SKIP on that step passes over it', () => {
    useCyberspace.setState({ walking: false })
    useTutorial.setState({ script: { steps: [
      { id: 'walk', title: 'W', caption: 'w', wait: 'walk' },
      { id: 'run', title: 'R', caption: 'r', needsWalk: 'walk' },
      { id: 'after', title: 'A', caption: 'a' },
    ] } })
    // Resumed on RUN without WALK (a reload never keeps it): back to WALK.
    useTutorial.getState().start({ at: 'run' })
    expect(useTutorial.getState().script.steps[useTutorial.getState().index].id).toBe('walk')
    // SKIP on WALK: past RUN, which needs it.
    useTutorial.getState().next()
    expect(useTutorial.getState().script.steps[useTutorial.getState().index].id).toBe('after')
  })

  it('plants the tutorial tree: the plant step names the DNA the SEED composer offers, and the bud step shows its picture', async () => {
    const { TUTORIAL_DNA, TUTORIAL_BUD_PICTURE } = await import('../../tutorial/dna')
    const ids = TUTORIAL_SCRIPT.steps.map((st) => st.id)
    expect(ids.slice(ids.indexOf('take'), ids.indexOf('to-course') + 1)).toEqual(['take', 'to-plot', 'plant', 'bud', 'to-course'])
    const plant = TUTORIAL_SCRIPT.steps.find((st) => st.id === 'plant')!
    expect(plant.hint).toContain(TUTORIAL_DNA.name.toUpperCase())
    expect(TUTORIAL_SCRIPT.steps.find((st) => st.id === 'bud')!.image?.src).toBe(TUTORIAL_BUD_PICTURE)
  })
})
