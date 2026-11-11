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
import { ADVANCE_MS, CHOICE_FAILED_MESSAGE, choiceOffered, isNewArrival, onTutorialLifecycle, registerTutorialChoice, registerTutorialEffect, registerTutorialWatcher, runTutorialEffect, useTutorial, watchFirstArrival } from '../useTutorial'
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

  it('glows COMMIT alone, never the mode button beside it, and opens CONTROLS for it (items 5 and 14)', () => {
    for (const id of ['box', 'to-course']) {
      const step = TUTORIAL_SCRIPT.steps.find((s) => s.id === id)!
      expect(step.scene?.highlight).toBe('.touchops__commit:not(.is-hop):not(.is-view):not(.is-walk):not(.is-build)')
      expect(step.scene?.pad).toBe(true)
    }
  })

  it('has no SKIP on the first step: the box step is gated (item 17)', () => {
    expect(TUTORIAL_SCRIPT.steps.find((s) => s.id === 'box')?.gate).toBe(true)
  })

  it('teaches the real build flow, with no HOLD button (item 11b)', () => {
    const build = TUTORIAL_SCRIPT.steps.find((s) => s.id === 'build-place')!
    expect(build.hint).not.toMatch(/HOLD/)
    expect(build.hint).toMatch(/MOVE TO WORKSHOP[\s\S]*BUILD[\s\S]*OBJECT[\s\S]*PLACE/)
  })

  it('has no em dash in any line the player reads', () => {
    for (const s of TUTORIAL_SCRIPT.steps) for (const t of [s.title, s.caption, s.captionDone, s.explain, s.hint, s.go]) if (t) expect(t, s.id).not.toMatch(/\u2014/)
  })

  it('keeps only the chips a step teaches with, and no others (feedback item 3)', () => {
    const keep = (id: string): string[] => TUTORIAL_SCRIPT.steps.find((s) => s.id === id)?.keepChips ?? []
    // Opening and taking from a chest needs FOUND HERE; spectating a friend needs the chain chip.
    expect(keep('open')).toEqual(['found'])
    expect(keep('take')).toEqual(['found'])
    expect(keep('finish')).toEqual(['found'])
    expect(keep('friend')).toEqual(['chain'])
    // The welcome, the box and the course teach with none.
    expect(keep('welcome')).toEqual([])
    expect(keep('box')).toEqual([])
    expect(keep('to-course')).toEqual([])
  })
})

describe('the engine', () => {
  it('starts a first arrival LOCAL, so a newcomer sandboxes (feedback item 15)', () => {
    useTutorial.setState({ script: { steps: [TUTORIAL_SCRIPT.steps[0]] } })
    useCyberspace.getState().setLive(true)
    useTutorial.getState().start()
    expect(useCyberspace.getState().live).toBe(false)
    useTutorial.getState().next() // FIND IT on the welcome, here the last step
    expect(useTutorial.getState().active).toBe(false)
    expect(readProgress(pubkey())?.ended).toBe('finished')
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

  it('branches: a choice goes to its step, a branch\'s NEXT returns to the choices checked off, DONE passes over them (feedback items 8 and 10)', () => {
    const id = (): string => useTutorial.getState().script.steps[useTutorial.getState().index].id
    useTutorial.setState({ script: { steps: [
      { id: 'c', title: 'C', caption: 'c', modal: true, go: 'DONE', choices: [{ id: 'go-b', label: 'B', about: 'b', step: 'b' }] },
      { id: 'b', title: 'B', caption: 'b', branch: true },
      { id: 'after', title: 'A', caption: 'a' },
    ] } })
    useTutorial.getState().start()
    useTutorial.getState().choose('go-b')
    expect(id()).toBe('b')
    // A branch's NEXT returns to the choices with it checked off, not a finish.
    useTutorial.getState().next()
    expect(id()).toBe('c')
    expect(useTutorial.getState().doneChoices).toContain('go-b')
    // DONE passes over the branch to the step after it.
    useTutorial.getState().next()
    expect(id()).toBe('after')
    // BACK from there steps to the choices, past the branch (feedback item 8).
    useTutorial.getState().back()
    expect(id()).toBe('c')
  })

  it('BACK onto a step already done shows its check and waits, never bouncing forward again; BACK on a route checks nothing off (item 8)', () => {
    vi.useFakeTimers()
    registerTutorialWatcher('already-done' as never, (onDone) => { onDone(); return () => {} })
    const id = (): string => useTutorial.getState().script.steps[useTutorial.getState().index].id
    useTutorial.setState({ script: { steps: [
      { id: 'w', title: 'W', caption: 'w', wait: 'already-done' as never },
      { id: 'c', title: 'C', caption: 'c', modal: true, go: 'DONE', choices: [{ id: 'go-b', label: 'B', about: 'b', step: 'b' }] },
      { id: 'b', title: 'B', caption: 'b', branch: true },
    ] } })
    useTutorial.getState().start({ at: 'c' })
    useTutorial.getState().back()
    expect(id()).toBe('w')
    expect(useTutorial.getState().done).toBe(true)
    vi.advanceTimersByTime(ADVANCE_MS * 3)
    expect(id()).toBe('w')
    useTutorial.getState().next()
    useTutorial.getState().choose('go-b')
    expect(id()).toBe('b')
    useTutorial.getState().back()
    expect(id()).toBe('c')
    expect(useTutorial.getState().doneChoices).toEqual([])
  })

  it('keeps the checked-off routes with the progress, so a reload resumes with them (item 10)', () => {
    useTutorial.setState({ script: { steps: [
      { id: 'c', title: 'C', caption: 'c', modal: true, go: 'DONE', choices: [{ id: 'go-b', label: 'B', about: 'b', step: 'b' }] },
      { id: 'b', title: 'B', caption: 'b', branch: true },
    ] } })
    useTutorial.getState().start()
    useTutorial.getState().choose('go-b')
    useTutorial.getState().next()
    expect(readProgress(pubkey())).toEqual({ step: 'c', choices: ['go-b'] })
    useTutorial.getState().pause()
    useTutorial.getState().start({ at: 'c' })
    expect(useTutorial.getState().doneChoices).toEqual(['go-b'])
    // RESTART starts clean.
    useTutorial.getState().start({ restart: true })
    expect(useTutorial.getState().doneChoices).toEqual([])
  })

  it('RESTART leaves the publishing switch as the player set it: LOCAL is for a first arrival only (item 15)', () => {
    useTutorial.setState({ script: { steps: [TUTORIAL_SCRIPT.steps[0]] } })
    useCyberspace.getState().setLive(true)
    useTutorial.getState().start({ restart: true })
    expect(useCyberspace.getState().live).toBe(true)
    useTutorial.getState().pause()
  })

  it('FINISH then a reload puts the kept stage back, through the restore hook (item 9)', async () => {
    const restored: string[] = []
    const off = onTutorialLifecycle({ restore: (pk) => { restored.push(pk) } })
    writeProgress(pubkey(), { step: 'done', ended: 'finished' })
    switchOn()
    const stop = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().active).toBe(false)
    expect(restored).toEqual([pubkey()])
    stop()
    // A skipped run restores nothing.
    restored.length = 0
    writeProgress(pubkey(), { step: 'box', ended: 'skipped' })
    const stop2 = watchFirstArrival()
    await flush()
    expect(restored).toEqual([])
    stop2()
    off()
  })

  it('a choice that names `when` is offered only once registered; its run happens while the card is up, and the tutorial ends once it went', async () => {
    const dungeon = { id: 'd', label: 'D', about: 'd', when: 'test-dungeon' }
    useTutorial.setState({ script: { steps: [{ id: 'c', title: 'C', caption: 'c', modal: true, choices: [dungeon] }] } })
    expect(choiceOffered(dungeon)).toBe(false)
    useTutorial.getState().start()
    useTutorial.getState().choose('d')
    // Not offered: nothing happens.
    expect(useTutorial.getState().active).toBe(true)
    let upWhileRunning: boolean | null = null
    registerTutorialChoice('test-dungeon', { run: () => { upWhileRunning = useTutorial.getState().active } })
    expect(choiceOffered(dungeon)).toBe(true)
    useTutorial.getState().choose('d')
    expect(useTutorial.getState().choosing).toBe('d')
    await new Promise((r) => setTimeout(r, 0))
    expect(upWhileRunning).toBe(true)
    expect(useTutorial.getState().active).toBe(false)
    expect(readProgress(pubkey())?.ended).toBe('finished')
  })

  it('a run that returns words is a refusal: the card stays with them, the next choice clears them, and a run gone stale settles nothing', async () => {
    let answer: string | null = 'Finish your walk first.'
    let release: (() => void) | null = null
    registerTutorialChoice('test-refuse', { run: () => answer })
    registerTutorialChoice('test-slow', { run: () => new Promise<null>((r) => { release = () => r(null) }) })
    useTutorial.setState({ script: { steps: [
      { id: 'c', title: 'C', caption: 'c', modal: true, choices: [{ id: 'r', label: 'R', about: 'r', when: 'test-refuse' }, { id: 's', label: 'S', about: 's', when: 'test-slow' }, { id: 'b', label: 'B', about: 'b', step: 'b' }] },
      { id: 'b', title: 'B', caption: 'b', branch: true },
    ] } })
    useTutorial.getState().start()
    useTutorial.getState().choose('r')
    await new Promise((r) => setTimeout(r, 0))
    expect(useTutorial.getState().active).toBe(true)
    expect(useTutorial.getState().index).toBe(0)
    expect(useTutorial.getState().choosing).toBe(null)
    expect(useTutorial.getState().choiceNote).toBe('Finish your walk first.')
    // Tried again and it went: the note goes with the card.
    answer = null
    useTutorial.getState().choose('r')
    expect(useTutorial.getState().choiceNote).toBe(null)
    await new Promise((r) => setTimeout(r, 0))
    expect(useTutorial.getState().active).toBe(false)
    // A slow run the player walks away from (RESTART): it settles nothing on the new run.
    useTutorial.getState().start({ restart: true })
    useTutorial.getState().choose('s')
    await new Promise((r) => setTimeout(r, 0))
    expect(useTutorial.getState().choosing).toBe('s')
    useTutorial.getState().start({ restart: true })
    expect(useTutorial.getState().choosing).toBe(null)
    release!()
    await new Promise((r) => setTimeout(r, 0))
    expect(useTutorial.getState().active).toBe(true)
    expect(useTutorial.getState().index).toBe(0)
  })

  it('the script offers HYPERSPACE and AGENTS, and the dungeon only once Track C registers it', () => {
    const choice = TUTORIAL_SCRIPT.steps.find((st) => st.id === 'choice')!
    expect(choice.choices!.filter(choiceOffered).map((c) => c.id)).toEqual(['hyperspace', 'agents', 'friend', 'build'])
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

  it('choice seams: a run with a step runs first then goes there; a run that fails leaves the card; a missing step changes nothing; a gate holds; a double tap does nothing twice', async () => {
    let runs = 0
    let fail = false
    registerTutorialChoice('test-game', { run: async () => { runs++; if (fail) throw new Error('relay said no') } })
    useTutorial.setState({ script: { steps: [
      { id: 'c', title: 'C', caption: 'c', modal: true, choices: [{ id: 'g', label: 'G', about: 'g', when: 'test-game', step: 'inside' }, { id: 'lost', label: 'L', about: 'l', step: 'nowhere' }] },
      { id: 'inside', title: 'I', caption: 'i', branch: true },
    ] } })
    useTutorial.getState().start()
    useTutorial.getState().choose('lost')
    expect(useTutorial.getState().index).toBe(0)
    expect(useTutorial.getState().active).toBe(true)
    fail = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useTutorial.getState().choose('g')
    await new Promise((r) => setTimeout(r, 0))
    warn.mockRestore()
    expect(runs).toBe(1)
    expect(useTutorial.getState().index).toBe(0)
    expect(useTutorial.getState().choiceNote).toBe(CHOICE_FAILED_MESSAGE)
    fail = false
    useTutorial.getState().choose('g')
    useTutorial.getState().choose('g')
    await new Promise((r) => setTimeout(r, 0))
    // The second tap came while the first ran: one run, not two.
    expect(runs).toBe(2)
    expect(useTutorial.getState().script.steps[useTutorial.getState().index].id).toBe('inside')
    expect(useTutorial.getState().choiceNote).toBe(null)
    useTutorial.getState().choose('g')
    await new Promise((r) => setTimeout(r, 0))
    expect(useTutorial.getState().script.steps[useTutorial.getState().index].id).toBe('inside')
  })

  it('a gated card takes no choice until its wait is done, and a registered choice redraws the coach', () => {
    registerTutorialWatcher('never-2' as never, () => () => {})
    useTutorial.setState({ script: { steps: [
      { id: 'c', title: 'C', caption: 'c', wait: 'never-2' as never, gate: true, choices: [{ id: 'b', label: 'B', about: 'b', step: 'b' }] },
      { id: 'b', title: 'B', caption: 'b', branch: true },
    ] } })
    useTutorial.getState().start()
    useTutorial.getState().choose('b')
    expect(useTutorial.getState().index).toBe(0)
    const v = useTutorial.getState().choicesVersion
    registerTutorialChoice('test-late', { run: () => {} })
    expect(useTutorial.getState().choicesVersion).toBe(v + 1)
  })

  it('resumes into a branch, and another identity signing in on a branch ends the run as finished', async () => {
    switchOn()
    useTutorial.setState({ script: { steps: [{ id: 'c', title: 'C', caption: 'c' }, { id: 'agents', title: 'A', caption: 'a', branch: true }] } })
    writeProgress(pubkey(), { step: 'agents' })
    const stop = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().script.steps[useTutorial.getState().index].id).toBe('agents')
    const was = useCyberspace.getState().identity
    const me = pubkey()
    useCyberspace.setState({ identity: { ...was, pubkey: 'e'.repeat(64) } })
    expect(useTutorial.getState().active).toBe(false)
    expect(readProgress(me)).toEqual({ step: 'agents', ended: 'finished' })
    useCyberspace.setState({ identity: was })
    stop()
  })

  it('counts progress along the way through, a branch being the end', async () => {
    const { progressOf } = await import('../../hud/TutorialCoach')
    const steps = [{}, {}, { branch: true }, {}, { branch: true }]
    expect(progressOf(steps, 0)).toBeCloseTo(1 / 3)
    expect(progressOf(steps, 3)).toBe(1)
    expect(progressOf(steps, 2)).toBe(1)
  })
})
