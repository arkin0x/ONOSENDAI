/**
 * newcomer.test.ts: the newcomer view (newcomer/useNewcomer.ts,
 * newcomer/reveal.ts, newcomer/names.ts; new-user feedback 2026-11-21):
 *
 * - a first arrival's tour makes the identity a newcomer, and each part of
 *   the screen shows once the step that introduces it has come up, in the
 *   tour's order;
 * - finishing or skipping the tour graduates it to the full HUD;
 * - an experienced player is unaffected: full HUD, today's names;
 * - Settings > Interface picks either way, per identity;
 * - the record is kept per identity (pubkey), in the kv store that lives in
 *   IndexedDB, and read back on a reload;
 * - ?newcomer=1 plays a newcomer for this tab only, never touching the
 *   stored record, and asks for a tour run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const mk = (): Storage => {
    const m = new Map<string, string>()
    return {
      get length() { return m.size },
      clear: () => m.clear(),
      getItem: (k: string) => m.get(k) ?? null,
      key: (i: number) => [...m.keys()][i] ?? null,
      removeItem: (k: string) => { m.delete(k) },
      setItem: (k: string, v: string) => { m.set(k, String(v)) },
    }
  }
  ;(globalThis as { localStorage?: Storage }).localStorage = mk()
  ;(globalThis as { sessionStorage?: Storage }).sessionStorage = mk()
})
vi.mock('../../lib/relay', async (orig) => ({ ...(await orig() as object), publish: vi.fn(async () => ({ ok: true, accepted: [] })), publishMany: vi.fn(async () => ({ ok: true, accepted: [] })), query: vi.fn(async () => []) }))
// Whether the key on screen was made on this page load: the test says (by default not).
const minted = vi.hoisted(() => ({ onLoad: false }))
vi.mock('../../store/useCyberspace', async (orig) => {
  const real = await orig<typeof import('../../store/useCyberspace')>()
  return { ...real, keyMintedOnLoad: () => (minted.onLoad ? real.useCyberspace.getState().identity.pubkey : null) }
})
vi.mock('../../hooks/useMenuOpen', async (orig) => ({ ...(await orig() as object), setMenuOpen: vi.fn() }))

import { MINTED_KEY, useCyberspace } from '../../store/useCyberspace'
import { useTutorial } from '../../store/useTutorial'
import { PROGRESS_PREFIX, noteLanding, setTutorialSwitch, takeTutorialAsk, tutorialAsked } from '../../tutorial/gate'
import { TUTORIAL_SCRIPT } from '../../tutorial/script'
import { kvGet } from '../../lib/kvStore'
import { NEWCOMER_PREFIX, loadNewcomer, readRecord, revealStateOf, setHudChoice, stepsThrough, useNewcomer, watchNewcomer } from '../useNewcomer'
import { SESSION_FLAG, applyNewcomerFlag } from '../flag'
import { REVEAL, revealed, type RevealId } from '../reveal'
import { HIDDEN_FOR_NEWCOMERS, NEWCOMER_NAMES, plainText, say } from '../names'

const A = useCyberspace.getState().identity.pubkey
const B = 'b'.repeat(64)
const steps = TUTORIAL_SCRIPT.steps
const at = (id: string): number => steps.findIndex((s) => s.id === id)
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const state = () => {
  const n = useNewcomer.getState()
  const t = useTutorial.getState()
  return revealStateOf(n.record, n.pubkey, t.active && t.pubkey === n.pubkey)
}
const shows = (id: RevealId): boolean => revealed(id, state())
/** Walk the run to a step, as entering it would (the store hears the index change). */
async function reach(id: string): Promise<void> {
  useTutorial.setState({ index: at(id) })
  await settle()
}

let stop: () => void = () => {}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  takeTutorialAsk()
  setTutorialSwitch(true)
  useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: A }, events: [], signerKind: 'local', selfCheck: { pubkey: A, status: 'none' } })
  // A key this app made on this device, with no chain, and the relays found none: a first arrival.
  localStorage.setItem(MINTED_KEY, A)
  minted.onLoad = false
  useTutorial.setState({ script: TUTORIAL_SCRIPT, active: false, pubkey: null })
  loadNewcomer(A)
  stop = watchNewcomer()
})
afterEach(() => {
  if (useTutorial.getState().active) useTutorial.getState().pause()
  stop()
})

describe('a first arrival is a newcomer, and the screen comes in step by step', () => {
  it('starts with nothing but the welcome, then each part at its step, in the tour order', async () => {
    useTutorial.getState().start()
    await settle()
    expect(useNewcomer.getState().record.stage).toBe('newcomer')
    expect(state()).toMatchObject({ newcomer: true, staged: true })
    // The welcome card alone: no pad, no menu, no compass, no chat.
    for (const id of ['pad.go', 'pad.arrows', 'menu', 'compass', 'chat', 'panel.items'] as RevealId[]) expect(shows(id)).toBe(false)

    await reach('box')
    expect(shows('pad.go')).toBe(true)
    expect(shows('pad.arrows')).toBe(false)
    expect(shows('menu')).toBe(false)

    await reach('inventory')
    expect(shows('menu')).toBe(true)
    expect(shows('panel.items')).toBe(true)
    expect(shows('panel.view')).toBe(true)
    expect(shows('pad.arrows')).toBe(false)
    expect(shows('panel.identity')).toBe(false)

    await reach('to-course')
    expect(shows('pad.arrows')).toBe(true)
    expect(shows('pad.recall')).toBe(true)
    expect(shows('compass')).toBe(true)
    expect(shows('pad.publish')).toBe(false)

    await reach('workshop')
    expect(shows('panel.create')).toBe(true)

    await reach('choice')
    for (const id of ['pad.zoom', 'pad.publish', 'chat', 'panel.identity', 'panel.controls'] as RevealId[]) expect(shows(id)).toBe(true)
    // Routes not taken yet keep their panels back; expert panels never come in.
    expect(shows('panel.hyperspace')).toBe(false)
    expect(shows('pad.modes')).toBe(false)
    expect(shows('panel.proof')).toBe(false)
    expect(shows('route')).toBe(false)

    await reach('earth-board')
    expect(shows('panel.hyperspace')).toBe(true)
  })

  it('a key made on this load, its tour about to start, is staged from the first frame: nothing shows and then goes', () => {
    minted.onLoad = true
    // The bare address, as a first arrival lands.
    noteLanding('/')
    expect(useTutorial.getState().active).toBe(false)
    expect(state()).toMatchObject({ newcomer: true, staged: true })
    expect(shows('menu')).toBe(false)
    expect(shows('pad.go')).toBe(false)
    // With the tutorial switched off, no tour is coming: the full HUD.
    setTutorialSwitch(false)
    expect(state().newcomer).toBe(false)
  })

  it('every step a part waits for is in the script, and the order of reveals follows the script', () => {
    const order = (id: string): number => at(id)
    for (const [id, step] of Object.entries(REVEAL)) {
      if (step === 'never' || step === 'always') continue
      expect(order(step), `${id} waits for ${step}`).toBeGreaterThanOrEqual(0)
    }
    // GO before the arrows, the arrows before the menu's later panels, the menu before identity.
    expect(order(REVEAL['pad.go'])).toBeLessThan(order(REVEAL['pad.arrows']))
    expect(order(REVEAL.menu)).toBeLessThan(order(REVEAL['panel.identity']))
    // The zoom comes with the arrows: the course step points at its finer key when the view is coarse.
    expect(order(REVEAL['pad.arrows'])).toBeLessThanOrEqual(order(REVEAL['pad.zoom']))
  })

  it('stamps what each step brings in, for its arrival', async () => {
    useTutorial.getState().start()
    await settle()
    await reach('box')
    expect(useNewcomer.getState().arrivals['pad.go']).toBeTypeOf('number')
    expect(useNewcomer.getState().arrivals['pad.arrows']).toBeUndefined()
  })

  it('a resume picks up what was seen: every step before the one resumed counts', () => {
    expect(stepsThrough(steps, at('to-course'))).toEqual(steps.slice(0, at('to-course') + 1).filter((s) => !s.branch).map((s) => s.id))
    // A branch step counts itself and the way through, not the other routes.
    const through = stepsThrough(steps, at('earth-board'))
    expect(through).toContain('choice')
    expect(through).toContain('earth-board')
    expect(through).not.toContain('earth')
  })

  it('finishing graduates to the full HUD with today\'s names', async () => {
    useTutorial.getState().start()
    await settle()
    await reach('box')
    useTutorial.getState().end('finished')
    await settle()
    expect(useNewcomer.getState().record.stage).toBe('graduated')
    expect(state().newcomer).toBe(false)
    for (const id of Object.keys(REVEAL) as RevealId[]) expect(shows(id)).toBe(true)
  })

  it('skipping graduates too; pausing does not', async () => {
    useTutorial.getState().start()
    await settle()
    useTutorial.getState().pause()
    await settle()
    expect(useNewcomer.getState().record.stage).toBe('newcomer')
    useTutorial.getState().start({ at: 'box' })
    await settle()
    useTutorial.getState().end('skipped')
    await settle()
    expect(useNewcomer.getState().record.stage).toBe('graduated')
  })

  it('a RESTART mid-run is not an end: the newcomer stays a newcomer', async () => {
    useTutorial.getState().start()
    await settle()
    await reach('box')
    useTutorial.getState().start({ restart: true })
    await settle()
    expect(useNewcomer.getState().record.stage).toBe('newcomer')
    // Started over: the staging starts over too.
    expect(shows('pad.go')).toBe(false)
  })
})

describe('experienced players are unaffected', () => {
  beforeEach(() => {
    // A player with a chain: not a first arrival.
    localStorage.removeItem(MINTED_KEY)
    useCyberspace.setState({ events: [{} as never] })
  })

  it('a tour run (RESTART) keeps the full HUD and today\'s names', async () => {
    useTutorial.getState().start()
    await settle()
    expect(useNewcomer.getState().record.stage).toBeUndefined()
    expect(state()).toMatchObject({ newcomer: false, staged: false })
    for (const id of Object.keys(REVEAL) as RevealId[]) expect(shows(id)).toBe(true)
  })

  it('names come back unchanged outside the newcomer view', () => {
    for (const word of Object.keys(NEWCOMER_NAMES)) expect(say(word, false)).toBe(word)
    expect(plainText('Tap COMMIT to move into the box.', false)).toBe('Tap COMMIT to move into the box.')
  })
})

describe('Settings > Interface: Show everything or Newcomer view', () => {
  it('Newcomer view for an experienced player: plain names, everything the tour teaches, no expert panels', () => {
    setHudChoice('newcomer')
    expect(state()).toMatchObject({ newcomer: true, staged: false })
    expect(shows('pad.arrows')).toBe(true)
    expect(shows('menu')).toBe(true)
    expect(shows('panel.hyperspace')).toBe(true)
    expect(shows('panel.proof')).toBe(false)
    expect(shows('proof-labels')).toBe(false)
  })

  it('Newcomer view turned on mid-tour shows at once everything the step needs, never less', async () => {
    localStorage.removeItem(MINTED_KEY)
    useCyberspace.setState({ events: [{} as never] })
    useTutorial.getState().start()
    await settle()
    await reach('to-course')
    expect(state().newcomer).toBe(false)
    setHudChoice('newcomer')
    expect(state()).toMatchObject({ newcomer: true, staged: true })
    for (const id of ['pad.go', 'pad.arrows', 'pad.recall', 'menu'] as RevealId[]) expect(shows(id), id).toBe(true)
  })

  it('a newcomer who turns the tutorial off gets the full HUD back, and it returns with the switch', async () => {
    useTutorial.getState().start()
    await settle()
    useTutorial.getState().pause()
    expect(state().newcomer).toBe(true)
    setTutorialSwitch(false)
    expect(state().newcomer).toBe(false)
    expect(shows('panel.scale')).toBe(true)
    setTutorialSwitch(true)
    expect(state().newcomer).toBe(true)
  })

  it('Show everything for a newcomer mid-tour: the full HUD at once, and it holds', async () => {
    useTutorial.getState().start()
    await settle()
    expect(state().newcomer).toBe(true)
    setHudChoice('everything')
    expect(state().newcomer).toBe(false)
    expect(shows('pad.arrows')).toBe(true)
    await reach('box')
    expect(state().newcomer).toBe(false)
  })
})

describe('kept per identity, in IndexedDB (the kv store)', () => {
  it('each pubkey has its own record, under its own key, read back on a reload', async () => {
    useTutorial.getState().start()
    await settle()
    await reach('box')
    const stored = JSON.parse(kvGet(NEWCOMER_PREFIX + A) ?? 'null')
    expect(stored).toMatchObject({ stage: 'newcomer' })
    expect(stored.seen).toContain('box')
    useTutorial.getState().pause()
    // Another identity on this device: its own (empty) record, the full HUD.
    useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: B } })
    expect(useNewcomer.getState().pubkey).toBe(B)
    expect(useNewcomer.getState().record).toEqual({ seen: [] })
    setHudChoice('newcomer')
    expect(JSON.parse(kvGet(NEWCOMER_PREFIX + B) ?? 'null')).toMatchObject({ choice: 'newcomer' })
    // Back: A's record as it was (a reload reads the same).
    useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: A } })
    expect(useNewcomer.getState().record.stage).toBe('newcomer')
    expect(readRecord(A).seen).toContain('box')
    expect(readRecord(A).choice).toBeUndefined()
  })

  it('the record\'s prefix is one the kv store moves to IndexedDB', async () => {
    const { movesToKv } = await import('../../lib/kvStore')
    expect(movesToKv(NEWCOMER_PREFIX + A)).toBe(true)
  })
})

describe('?newcomer=1: a newcomer for this tab only', () => {
  it('plays a fresh newcomer, asks for a run, leaves the stored record alone, and =0 ends it', async () => {
    // A graduated player.
    localStorage.setItem(NEWCOMER_PREFIX + A, JSON.stringify({ stage: 'graduated', seen: ['welcome', 'box'] }))
    const replaced: string[] = []
    const history = { state: null, replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { replaced.push(String(url)) } }
    expect(applyNewcomerFlag({ pathname: '/', search: '?newcomer=1&x=2', hash: '' }, history)).toBe(true)
    expect(replaced.pop()).toBe('/?x=2')
    expect(sessionStorage.getItem(SESSION_FLAG)).toBe('1')
    expect(tutorialAsked()).toBe(true)
    loadNewcomer(A)
    expect(useNewcomer.getState().record).toEqual({ stage: 'newcomer', seen: [] })
    setHudChoice('everything')
    // Written for the tab, not over the stored record.
    expect(JSON.parse(localStorage.getItem(NEWCOMER_PREFIX + A) ?? 'null')).toEqual({ stage: 'graduated', seen: ['welcome', 'box'] })
    expect(applyNewcomerFlag({ pathname: '/', search: '?newcomer=0', hash: '' }, history)).toBe(false)
    loadNewcomer(A)
    expect(useNewcomer.getState().record.stage).toBe('graduated')
  })
})

describe('the copy', () => {
  it('swaps whole button words in the tour\'s lines, and nothing else', () => {
    expect(plainText('Tap COMMIT to move into the box.', true)).toBe('Tap GO to move into the box.')
    expect(plainText('Open the menu. Your trip is at the top. Tap BOARD.', true)).toBe('Open the menu. Your trip is at the top. Tap GET ON.')
    expect(plainText('HOPs are the basic way to commit a move.', true)).toBe('HOPs are the basic way to commit a move.')
  })

  it('has no em dash and no jargon left in what a newcomer reads', () => {
    const all = [...Object.values(NEWCOMER_NAMES), ...HIDDEN_FOR_NEWCOMERS].join(' ')
    expect(all).not.toMatch(/\u2014/)
    for (const word of Object.values(NEWCOMER_NAMES)) expect(word).not.toMatch(/COMMIT|RECALL|PAIRS|cantor/i)
  })

  it('a progress record from before the newcomer view leaves the player experienced', () => {
    localStorage.setItem(PROGRESS_PREFIX + A, JSON.stringify({ step: 'box' }))
    expect(readRecord(A)).toEqual({ seen: [] })
  })
})
