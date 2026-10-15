/**
 * demo.test.ts - the /demo tour (arkinox, 2026-10-14): the script is well
 * formed, the engine walks it and puts LOCAL/LIVE and the view back, the
 * voice picker prefers a professorly male voice, and waiting steps notice
 * a hop and a scan.
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

import type { NostrEvent } from 'nostr-tools'
import { useCyberspace } from '../useCyberspace'
import { PREV_LIVE_KEY, SESSION_KEY, TOUR_KEY_KEY, gateHeld, hadHopsAtStart, restoreAfterUnfinishedTour, startTourInPlace, tourKeyNeedsSpawn, useDemo, watchAction } from '../useDemo'
import { startCoordRoute, useCoordRoute } from '../useCoordRoute'
import { useShards } from '../useShards'
import { DEMO_CURATORS, DEMO_DISTRICT, DEMO_SCRIPT, GENESIS_ROOT } from '../../demo/script'
import { planeOfMerkleRoot, stopCoordExact, stopFromAnchor } from '../../lib/hyperspace/stops'
import { PREFERRED_VOICES, pickVoice } from '../../demo/voice'
import { parseDemoRoute } from '../../lib/demoRoute'
import { captionFor } from '../../hud/DemoCoach'
import { lineSource, nextStation, stepLine, type LineWalk } from '../../demo/hyperLine'
import { TOUR_BLOCKS } from '../../demo/tourBlocks'
import { useLayers } from '../useLayers'
import { useChat } from '../useChat'
import { useAvatars } from '../useAvatars'
import { avatarDraw } from '../../lib/avatar'
import { newShard } from 'sno-core/shards'
import { coordPlace } from '../../lib/coordRoute'
import { useHyperspace } from '../useHyperspace'
import { useToast } from '../useToast'
import { useCeremony } from '../useCeremony'

beforeEach(() => {
  if (useDemo.getState().active) useDemo.getState().exit()
  localStorage.removeItem(PREV_LIVE_KEY)
  useCyberspace.getState().clearFocus()
  useCyberspace.getState().setLive(false)
})

describe('the script', () => {
  it('has unique step ids, known chapters, every chapter reached, and short plain captions', () => {
    // arkinox's own wording runs to five sentences on a few steps (2026-10-15).
    const ids = DEMO_SCRIPT.steps.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    const chapters = new Set(DEMO_SCRIPT.chapters.map((c) => c.id))
    for (const s of DEMO_SCRIPT.steps) {
      expect(chapters.has(s.chapter), s.id).toBe(true)
      expect(s.title.length, s.id).toBeGreaterThan(0)
      for (const text of [s.caption, s.captionNew, s.captionWaiting, s.captionReturning].filter((t): t is string => !!t)) {
        expect(text.length, s.id).toBeGreaterThan(20)
        expect(text.length, s.id).toBeLessThan(360)
        expect(text, s.id).not.toMatch(/—/) // no em dashes
        const sentences = text.split(/[.!?](\s|$)/).filter((x) => x.trim().length > 1).length
        expect(sentences, s.id).toBeLessThanOrEqual(5)
        // The voice reads "id" as a word; the captions say ID (arkinox, 2026-10-15).
        expect(text, s.id).not.toMatch(/\bids?\b/)
      }
      if (s.wait) expect(s.hint, s.id).toBeTruthy()
      if (s.gate) expect(s.wait, s.id).toBeTruthy()
    }
    for (const c of DEMO_SCRIPT.chapters) expect(DEMO_SCRIPT.steps.some((s) => s.chapter === c.id), c.id).toBe(true)
    // Chapters appear in order, each in one run.
    const order = DEMO_SCRIPT.steps.map((s) => s.chapter).filter((c, i, a) => i === 0 || a[i - 1] !== c)
    expect(order).toEqual(DEMO_SCRIPT.chapters.map((c) => c.id))
  })

  it('names a real coordinate for the demo district', () => {
    expect(DEMO_DISTRICT.coord).toMatch(/^[0-9a-f]{64}$/)
    expect(coordPlace(DEMO_DISTRICT.coord).plane).toBe(1)
  })

  it('shows a brand-new identity its own caption where one is written', () => {
    const event = DEMO_SCRIPT.steps.find((s) => s.id === 'event')!
    expect(captionFor(event, false)).toBe(event.captionNew)
    expect(captionFor(event, true)).toBe(event.caption)
    const verify = DEMO_SCRIPT.steps.find((s) => s.id === 'verify')!
    expect(captionFor(verify, true, false)).toBe(verify.captionWaiting)
    expect(captionFor(verify, true, true)).toBe(verify.caption)
  })

  it("keeps arkinox's 2026-10-15 wording", () => {
    const at = (id: string) => DEMO_SCRIPT.steps.find((s) => s.id === id)!
    expect(DEMO_SCRIPT.chapters[0].title).toBe('Identity is location')
    expect(DEMO_SCRIPT.steps.slice(0, 4).map((s) => s.id)).toEqual(['welcome', 'everything', 'spawn', 'identity'])
    expect(at('everything').scene).toEqual({ target: 'self', scale: 84 })
    expect(at('welcome').caption).not.toMatch(/LOCAL/)
    expect(at('event').caption).toMatch(/^Everything in cyberspace is a Nostr event:/)
    expect(at('relays').caption).toMatch(/the union of all cyberspace events/)
    expect(at('kinds').caption).toMatch(/hyperspace block anchors/)
    expect(at('chain').caption).toMatch(/Controls panel in the bottom right/)
  })
})

describe('the route', () => {
  it('reads /demo and /demo/<step>, and nothing else', () => {
    expect(parseDemoRoute('/demo')).toBe('')
    expect(parseDemoRoute('/demo/')).toBe('')
    expect(parseDemoRoute('/DEMO/Hop')).toBe('hop')
    expect(parseDemoRoute('/')).toBeNull()
    expect(parseDemoRoute('/demolition')).toBeNull()
    expect(parseDemoRoute('/C/abc')).toBeNull()
  })
})

/**
 * An identity the tour did not generate: this test run made its own key on
 * load, as a first /demo visit does, so the existing-identity rules are run
 * under another pubkey.
 */
const OTHER_PUBKEY = 'ab'.repeat(32)
function asExistingIdentity(fn: () => void): void {
  const identity = useCyberspace.getState().identity
  useCyberspace.setState({ identity: { ...identity, pubkey: OTHER_PUBKEY } })
  try { fn() } finally {
    if (useDemo.getState().active) useDemo.getState().exit()
    useCyberspace.setState({ identity })
  }
}

describe('the engine', () => {
  it('forces LOCAL on entry and puts LIVE back on exit (an existing identity)', () => asExistingIdentity(() => {
    useCyberspace.getState().setLive(true)
    useDemo.getState().start()
    expect(useCyberspace.getState().live).toBe(false)
    useDemo.getState().exit()
    expect(useCyberspace.getState().live).toBe(true)
  }))

  it('leaves LIVE on when the visitor went LIVE in the tour', () => {
    useDemo.getState().start()
    useDemo.getState().wentLive()
    useCyberspace.getState().setLive(true)
    useDemo.getState().exit()
    expect(useCyberspace.getState().live).toBe(true)
  })

  it('walks next and back within the script, and starts on a named step', () => {
    const d = useDemo.getState()
    d.start()
    expect(useDemo.getState().index).toBe(0)
    d.back()
    expect(useDemo.getState().index).toBe(0)
    d.next(); d.next()
    expect(useDemo.getState().index).toBe(2)
    d.goTo(DEMO_SCRIPT.steps.length - 1)
    d.next()
    expect(useDemo.getState().index).toBe(DEMO_SCRIPT.steps.length - 1)
    d.exit()
    d.start('district')
    expect(DEMO_SCRIPT.steps[useDemo.getState().index].id).toBe('district')
    expect(useDemo.getState().done).toBe(false)
  })

  it('sends the removed hop steps\' old links to no-cheat (2026-10-15)', () => {
    expect(DEMO_SCRIPT.steps.some((s) => s.id === 'hop' || s.id === 'hop-event')).toBe(false)
    for (const old of ['hop', 'hop-event']) {
      useDemo.getState().exit()
      useDemo.getState().start(old)
      expect(DEMO_SCRIPT.steps[useDemo.getState().index].id).toBe('no-cheat')
    }
    expect(DEMO_SCRIPT.steps.filter((s) => s.chapter === 'work').map((s) => s.id)).toEqual(['cantor', 'lca', 'no-cheat', 'walk'])
    expect(DEMO_SCRIPT.steps.find((s) => s.id === 'no-cheat')!.caption).toMatch(/^The proof travels in each hop event's tags\. Many small steps/)
  })

  it('previews the region of a hop 5 gibsons up on the cantor step, and brings the cursor home after', () => {
    const before = useCyberspace.getState().events.length
    useDemo.getState().start('cantor')
    const cs = useCyberspace.getState()
    const axes = cs.screenAxes ?? cs.axes()
    expect(cs.cursor[axes.up.axis] - cs.position[axes.up.axis]).toBe(5n * BigInt(axes.up.dir))
    expect(cs.proof.status).not.toBe('computing') // a preview: nothing is proved or signed
    expect(cs.events.length).toBe(before)
    useDemo.getState().next() // lca: your own position
    expect(useCyberspace.getState().cursor).toEqual(useCyberspace.getState().position)
  })

  it('views your spawn on the spawn step, and comes home on exit', () => {
    useDemo.getState().start('spawn')
    const cs = useCyberspace.getState()
    expect(cs.focus?.label).toBe('YOUR SPAWN')
    expect(cs.focus?.position).toEqual(coordPlace(cs.identity.pubkey).position)
    useDemo.getState().exit()
    expect(useCyberspace.getState().focus).toBeNull()
  })

  it('flies to the demo district', () => {
    useDemo.getState().start('district')
    expect(useCyberspace.getState().focus?.label).toBe(DEMO_DISTRICT.label)
    expect(useCyberspace.getState().focus?.position).toEqual(coordPlace(DEMO_DISTRICT.coord).position)
  })
})

describe('leaving a step cleanly (rehearsal, 2026-10-15)', () => {
  it('ends the hyperspace stop view and brings the cursor home on a step at your own position', () => {
    useDemo.getState().start('ride')
    const cs = useCyberspace.getState()
    const far = { x: cs.position.x + 1000n, y: cs.position.y, z: cs.position.z }
    // As a block step leaves it: the stop view owned, the focus on the stop, the cursor out there.
    useHyperspace.setState({ viewOwned: true, returnScaleExp: cs.scaleExp, returnFocus: null })
    useCyberspace.getState().focusOn(far, cs.headPlane, 'BLOCK 900000 · LANDFALL')
    useCyberspace.setState({ cursor: far })
    useDemo.getState().next() // avatars: your own position
    expect(useHyperspace.getState().viewOwned).toBe(false)
    const after = useCyberspace.getState()
    expect(after.focus).toBeNull()
    expect(after.cursor).toEqual(after.position)
  })

  it("takes down a block step's own toast when the step ends, and no other", () => {
    useDemo.getState().start('port')
    useToast.getState().show({ label: 'Block 900,001 · port', meta: 'm', mark: 'place', sticky: true })
    useDemo.getState().next()
    expect(useToast.getState().toast).toBeNull()
    useToast.getState().show({ label: 'Something else', meta: 'm', mark: 'place', sticky: true })
    useDemo.getState().next()
    expect(useToast.getState().toast?.label).toBe('Something else')
    useToast.getState().dismiss()
  })

  it('keeps WALK on the walk step only', () => {
    useDemo.getState().start('walk')
    useCyberspace.setState({ walking: true })
    useDemo.getState().goTo(useDemo.getState().index) // the walk step again: stays walking
    expect(useCyberspace.getState().walking).toBe(true)
    useDemo.getState().next() // region-keys: your own position, out of first person
    expect(useCyberspace.getState().walking).toBe(false)
  })
})

describe('LIVE survives a reload mid-tour (rehearsal, 2026-10-15)', () => {
  it('a reload during the tour still puts LIVE back on exit (an existing identity)', () => asExistingIdentity(() => {
    useCyberspace.getState().setLive(true)
    useDemo.getState().start()
    expect(useCyberspace.getState().live).toBe(false)
    // The reload: the page forgets the tour, the device keeps LOCAL and the key.
    useDemo.setState({ active: false, prevLive: false })
    useDemo.getState().start('spawn')
    useDemo.getState().exit()
    expect(useCyberspace.getState().live).toBe(true)
    expect(localStorage.getItem(PREV_LIVE_KEY)).toBeNull()
  }))

  it('a tour left without EXIT puts LIVE back on the next ordinary visit, once (an existing identity)', () => asExistingIdentity(() => {
    useCyberspace.getState().setLive(true)
    useDemo.getState().start()
    useDemo.setState({ active: false }) // the tab closed mid-tour
    expect(useCyberspace.getState().live).toBe(false)
    restoreAfterUnfinishedTour()
    expect(useCyberspace.getState().live).toBe(true)
    useCyberspace.getState().setLive(false)
    restoreAfterUnfinishedTour() // nothing left to restore
    expect(useCyberspace.getState().live).toBe(false)
  }))
})

describe('waiting for the visitor', () => {
  it('notices a new hop on your own chain, and nothing else', () => {
    const done = vi.fn()
    const before = useCyberspace.getState().events
    const stop = watchAction('hop', done)
    const fake = (a: string, n: number): NostrEvent => ({ id: String(n).repeat(64).slice(0, 64), pubkey: 'p', created_at: n, kind: 3333, tags: [['A', a]], content: '', sig: '' })
    useCyberspace.setState({ events: [...before, fake('enter-hyperspace', 1)] })
    expect(done).not.toHaveBeenCalled()
    useCyberspace.setState({ events: [...before, fake('enter-hyperspace', 1), fake('hop', 2)] })
    expect(done).toHaveBeenCalledTimes(1)
    stop()
    useCyberspace.setState({ events: before })
  })

  it('counts a scan only once it has started and finished', () => {
    useShards.setState({ scanning: false })
    const done = vi.fn()
    const stop = watchAction('scan', done)
    useShards.setState({ scanning: false })
    expect(done).not.toHaveBeenCalled()
    useShards.setState({ scanning: true })
    expect(done).not.toHaveBeenCalled()
    useShards.setState({ scanning: false })
    expect(done).toHaveBeenCalledTimes(1)
    stop()
  })

  it('marks a waiting step done in the engine', () => {
    useShards.setState({ scanning: false })
    useDemo.getState().start('district')
    expect(useDemo.getState().done).toBe(false)
    useShards.setState({ scanning: true })
    useShards.setState({ scanning: false })
    expect(useDemo.getState().done).toBe(true)
  })
})

describe('the voice', () => {
  const v = (name: string, lang = 'en-US') => ({ name, lang })

  it('takes the preferred voices in order', () => {
    expect(pickVoice([v('Google UK English Male', 'en-GB'), v('Microsoft David - English'), v('Samantha')])?.name).toBe('Microsoft David - English')
    expect(pickVoice([v('Alex'), v('Daniel', 'en-GB')])?.name).toBe('Daniel')
    expect(pickVoice([v('Microsoft Guy Online (Natural) - English (United States)'), v('Microsoft Andrew Online')])?.name).toMatch(/^Microsoft Guy/)
    expect(PREFERRED_VOICES[0]).toBe('Microsoft Guy Online (Natural)')
  })

  it('falls back to an English voice that sounds male, then to the default', () => {
    expect(pickVoice([v('Thomas', 'fr-FR'), v('Fred', 'en-US'), v('Samantha')])?.name).toBe('Fred')
    expect(pickVoice([v('Samantha'), v('Karen', 'en-AU')])).toBeNull()
  })

  it('picks a male voice on each platform it knows (2026-10-15)', () => {
    // Edge on Windows: the Online (Natural) voices.
    expect(pickVoice([v('Microsoft Aria Online (Natural) - English (United States)'), v('Microsoft Christopher Online (Natural) - English (United States)'), v('Microsoft David - English (United States)')])?.name).toMatch(/Christopher/)
    expect(pickVoice([v('Microsoft Sonia Online (Natural) - English (United Kingdom)', 'en-GB'), v('Microsoft Ryan Online (Natural) - English (United Kingdom)', 'en-GB')])?.name).toMatch(/Ryan/)
    // Chrome on Windows: the installed voices and Google's.
    expect(pickVoice([v('Microsoft Zira - English (United States)'), v('Microsoft Mark - English (United States)'), v('Google US English'), v('Google UK English Female', 'en-GB'), v('Google UK English Male', 'en-GB')])?.name).toMatch(/Mark/)
    // Chrome on macOS or Linux: Google UK English Male over the female ones.
    expect(pickVoice([v('Google US English'), v('Google UK English Female', 'en-GB'), v('Google UK English Male', 'en-GB')])?.name).toBe('Google UK English Male')
    // iOS and macOS Safari.
    expect(pickVoice([v('Samantha'), v('Karen', 'en-AU'), v('Aaron'), v('Arthur', 'en-GB')])?.name).toBe('Aaron')
    expect(pickVoice([v('Samantha'), v('Daniel (Enhanced)', 'en-GB')])?.name).toBe('Daniel (Enhanced)')
    // Android, where Google's voices are named by code.
    expect(pickVoice([v('en-us-x-sfg-local'), v('en-us-x-iom-local')])?.name).toBe('en-us-x-iom-local')
    // Android Chrome naming voices only by language: the default reads.
    expect(pickVoice([v('English United States'), v('English United Kingdom', 'en-GB')])).toBeNull()
  })

  it('matches whole names, and only English voices', () => {
    expect(pickVoice([v('Alexandra'), v('Samantha')])).toBeNull()
    expect(pickVoice([v('Daniel', 'fr-FR'), v('Samantha')])).toBeNull()
    expect(pickVoice([v('Microsoft Davis Online (Natural) - English (United States)')])?.name).toMatch(/Davis/)
  })
})

describe('the gates (arkinox, 2026-10-15)', () => {
  const pubkey = () => useCyberspace.getState().identity.pubkey
  const fake = (a: string, n: number): NostrEvent => ({ id: String(n % 10).repeat(64), pubkey: pubkey(), created_at: n, kind: 3333, tags: [['A', a]], content: '', sig: '' })
  const stepIndex = (id: string) => DEMO_SCRIPT.steps.findIndex((s) => s.id === id)
  let saved: NostrEvent[] = []
  beforeEach(() => {
    saved = useCyberspace.getState().events
    useCyberspace.setState({ events: [] })
    localStorage.removeItem(TOUR_KEY_KEY)
  })
  afterEach(() => {
    if (useDemo.getState().active) useDemo.getState().exit()
    useCyberspace.setState({ events: saved })
  })

  it('never signs a spawn on its own: starting the tour on a fresh tour key signs nothing', () => {
    // This test run generated its key on load, as a first /demo visit does.
    useDemo.getState().start()
    expect(localStorage.getItem(TOUR_KEY_KEY)).toBe(pubkey())
    expect(tourKeyNeedsSpawn()).toBe(true)
    useDemo.getState().goTo(stepIndex('event'))
    expect(useCyberspace.getState().events).toHaveLength(0)
  })

  it('offers SPAWN to the tour key and holds NEXT until it is signed', async () => {
    useDemo.getState().start('event')
    expect(useDemo.getState().done).toBe(false)
    useDemo.getState().next()
    expect(DEMO_SCRIPT.steps[useDemo.getState().index].id).toBe('event')
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'none' } })
    expect(await useCyberspace.getState().signSpawn()).toBe(true)
    const events = useCyberspace.getState().events
    expect(events).toHaveLength(1)
    expect(events[0].tags.find((t) => t[0] === 'A')?.[1]).toBe('spawn')
    expect(useDemo.getState().done).toBe(true)
    expect(useCyberspace.getState().live).toBe(false)
    useDemo.getState().next()
    expect(DEMO_SCRIPT.steps[useDemo.getState().index].id).toBe('verify')
  })

  it('never offers SPAWN to an identity the tour did not generate', () => {
    useDemo.getState().start()
    localStorage.removeItem(TOUR_KEY_KEY) // a key that was already on the device, or a login
    useDemo.getState().goTo(stepIndex('event'))
    expect(tourKeyNeedsSpawn()).toBe(false)
    expect(useDemo.getState().done).toBe(true)
    useDemo.getState().next()
    expect(DEMO_SCRIPT.steps[useDemo.getState().index].id).toBe('verify')
    expect(useCyberspace.getState().events).toHaveLength(0)
  })

  it('verify: with no hop, aims the cursor 3 gibsons up, right and forward and holds NEXT until a hop', () => {
    useCyberspace.setState({ events: [fake('spawn', 1)] })
    useDemo.getState().start('verify')
    const cs = useCyberspace.getState()
    expect(useDemo.getState().done).toBe(false)
    expect(cs.scaleExp).toBe(0)
    const axes = cs.screenAxes ?? cs.axes()
    const off = (a: 'x' | 'y' | 'z') => cs.cursor[a] - cs.position[a]
    expect(off(axes.up.axis)).toBe(3n * BigInt(axes.up.dir))
    expect(off(axes.right.axis)).toBe(3n * BigInt(axes.right.dir))
    expect(off(axes.out.axis)).toBe(-3n * BigInt(axes.out.dir)) // forward is into the screen
    useDemo.getState().next()
    expect(DEMO_SCRIPT.steps[useDemo.getState().index].id).toBe('verify')
    useCyberspace.setState({ events: [fake('spawn', 1), fake('hop', 2)] })
    expect(useDemo.getState().done).toBe(true)
    useDemo.getState().next()
    expect(DEMO_SCRIPT.steps[useDemo.getState().index].id).toBe('relays')
  })

  it('verify: a chain that already holds a hop is not held, and the cursor stays', () => {
    useCyberspace.setState({ events: [fake('spawn', 1), fake('hop', 2)] })
    useDemo.getState().start('verify')
    const cs = useCyberspace.getState()
    expect(useDemo.getState().done).toBe(true)
    expect(cs.cursor).toEqual(cs.position)
  })

  it('chain: for a newcomer, holds NEXT until a new move is made on the step, and remembers it on the way back', () => {
    // Came in with no hops: the verify step's hop is the first.
    useCyberspace.setState({ events: [fake('spawn', 1)] })
    useDemo.getState().start('verify')
    useCyberspace.setState({ events: [fake('spawn', 1), fake('hop', 2)] })
    useDemo.getState().goTo(stepIndex('chain'))
    expect(useDemo.getState().done).toBe(false)
    expect(gateHeld(DEMO_SCRIPT.steps[useDemo.getState().index], false)).toBe(true)
    useDemo.getState().next()
    expect(DEMO_SCRIPT.steps[useDemo.getState().index].id).toBe('chain')
    useCyberspace.setState({ events: [fake('spawn', 1), fake('hop', 2), fake('hop', 3)] })
    expect(useDemo.getState().done).toBe(true)
    useDemo.getState().next()
    useDemo.getState().back()
    expect(DEMO_SCRIPT.steps[useDemo.getState().index].id).toBe('chain')
    expect(useDemo.getState().done).toBe(true)
  })

  it('chain: an identity that came in with hops of its own may go on at once, and a reload mid-tour keeps that', () => {
    useCyberspace.setState({ events: [fake('spawn', 1), fake('hop', 2)] })
    useDemo.getState().start('chain')
    expect(useDemo.getState().done).toBe(false) // still an invitation to move
    expect(gateHeld(DEMO_SCRIPT.steps[useDemo.getState().index], false)).toBe(false)
    useDemo.getState().next()
    expect(DEMO_SCRIPT.steps[useDemo.getState().index].id).toBe('portable')
    // The reload: the page forgets the tour, the device keeps its answers.
    useDemo.setState({ active: false })
    useDemo.getState().start('chain')
    expect(hadHopsAtStart()).toBe(true)
    useDemo.getState().next()
    expect(DEMO_SCRIPT.steps[useDemo.getState().index].id).toBe('portable')
  })

  it('shows ideaspace on the cube step and puts your own plane back after', () => {
    useDemo.getState().start('cube')
    expect(useCyberspace.getState().plane).toBe(1)
    useDemo.getState().next() // planes: Earth, in dataspace
    expect(useCyberspace.getState().focus?.label).toBe('EARTH')
    expect(useCyberspace.getState().focus?.plane ?? useCyberspace.getState().anchorPlane).toBe(0)
    useDemo.getState().next() // cantor: your own position and plane
    const cs = useCyberspace.getState()
    expect(cs.focus).toBeNull()
    expect(cs.plane).toBe(cs.headPlane)
    expect(cs.anchorPlane).toBe(cs.headPlane)
  })
})

describe('the hyperspace line (arkinox, 2026-10-15)', () => {
  it('steps one block at a time and turns around at either end', () => {
    let w: LineWalk = { height: 3, dir: 1 }
    const seen: number[] = []
    for (let i = 0; i < 8; i++) { w = stepLine(w, 0, 4); seen.push(w.height) }
    expect(seen).toEqual([4, 3, 2, 1, 0, 1, 2, 3])
    expect(stepLine({ height: 0, dir: -1 }, 0, 10)).toEqual({ height: 1, dir: 1 })
    expect(stepLine({ height: 10, dir: 1 }, 0, 10)).toEqual({ height: 9, dir: -1 })
    expect(stepLine({ height: 7, dir: 1 }, 7, 7)).toEqual({ height: 7, dir: 1 })
  })

  it('skips blocks with no station in the plane on show, and gives up when there is none', () => {
    const ports = new Set([2, 5])
    let w: LineWalk | null = { height: 2, dir: 1 }
    const seen: number[] = []
    for (let i = 0; i < 4; i++) { w = nextStation(w!, 0, 6, (h) => ports.has(h)); seen.push(w!.height) }
    expect(seen).toEqual([5, 2, 5, 2])
    expect(nextStation({ height: 0, dir: 1 }, 0, 6, () => false)).toBeNull()
  })

  it('falls back to the 200 bundled real blocks when the line has not synced', () => {
    const src = lineSource()
    expect(src.bundled).toBe(true)
    expect([src.lo, src.hi]).toEqual([900000, 900199])
    expect(src.stop(900000)?.kind).toBe('landfall')
    expect(src.stop(900001)?.kind).toBe('port')
    expect(src.stop(900001)?.merkleRoot).toBe('529d6e345c8038cc946df1da49c07e0e3cd242b88ed5576cb35fd763fd9f1c37')
    expect(TOUR_BLOCKS).toHaveLength(200)
  })

  it('draws the line in ideaspace at 2^84 on the line and ride steps only', () => {
    const on = DEMO_SCRIPT.steps.filter((s) => s.scene.hyperline).map((s) => s.id)
    expect(on).toEqual(['line', 'ride'])
    for (const id of on) expect(DEMO_SCRIPT.steps.find((s) => s.id === id)!.scene).toMatchObject({ scale: 84, plane: 1 })
  })
})

describe('the menu step (arkinox, 2026-10-15)', () => {
  it('opens chapter 10, before recap, pointing at the menu button without opening it', () => {
    const ids = DEMO_SCRIPT.steps.filter((s) => s.chapter === 'yours').map((s) => s.id)
    expect(ids).toEqual(['menu', 'recap', 'live'])
    const menu = DEMO_SCRIPT.steps.find((s) => s.id === 'menu')!
    expect(menu.caption).toBe('There are many useful panels in the menu. Each includes an EXPLAIN button to help you learn more.')
    expect(menu.scene.highlight).toBe('.hamburger-menu')
    expect(menu.wait).toBeUndefined()
    expect(menu.gate).toBeUndefined()
    useDemo.getState().start('menu')
    expect(DEMO_SCRIPT.steps[useDemo.getState().index].id).toBe('menu')
    useDemo.getState().next()
    expect(DEMO_SCRIPT.steps[useDemo.getState().index].id).toBe('recap')
  })
})

/** Every step's zoom (arkinox, 2026-10-15: 2^0 unless the step exists to show something bigger). */
const ZOOM: Record<string, number> = {
  welcome: 0, everything: 84, spawn: 0, identity: 0,
  event: 0, verify: 0, relays: 0, kinds: 0, chain: 0, portable: 0,
  gibson: 0, human: 34, cube: 84, planes: 54,
  cantor: 0, lca: 0, 'no-cheat': 0, walk: 0,
  'region-keys': 0, district: 8, found: 8, chalk: 0,
  'key-item': 0, chest: 0, 'item-feed': 0,
  line: 84, port: 0, landfall: 52, ride: 84,
  avatars: 0, presence: 0, chat: 0,
  agents: 0, operator: 0, xor: 0,
  menu: 0, recap: 0, live: 0,
}

describe('the zoom (arkinox, 2026-10-15)', () => {
  it('every step sets its own zoom on entry, as the table says', () => {
    expect(Object.keys(ZOOM).sort()).toEqual(DEMO_SCRIPT.steps.map((s) => s.id).sort())
    useDemo.getState().start()
    for (let i = 0; i < DEMO_SCRIPT.steps.length; i++) {
      // From somewhere else each time, so nothing carries over.
      useCyberspace.getState().adjustScale(17 - useCyberspace.getState().scaleExp)
      useDemo.getState().goTo(i)
      const id = DEMO_SCRIPT.steps[i].id
      expect(DEMO_SCRIPT.steps[i].scene.scale, id).toBe(ZOOM[id])
      expect(useCyberspace.getState().scaleExp, id).toBe(ZOOM[id])
    }
  })

  for (const plane of [0, 1] as const) {
    it(`starts at 2^0 in the plane the identity stands in (${plane ? 'ideaspace' : 'dataspace'}), from another plane and zoom`, () => asExistingIdentity(() => {
      const cs = useCyberspace.getState()
      // Before the tour: the head in `plane`, the other plane lined up and shown, zoomed out.
      useCyberspace.setState({ headPlane: plane, plane: plane === 0 ? 1 : 0, anchorPlane: plane === 0 ? 1 : 0, scaleExp: 30, cursor: { ...cs.position, x: cs.position.x + 9n } })
      useDemo.getState().start()
      const now = useCyberspace.getState()
      expect(now.scaleExp).toBe(0)
      expect(now.plane).toBe(plane)
      expect(now.anchorPlane).toBe(plane)
      expect(now.cursor).toEqual(now.position)
      expect(now.focus).toBeNull()
      useDemo.getState().exit()
      // EXIT puts the zoom back; the scene stays in the identity's own plane.
      expect(useCyberspace.getState().scaleExp).toBe(30)
      expect(useCyberspace.getState().anchorPlane).toBe(plane)
    }))
  }
})

describe('what the tour puts back (arkinox, 2026-10-15)', () => {
  const stepIndex = (id: string) => DEMO_SCRIPT.steps.findIndex((s) => s.id === id)
  it('EXIT puts back the zoom, the scene layers and the chat dock the tour changed', () => {
    useLayers.getState().setLayer('boxes', false)
    useChat.getState().setOpen(false)
    useCyberspace.getState().adjustScale(20 - useCyberspace.getState().scaleExp)
    useDemo.getState().start('cantor') // boxes on
    expect(useLayers.getState().boxes).toBe(true)
    useDemo.getState().goTo(stepIndex('chat')) // chat open
    expect(useChat.getState().open).toBe(true)
    useDemo.getState().exit()
    expect(useCyberspace.getState().scaleExp).toBe(20)
    expect(useLayers.getState().boxes).toBe(false)
    expect(useChat.getState().open).toBe(false)
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    useLayers.getState().setLayer('boxes', true)
  })

  it('a custom avatar is never replaced: same shard at every step, drawn as itself at 2^0, and after EXIT', () => {
    const me = useCyberspace.getState().identity.pubkey
    const shard = newShard('me')
    shard.vertices = [{ p: [0, 0, 0], c: [0, 0.9, 1] }, { p: [1, 0, 0], c: [0, 0.9, 1] }, { p: [0, 1, 0], c: [0, 0.9, 1] }]
    shard.faces = [[0, 1, 2]]
    useAvatars.setState({ shards: { ...useAvatars.getState().shards, [me]: shard } })
    useCyberspace.getState().adjustScale(-useCyberspace.getState().scaleExp)
    useDemo.getState().start()
    for (let i = 0; i < DEMO_SCRIPT.steps.length; i++) {
      useDemo.getState().goTo(i)
      const id = DEMO_SCRIPT.steps[i].id
      expect(useAvatars.getState().shards[me], id).toBe(shard)
      if (ZOOM[id] === 0) expect(avatarDraw(shard, useCyberspace.getState().scaleExp), id).not.toBe('marker')
    }
    useDemo.getState().goTo(DEMO_SCRIPT.steps.length - 1)
    useDemo.getState().exit()
    expect(useAvatars.getState().shards[me]).toBe(shard)
    expect(avatarDraw(shard, useCyberspace.getState().scaleExp)).not.toBe('marker')
    const { [me]: _gone, ...rest } = useAvatars.getState().shards
    useAvatars.setState({ shards: rest })
  })

  it('welcomes a new identity with arkinox\'s words, and anyone with a chain or an avatar of their own with the variant', () => {
    const welcome = DEMO_SCRIPT.steps.find((s) => s.id === 'welcome')!
    expect(captionFor(welcome, false, true, false)).toBe(welcome.caption)
    expect(welcome.caption).toMatch(/The red dodecahedron is your avatar/)
    const variant = 'This is a guided tour of cyberspace. The shape at the center is your avatar, at your current position. Let\'s talk about how you got here.'
    expect(captionFor(welcome, true, true, false)).toBe(variant)
    expect(captionFor(welcome, false, true, true)).toBe(variant)
  })
})

describe('starting in place from a /C/ link view (review of #362, 2026-10-15)', () => {
  it('ends the link view before pushing /demo, so its ending rewrites its own entry and not the tour\'s', () => {
    const order: string[] = []
    const stop = startCoordRoute({ pathname: '/C/abcd', search: '', hash: '' }, { replaceState: () => { order.push('replace') } })
    expect(useCoordRoute.getState().label).not.toBeNull()
    const g = globalThis as { window?: unknown }
    const had = g.window
    g.window = { history: { pushState: () => { order.push('push') }, state: null } }
    try { startTourInPlace() } finally { g.window = had }
    expect(order).toEqual(['replace', 'push'])
    expect(useDemo.getState().active).toBe(true)
    expect(useCoordRoute.getState().label).toBeNull()
    stop()
  })
})

describe('the genesis district (arkinox, 2026-10-15)', () => {
  it('is block 0\'s port, and the examples are block 0 (a port) and block 1 (a landfall)', () => {
    expect(DEMO_DISTRICT.coord).toBe(GENESIS_ROOT)
    const port = stopFromAnchor({ kind: 321, tags: [['B', '0'], ['C', GENESIS_ROOT], ['H', '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f']] })!
    expect(port.kind).toBe('port')
    expect(stopCoordExact(port).toString(16).padStart(64, '0')).toBe(GENESIS_ROOT)
    expect(coordPlace(DEMO_DISTRICT.coord).plane).toBe(1)
    const block1 = '0e3e2357e806b6cdb1f70b54c3a3a17b6714ee1f0e68bebb44a74b1efd512098'
    expect(planeOfMerkleRoot(block1)).toBe(0)
    const at = (id: string) => DEMO_SCRIPT.steps.find((s) => s.id === id)!
    expect(at('port').scene.target).toEqual({ block: GENESIS_ROOT })
    expect(at('landfall').scene.target).toEqual({ block: block1 })
    expect(at('port').caption).toBe('When a block\'s merkle root ends in a 1 bit, its station is a port in ideaspace, sitting exactly at the merkle root read as a coordinate. This is block 0, Bitcoin\'s genesis block.')
    expect(at('landfall').caption).toBe('Otherwise the station is a landfall on Earth, at a point derived from the block hash. This is block 1.')
    expect(at('landfall').scene.scale).toBe(52)
  })
})

describe('the district shows only the curators\' things (2026-10-15)', () => {
  const thing = (author: string, n: number) => ({ eventId: `${author.slice(0, 4)}${n}`, type: 'message', at: { x: 1n, y: 1n, z: 1n }, plane: 1, height: 0, author, text: 'hi', createdAt: n, lookupId: 'l', bagId: 'b', inner: { id: 'i', pubkey: author, created_at: n, kind: 1, tags: [], content: '', sig: '' } })
  const STRANGER = 'ef'.repeat(32)
  let saved: Record<string, unknown> = {}
  beforeEach(() => {
    saved = useShards.getState().discovered
    const all = [thing(DEMO_CURATORS[0], 1), thing(DEMO_CURATORS[1], 2), thing(STRANGER, 3)]
    useShards.setState({ discovered: Object.fromEntries(all.map((t) => [t.eventId, t])) as never, scanning: false })
  })
  afterEach(() => { useShards.setState({ discovered: saved as never, curated: null }) })
  const authors = () => useShards.getState().worldItems().map((w) => w.author).sort()

  it('draws everyone outside the tour, the curators only on the district\'s steps, and everyone again after', () => {
    expect(authors()).toHaveLength(3)
    useDemo.getState().start('district')
    expect(authors()).toEqual([...DEMO_CURATORS].sort())
    for (const id of ['found', 'chalk', 'key-item', 'chest', 'item-feed']) {
      useDemo.getState().goTo(DEMO_SCRIPT.steps.findIndex((s) => s.id === id))
      expect(authors(), id).toEqual([...DEMO_CURATORS].sort())
    }
    useDemo.getState().goTo(DEMO_SCRIPT.steps.findIndex((s) => s.id === 'line'))
    expect(authors()).toHaveLength(3)
    // The port step stands on block 0's port, the district's coordinate.
    useDemo.getState().goTo(DEMO_SCRIPT.steps.findIndex((s) => s.id === 'port'))
    expect(authors(), 'port').toEqual([...DEMO_CURATORS].sort())
    useDemo.getState().goTo(DEMO_SCRIPT.steps.findIndex((s) => s.id === 'landfall'))
    expect(authors(), 'landfall').toHaveLength(3)
    useDemo.getState().goTo(DEMO_SCRIPT.steps.findIndex((s) => s.id === 'found'))
    useDemo.getState().exit()
    expect(authors()).toHaveLength(3)
  })

  it('"found" with something of the curators\' to open waits for the tap', () => {
    useDemo.getState().start('found')
    expect(useDemo.getState().done).toBe(false)
    expect(useDemo.getState().empty).toBe(false)
  })

  it('"found" on an empty district says so and lets you go on, and waits again if something lands', () => {
    useShards.setState({ discovered: { s: thing(STRANGER, 9) } as never }) // only a stranger's: hidden in the tour
    useDemo.getState().start('found')
    expect(useDemo.getState().done).toBe(true)
    expect(useDemo.getState().empty).toBe(true)
    useShards.setState({ discovered: { a: thing(DEMO_CURATORS[0], 10) } as never })
    expect(useDemo.getState().done).toBe(false)
    expect(useDemo.getState().empty).toBe(false)
  })

  it('"found" waits for the scan to finish before calling the district empty', () => {
    useShards.setState({ discovered: {}, scanning: true })
    useDemo.getState().start('found')
    expect(useDemo.getState().done).toBe(false)
    useShards.setState({ scanning: false })
    expect(useDemo.getState().empty).toBe(true)
  })

  it('"found" that opened empty still counts the tap once something lands (review of #364)', () => {
    useShards.setState({ discovered: {}, scanning: false, selectedSecret: null })
    useDemo.getState().start('found')
    expect(useDemo.getState().empty).toBe(true)
    useShards.setState({ discovered: { a: thing(DEMO_CURATORS[0], 11) } as never })
    expect(useDemo.getState().done).toBe(false)
    useShards.setState({ selectedSecret: 'e8ed11' })
    expect(useDemo.getState().done).toBe(true)
    useShards.setState({ selectedSecret: null })
  })

  it('"found" stays empty while a later scan runs and finds nothing: no flicker (review of #364)', () => {
    useShards.setState({ discovered: {}, scanning: false })
    useDemo.getState().start('found')
    expect(useDemo.getState().empty).toBe(true)
    useShards.setState({ scanning: true })
    expect(useDemo.getState().empty).toBe(true)
    expect(useDemo.getState().done).toBe(true)
    useShards.setState({ scanning: false })
    expect(useDemo.getState().empty).toBe(true)
  })

  it('a stranger\'s find on the district raises no found chip; outside the tour it does (review of #364)', () => {
    useCeremony.setState({ chip: null })
    useDemo.getState().start('district')
    useCeremony.getState().mark([thing(STRANGER, 20) as never])
    expect(useCeremony.getState().chip).toBeNull()
    useCeremony.getState().mark([thing(STRANGER, 21) as never, thing(DEMO_CURATORS[1], 22) as never])
    expect(useCeremony.getState().chip?.count).toBe(1)
    useDemo.getState().exit()
    useCeremony.setState({ chip: null })
    useCeremony.getState().mark([thing(STRANGER, 23) as never])
    expect(useCeremony.getState().chip?.count).toBe(1)
    useCeremony.setState({ chip: null })
  })
})
