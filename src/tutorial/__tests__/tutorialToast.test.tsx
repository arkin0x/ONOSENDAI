/**
 * tutorialToast.test.tsx: the tutorial toast (tutorial/toast.ts,
 * hud/TutorialToast.tsx; owner, 2026-11-13, copy A):
 *
 * - shown to a returning identity that has not finished the tutorial (never
 *   started, skipped, or left unfinished), never to one that finished, never
 *   to a brand-new arrival, never with the switch off;
 * - never during the tutorial, Cyberspace TV, the /demo tour, the 24/7
 *   broadcast, a hyperspace ride or a game: it waits, and steps aside;
 * - at most once a day and three times in all per identity, counting shows,
 *   kept on the device and, without storage, for the visit;
 * - START resumes a run left on the device (unfinished or skipped) at its
 *   step, laid out where it was, as RESUME TUTORIAL; with no run it starts
 *   from the first step where the player stands; the publishing switch
 *   untouched either way; LATER puts it away;
 * - the words, verbatim. Pressed through the chip's real onClick. No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  const store = { refuse: false }
  ;(globalThis as { __toastStore?: typeof store }).__toastStore = store
  const guard = (): void => { if (store.refuse) throw new Error('storage refused') }
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => { guard(); return m.get(k) ?? null },
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { guard(); m.delete(k) },
    setItem: (k: string, v: string) => { guard(); m.set(k, String(v)) },
  }
})
const storage = (globalThis as unknown as { __toastStore: { refuse: boolean } }).__toastStore

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

// Whether the key on screen was made on this page load (a brand-new visitor): the test says.
const minted = vi.hoisted(() => ({ onLoad: false }))
vi.mock('../../store/useCyberspace', async (orig) => {
  const real = await orig<typeof import('../../store/useCyberspace')>()
  return { ...real, keyMintedOnLoad: () => (minted.onLoad ? real.useCyberspace.getState().identity.pubkey : null) }
})
// Whether this page is the 24/7 broadcast: the test says.
const bc = vi.hoisted(() => ({ on: false }))
vi.mock('../../lib/tv/broadcast', async (orig) => ({ ...(await orig<typeof import('../../lib/tv/broadcast')>()), isBroadcast: () => bc.on }))

import { MINTED_KEY, useCyberspace } from '../../store/useCyberspace'
import { useTutorial } from '../../store/useTutorial'
import { useDemo } from '../../store/useDemo'
import { useTv } from '../../store/useTv'
import { useGame, type GameSession } from '../../store/useGame'
import { spawnPlace } from '../../store/useDemo'
import { PROGRESS_PREFIX, TUTORIAL_SWITCH_KEY, noteLanding, readProgress, setTutorialSwitch, takeTutorialAsk, useTutorialSwitch, writeProgress } from '../gate'
import { takeArrivalMode } from '../../store/arrivalMode'
import { TUTORIAL_SCRIPT } from '../script'
import { TOAST_GAP_MS, TOAST_IDLE_MS, TOAST_MAX_SHOWS, TOAST_PREFIX, TOAST_RETRY_MS, TUTORIAL_TOAST_TEXT, capsAllow, dismissTutorialToast, forgetTutorialToast, noteToastOnScreen, readToastRecord, startFromTutorialToast, useTutorialToast, watchTutorialToast } from '../toast'
import { mount, textOf } from '../../test/elementRoot'
import { TutorialToast } from '../../hud/TutorialToast'

const cs = () => useCyberspace.getState()
const pubkey = (): string => cs().identity.pubkey
const offer = (): string | null => useTutorialToast.getState().offer
const DAY = TOAST_GAP_MS

/** Someone who used cyberspace before: the relays found their chain. */
const returning = (): void => { useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'found' } }) }
/** A brand-new visitor: a key this app made, no chain, the relays found none. */
const brandNew = (): void => { useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'none' } }) }
/** A page load: the landing noted, the toast's per-load memory gone (storage stays). */
function load(pathname = '/'): void {
  noteLanding(pathname)
  takeArrivalMode({ pathname, search: '', hash: '' }, { state: null, replaceState: () => {} })
  forgetTutorialToast()
}
/** Somewhere that is not this identity's spawn, in the other plane: where a returning player stands. */
function standAway(): { x: bigint; y: bigint; z: bigint; plane: 0 | 1 } {
  const spawn = spawnPlace(pubkey())
  const at = { x: spawn.x + 4000n, y: spawn.y + 200n, z: spawn.z + 60000n, plane: (spawn.plane === 0 ? 1 : 0) as 0 | 1 }
  useCyberspace.setState({ position: { x: at.x, y: at.y, z: at.z }, headPlane: at.plane })
  return at
}
/** Run the watcher past the idle wait, with the clock at `now`. */
async function arrive(now = Date.UTC(2026, 10, 13, 12)): Promise<() => void> {
  vi.setSystemTime(now)
  const stop = watchTutorialToast()
  await vi.advanceTimersByTimeAsync(TOAST_IDLE_MS + 10)
  return stop
}

let spawnWas: { position: { x: bigint; y: bigint; z: bigint }; headPlane: 0 | 1 }
const identityWas = useCyberspace.getState().identity
beforeEach(() => {
  useCyberspace.setState({ identity: identityWas })
  storage.refuse = false
  bc.on = false
  minted.onLoad = false
  takeTutorialAsk()
  if (useTutorial.getState().active) useTutorial.getState().pause()
  localStorage.removeItem(TUTORIAL_SWITCH_KEY)
  useTutorialSwitch.setState({ value: null })
  localStorage.removeItem(PROGRESS_PREFIX + pubkey())
  localStorage.removeItem(TOAST_PREFIX + pubkey())
  localStorage.setItem(MINTED_KEY, pubkey())
  const s = spawnPlace(pubkey())
  spawnWas = { position: { x: s.x, y: s.y, z: s.z }, headPlane: s.plane as 0 | 1 }
  useCyberspace.setState({ ...spawnWas, transit: null, events: [], signerKind: 'local', plan: null })
  useTv.setState({ on: false })
  useGame.setState({ session: null })
  returning()
  load('/')
})
afterEach(() => {
  if (useTutorial.getState().active) useTutorial.getState().pause()
  if (useDemo.getState().active) useDemo.getState().exit()
  useTv.setState({ on: false })
  useGame.setState({ session: null })
  useCyberspace.setState({ ...spawnWas, transit: null, identity: identityWas })
  vi.useRealTimers()
})

describe('who is offered the toast', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })

  it('a returning identity that never started it, a few seconds after arrival, not before', async () => {
    vi.setSystemTime(Date.UTC(2026, 10, 13, 12))
    const stop = watchTutorialToast()
    await vi.advanceTimersByTimeAsync(TOAST_IDLE_MS - 500)
    expect(offer()).toBe(null)
    await vi.advanceTimersByTimeAsync(600)
    expect(offer()).toBe(pubkey())
    stop()
  })

  it('one that skipped it, and one that left it unfinished (on an address where it does not resume)', async () => {
    writeProgress(pubkey(), { step: 'box', ended: 'skipped' })
    let stop = await arrive()
    expect(offer()).toBe(pubkey())
    stop()
    localStorage.removeItem(TOAST_PREFIX + pubkey())
    writeProgress(pubkey(), { step: 'take' })
    load('/C/abc')
    stop = await arrive()
    expect(offer()).toBe(pubkey())
    stop()
  })

  it('a brand-new key whose player skipped before ever moving (still new to the relays): it has had its run', async () => {
    brandNew()
    writeProgress(pubkey(), { step: 'welcome', ended: 'skipped' })
    const stop = await arrive()
    expect(offer()).toBe(pubkey())
    stop()
  })

  it('not one whose unfinished run resumes by itself on this load', async () => {
    writeProgress(pubkey(), { step: 'take' })
    const stop = await arrive()
    expect(offer()).toBe(null)
    stop()
  })

  it('never one that finished it', async () => {
    writeProgress(pubkey(), { step: 'choices', ended: 'finished' })
    const stop = await arrive()
    await vi.advanceTimersByTimeAsync(TOAST_RETRY_MS * 5)
    expect(offer()).toBe(null)
    stop()
  })

  it('never a brand-new arrival: not on the load the first arrival starts, nor on one a ?mode= link held it back', async () => {
    brandNew()
    let stop = await arrive()
    expect(offer()).toBe(null)
    stop()
    minted.onLoad = true
    noteLanding('/')
    takeArrivalMode({ pathname: '/', search: '?mode=region', hash: '' }, { state: null, replaceState: () => {} })
    forgetTutorialToast()
    stop = await arrive()
    await vi.advanceTimersByTimeAsync(TOAST_RETRY_MS * 5)
    expect(offer()).toBe(null)
    stop()
  })

  it('nobody with the tutorial switch off', async () => {
    setTutorialSwitch(false)
    const stop = await arrive()
    expect(offer()).toBe(null)
    stop()
  })

  it('waits for the relays to say where a returning player stands', async () => {
    useCyberspace.setState({ events: [{} as never] })
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'checking' } })
    const stop = await arrive()
    expect(offer()).toBe(null)
    useCyberspace.setState({ events: [], selfCheck: { pubkey: pubkey(), status: 'found' } })
    await vi.advanceTimersByTimeAsync(TOAST_RETRY_MS + 10)
    expect(offer()).toBe(pubkey())
    stop()
  })

  it('not on top of a hop lined up: it waits for it', async () => {
    useCyberspace.setState({ plan: {} as never })
    const stop = await arrive()
    expect(offer()).toBe(null)
    useCyberspace.setState({ plan: null })
    await vi.advanceTimersByTimeAsync(TOAST_RETRY_MS + 10)
    expect(offer()).toBe(pubkey())
    stop()
  })

  const busy: Array<[string, () => void, () => void]> = [
    ['Cyberspace TV', () => useTv.setState({ on: true }), () => useTv.setState({ on: false })],
    ['the /demo tour', () => useDemo.setState({ active: true }), () => useDemo.setState({ active: false })],
    ['the 24/7 broadcast', () => { bc.on = true }, () => { bc.on = false }],
    ['a hyperspace ride', () => useCyberspace.setState({ transit: {} as never }), () => useCyberspace.setState({ transit: null })],
    ['a game', () => useGame.setState({ session: {} as GameSession }), () => useGame.setState({ session: null })],
  ]
  for (const [what, on, off] of busy) {
    it(`never during ${what}: it waits until it is over`, async () => {
      on()
      const stop = await arrive()
      await vi.advanceTimersByTimeAsync(TOAST_RETRY_MS * 3)
      expect(offer()).toBe(null)
      off()
      await vi.advanceTimersByTimeAsync(TOAST_RETRY_MS + 10)
      expect(offer()).toBe(pubkey())
      stop()
    })
  }

  it('never during the tutorial: a run started any other way takes it away for the rest of the load, even once skipped', async () => {
    const stop = await arrive()
    expect(offer()).toBe(pubkey())
    useTutorial.getState().start({ restart: true })
    expect(offer()).toBe(null)
    useTutorial.getState().end('skipped')
    await vi.advanceTimersByTimeAsync(TOAST_IDLE_MS + TOAST_RETRY_MS * 5)
    expect(offer()).toBe(null)
    stop()
  })

  it('another identity on screen: the last one\'s offer goes', async () => {
    const stop = await arrive()
    expect(offer()).toBe(pubkey())
    useCyberspace.setState({ identity: { ...cs().identity, pubkey: 'f'.repeat(64) } })
    expect(offer()).toBe(null)
    stop()
  })
})

describe('how often', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
  const T0 = Date.UTC(2026, 10, 13, 12)

  it('at most once a day, and three times in all, counting shows', async () => {
    let now = T0
    let shows = 0
    for (let day = 0; day < 6; day++) {
      // Two loads a day: the second never shows.
      for (const later of [0, 3 * 60 * 60 * 1000]) {
        load('/')
        const stop = await arrive(now + later)
        if (offer()) { noteToastOnScreen(pubkey()); shows++; expect(later).toBe(0) }
        stop()
      }
      // The next day, a little later than the last show (stamped after the idle wait).
      now += DAY + 60_000
    }
    expect(shows).toBe(TOAST_MAX_SHOWS)
    expect(readToastRecord(pubkey()).shows).toBe(TOAST_MAX_SHOWS)
  })

  it('an offer never on screen (the menu over it all visit) counts nothing; on screen again for the same offer counts once', async () => {
    let stop = await arrive(T0)
    expect(offer()).toBe(pubkey())
    stop()
    expect(readToastRecord(pubkey()).shows).toBe(0)
    load('/')
    stop = await arrive(T0 + 60_000)
    expect(offer()).toBe(pubkey())
    noteToastOnScreen(pubkey())
    noteToastOnScreen(pubkey())
    expect(readToastRecord(pubkey()).shows).toBe(1)
    stop()
  })

  it('another tab that showed it since the offer was made: this one goes without a show', async () => {
    const stop = await arrive(T0)
    expect(offer()).toBe(pubkey())
    localStorage.setItem(TOAST_PREFIX + pubkey(), JSON.stringify({ shows: 1, last: T0 + 1000 }))
    noteToastOnScreen(pubkey(), T0 + 2000)
    expect(offer()).toBe(null)
    expect(readToastRecord(pubkey()).shows).toBe(1)
    stop()
  })

  it('a device that refuses storage keeps the caps for the visit', async () => {
    storage.refuse = true
    let stop = await arrive(T0)
    expect(offer()).toBe(pubkey())
    noteToastOnScreen(pubkey())
    stop()
    // Another watch on the same visit (a remount): the memory copy says not today.
    dismissTutorialToast()
    stop = await arrive(T0 + 60_000)
    expect(offer()).toBe(null)
    expect(readToastRecord(pubkey()).shows).toBe(1)
    expect(readToastRecord(pubkey()).last).toBeGreaterThanOrEqual(T0)
    stop()
  })

  it('the caps as a rule', () => {
    expect(capsAllow({ shows: 0, last: 0 }, T0)).toBe(true)
    expect(capsAllow({ shows: 1, last: T0 }, T0 + DAY - 1)).toBe(false)
    expect(capsAllow({ shows: 1, last: T0 }, T0 + DAY)).toBe(true)
    expect(capsAllow({ shows: 2, last: T0 }, T0 + 5 * DAY)).toBe(true)
    expect(capsAllow({ shows: 3, last: T0 }, T0 + 50 * DAY)).toBe(false)
    // A clock set back: allowed (the total still holds).
    expect(capsAllow({ shows: 1, last: T0 }, T0 - 1000)).toBe(true)
  })
})

describe('the chip', () => {
  it('says the words verbatim, as a status, with START and LATER', async () => {
    useTutorialToast.setState({ offer: pubkey() })
    const chip = await mount(<TutorialToast />)
    expect(TUTORIAL_TOAST_TEXT).toBe("Haven't finished the tutorial yet? There's a treasure chest waiting for you!")
    expect(chip.says(TUTORIAL_TOAST_TEXT)).toBe(true)
    // The sentence is the status; the buttons sit outside it.
    const status = chip.all().find((h) => h.props.role === 'status')!
    expect(textOf(status)).toBe(TUTORIAL_TOAST_TEXT)
    expect(chip.all().filter((h) => h.type === 'button').map(textOf)).toEqual(['START', 'LATER'])
    // On screen counts one show.
    expect(readToastRecord(pubkey()).shows).toBe(1)
    await chip.unmount()
  })

  it('START with no run on this device starts from the first step, where the player stands, publishing untouched', async () => {
    for (const live of [true, false]) {
      localStorage.removeItem(PROGRESS_PREFIX + pubkey())
      cs().setLive(live)
      const at = standAway()
      useTutorialToast.setState({ offer: pubkey() })
      const chip = await mount(<TutorialToast />)
      await chip.press('START')
      const t = useTutorial.getState()
      expect(t.active).toBe(true)
      expect(t.script.steps[t.index].id).toBe('welcome')
      expect(t.anchor).toEqual(at)
      expect(readProgress(pubkey())).toEqual({ step: 'welcome', anchor: at })
      expect(cs().live).toBe(live)
      expect(offer()).toBe(null)
      expect(chip.says(TUTORIAL_TOAST_TEXT)).toBe(false)
      await chip.unmount()
      useTutorial.getState().pause()
    }
  })

  // START picks a kept run up as the menu's RESUME TUTORIAL does (review of
  // #724): it once restarted from the welcome, wiping the run.
  const mid = TUTORIAL_SCRIPT.steps.find((st, i) => i > 1 && !st.branch && !st.needsWalk && !st.choices)!
  const kept = { x: 123456789n, y: 987654321n, z: 55555n, plane: 1 as const }
  for (const ended of [undefined, 'skipped'] as const) {
    it(`START with ${ended ? 'a skipped' : 'an unfinished'} run resumes it at its step, laid out where it was, publishing untouched`, async () => {
      for (const live of [true, false]) {
        writeProgress(pubkey(), { step: mid.id, ...(ended ? { ended } : {}), choices: ['agents'], anchor: kept })
        cs().setLive(live)
        // Standing elsewhere: a resume is laid out where the run was, not here.
        standAway()
        useTutorialToast.setState({ offer: pubkey() })
        const chip = await mount(<TutorialToast />)
        await chip.press('START')
        const t = useTutorial.getState()
        expect(t.active).toBe(true)
        expect(t.script.steps[t.index].id).toBe(mid.id)
        expect(t.anchor).toEqual(kept)
        expect(t.doneChoices).toEqual(['agents'])
        expect(readProgress(pubkey())).toEqual({ step: mid.id, choices: ['agents'], anchor: kept })
        expect(cs().live).toBe(live)
        expect(offer()).toBe(null)
        expect(chip.says(TUTORIAL_TOAST_TEXT)).toBe(false)
        await chip.unmount()
        useTutorial.getState().pause()
      }
    })
  }

  it('START never restarts a run it is to resume, even when the resume is refused', () => {
    // A run going refuses RESUME (tutorialButtonsBlocked) but not a RESTART,
    // which would stop it and begin again from the welcome. The chip is not
    // on screen then (toastFits); pressed anyway, nothing changes.
    writeProgress(pubkey(), { step: mid.id, anchor: kept })
    useTutorial.getState().start({ at: mid.id })
    const t = useTutorial.getState()
    expect(t.script.steps[t.index].id).toBe(mid.id)
    useTutorialToast.setState({ offer: pubkey() })
    startFromTutorialToast()
    const after = useTutorial.getState()
    expect(after.active).toBe(true)
    expect(after.script.steps[after.index].id).toBe(mid.id)
    expect(after.anchor).toEqual(kept)
    expect(readProgress(pubkey())).toEqual({ step: mid.id, anchor: kept })
    useTutorial.getState().pause()
  })

  it('LATER puts it away, and the tutorial is left as it was', async () => {
    writeProgress(pubkey(), { step: 'box', ended: 'skipped' })
    useTutorialToast.setState({ offer: pubkey() })
    const chip = await mount(<TutorialToast />)
    await chip.press('LATER')
    expect(offer()).toBe(null)
    expect(chip.says(TUTORIAL_TOAST_TEXT)).toBe(false)
    expect(useTutorial.getState().active).toBe(false)
    expect(readProgress(pubkey())).toEqual({ step: 'box', ended: 'skipped' })
    expect(readToastRecord(pubkey()).shows).toBe(1)
    await chip.unmount()
  })

  it('steps aside under TV, a ride or a game, and comes back after', async () => {
    useTutorialToast.setState({ offer: pubkey() })
    const chip = await mount(<TutorialToast />)
    expect(chip.says(TUTORIAL_TOAST_TEXT)).toBe(true)
    for (const [on, off] of [
      [() => useTv.setState({ on: true }), () => useTv.setState({ on: false })],
      [() => useCyberspace.setState({ transit: {} as never }), () => useCyberspace.setState({ transit: null })],
      [() => useGame.setState({ session: {} as GameSession }), () => useGame.setState({ session: null })],
    ] as Array<[() => void, () => void]>) {
      on()
      await new Promise((r) => setTimeout(r, 5))
      expect(chip.says(TUTORIAL_TOAST_TEXT)).toBe(false)
      off()
      await new Promise((r) => setTimeout(r, 5))
      expect(chip.says(TUTORIAL_TOAST_TEXT)).toBe(true)
    }
    // Still one show for the one offer.
    expect(readToastRecord(pubkey()).shows).toBe(1)
    await chip.unmount()
  })

  it('nothing for an offer made to another identity, or for one that finished', async () => {
    useTutorialToast.setState({ offer: 'e'.repeat(64) })
    let chip = await mount(<TutorialToast />)
    expect(chip.all()).toEqual([])
    await chip.unmount()
    writeProgress(pubkey(), { step: 'choices', ended: 'finished' })
    useTutorialToast.setState({ offer: pubkey() })
    chip = await mount(<TutorialToast />)
    expect(chip.all()).toEqual([])
    await chip.unmount()
  })
})
