/**
 * demo.test.ts - the /demo tour (arkinox, 2026-10-14): the script is well
 * formed, the engine walks it and puts LOCAL/LIVE and the view back, the
 * voice picker prefers a professorly male voice, and waiting steps notice
 * a hop and a scan.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
import { useDemo, watchAction } from '../useDemo'
import { useShards } from '../useShards'
import { DEMO_DISTRICT, DEMO_SCRIPT } from '../../demo/script'
import { PREFERRED_VOICES, pickVoice } from '../../demo/voice'
import { parseDemoRoute } from '../../lib/demoRoute'
import { captionFor } from '../../hud/DemoCoach'
import { coordPlace } from '../../lib/coordRoute'
import { useHyperspace } from '../useHyperspace'
import { useToast } from '../useToast'

beforeEach(() => {
  if (useDemo.getState().active) useDemo.getState().exit()
  useCyberspace.getState().clearFocus()
  useCyberspace.getState().setLive(false)
})

describe('the script', () => {
  it('has unique step ids, known chapters, every chapter reached, and short plain captions', () => {
    const ids = DEMO_SCRIPT.steps.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    const chapters = new Set(DEMO_SCRIPT.chapters.map((c) => c.id))
    for (const s of DEMO_SCRIPT.steps) {
      expect(chapters.has(s.chapter), s.id).toBe(true)
      expect(s.title.length, s.id).toBeGreaterThan(0)
      for (const text of [s.caption, s.captionNew].filter((t): t is string => !!t)) {
        expect(text.length, s.id).toBeGreaterThan(20)
        expect(text.length, s.id).toBeLessThan(320)
        expect(text, s.id).not.toMatch(/—/) // no em dashes
        const sentences = text.split(/[.!?](\s|$)/).filter((x) => x.trim().length > 1).length
        expect(sentences, s.id).toBeLessThanOrEqual(3)
      }
      if (s.wait) expect(s.hint, s.id).toBeTruthy()
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

describe('the engine', () => {
  it('forces LOCAL on entry and puts LIVE back on exit', () => {
    useCyberspace.getState().setLive(true)
    useDemo.getState().start()
    expect(useCyberspace.getState().live).toBe(false)
    useDemo.getState().exit()
    expect(useCyberspace.getState().live).toBe(true)
  })

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
    d.start('hop')
    expect(DEMO_SCRIPT.steps[useDemo.getState().index].id).toBe('hop')
    expect(useDemo.getState().done).toBe(false)
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
})
