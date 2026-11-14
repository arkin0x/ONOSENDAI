/**
 * straylightRoute.test.tsx - the tutorial's JOIN THE COMMUNITY route
 * (owner, 2026-11-14):
 *
 * - it is the first "Where next?" choice, with a steaming cup (lucide Coffee);
 * - the route is three panels on the branch: Straylight Cafe, bringing your
 *   identity, and OPEN STRAYLIGHT CAFE;
 * - the identity panel says what to do for the signer the player is on: the
 *   same extension or signer app, or, on a key this device made, the key
 *   itself behind a warning and an explicit SHOW MY KEY, never before;
 * - the shown key is this identity's own nsec, copied to the clipboard and
 *   nowhere else, never logged, and hidden again by HIDE KEY, by the tab going
 *   to the background, and by leaving the panel;
 * - OPEN STRAYLIGHT CAFE opens the invite in a new tab with noopener and
 *   noreferrer, and the invite is written in one place;
 * - finishing returns to the choices with the route checked off;
 * - no em dash in anything the route says.
 *
 * The relay module is replaced: nothing here reaches a relay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

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

// The page's listeners, so a test can send the tab to the background.
const page = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>()
  const doc = {
    visibilityState: 'visible',
    body: { nodeType: 1 },
    addEventListener: (type: string, fn: () => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn) },
    removeEventListener: (type: string, fn: () => void) => { listeners.get(type)?.delete(fn) },
  }
  ;(globalThis as { document?: unknown }).document ??= doc
  return { listeners, doc: (globalThis as unknown as { document: typeof doc }).document }
})

vi.mock('../../lib/relay', async (orig) => ({
  ...(await orig<typeof import('../../lib/relay')>()),
  onAuthChange: () => () => {},
  signInFailed: () => false,
  publish: vi.fn(async () => ({ ok: true, accepted: [] })),
  publishMany: vi.fn(async () => ({ ok: true, accepted: [] })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
}))
// An extension to switch to, signing with its own key: only for the last test, that a key leaves only a local signer.
vi.mock('../../lib/signers', async (orig) => {
  const actual = await orig<typeof import('../../lib/signers')>()
  const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure')
  const key = Uint8Array.from({ length: 32 }, (_, i) => i + 7)
  const fake = { kind: 'nip07' as const, pubkey: getPublicKey(key), signEvent: async (t: Parameters<typeof finalizeEvent>[0]) => JSON.parse(JSON.stringify(finalizeEvent(t, key))) }
  return { ...actual, nip07Signer: async () => fake }
})
vi.mock('react-dom', async (orig) => ({ ...(await orig<typeof import('react-dom')>()), createPortal: (el: unknown) => el }))
vi.mock('../../hooks/useCover', () => ({ useCover: () => () => undefined }))
vi.mock('../../hooks/useEscape', () => ({ useEscape: () => undefined }))
vi.mock('../../hooks/useMenuOpen', async (orig) => ({ ...(await orig<typeof import('../../hooks/useMenuOpen')>()), setMenuOpen: vi.fn() }))

import { getPublicKey, nip19 } from 'nostr-tools'
import { mount, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { routeOf, runTutorialEffect, useTutorial } from '../../store/useTutorial'
import { exportNsec } from '../../lib/keyExport'
import { writeProgress } from '../gate'
import { CHOICE, STRAYLIGHT, STRAYLIGHT_IDENTITY, STRAYLIGHT_OPEN, TUTORIAL_SCRIPT } from '../script'
import { STRAYLIGHT_INVITE, STRAYLIGHT_REL } from '../straylight'
import { useWorkshop } from '../../store/useWorkshop'
import { publish, publishMany } from '../../lib/relay'
import { CHOICE_ICONS, TutorialCoach } from '../../hud/TutorialCoach'
import { LOCAL_KEY_COPY, SAME_SIGNER, StraylightIdentity } from '../../hud/StraylightIdentity'
import '../director'

const ROUTE = [STRAYLIGHT, STRAYLIGHT_IDENTITY, STRAYLIGHT_OPEN]
const id = (): string => useTutorial.getState().script.steps[useTutorial.getState().index].id
const pubkey = (): string => useCyberspace.getState().identity.pubkey
const kids = (h: Host): Host[] => h.children.filter((c): c is Host => typeof c !== 'string')
const svgsUnder = (h: Host): Host[] => { const out: Host[] = []; const go = (x: Host): void => { if (x.type === 'svg') out.push(x); kids(x).forEach(go) }; go(h); return out }
const keyBox = (m: Mounted): Host | undefined => m.all().find((h) => h.type === 'textarea')
/** Every word and every prop value on screen, so a key in a title or a value is found too. */
const everything = (m: Mounted): string => m.all().map((h) => `${textOf(h)} ${Object.values(h.props).filter((v) => typeof v === 'string').join(' ')}`).join(' ')

let mounted: Mounted | null = null
const kind0 = useCyberspace.getState().signerKind

beforeEach(() => {
  useTutorial.setState({ script: TUTORIAL_SCRIPT, doneChoices: [] })
  writeProgress(pubkey(), null)
  page.doc.visibilityState = 'visible'
})
afterEach(async () => {
  await mounted?.unmount()
  mounted = null
  useTutorial.getState().pause()
  useCyberspace.setState({ signerKind: kind0 })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('JOIN THE COMMUNITY, as written', () => {
  it('is the first choice, goes to Straylight Cafe, and wears a steaming cup', async () => {
    expect(CHOICE.choices![0]).toEqual({ id: 'straylight', label: 'JOIN THE COMMUNITY', about: 'Hang out in Straylight Cafe, the cyberspace community.', step: 'straylight' })
    useTutorial.setState({ active: true, index: 0, script: { steps: [CHOICE] }, choosing: null, choiceNote: '' })
    mounted = await mount(<TutorialCoach />)
    const first = mounted.all().find((h) => h.type === 'button' && String(h.props.className).includes('tutorial-choice'))!
    expect(textOf(first)).toBe('JOIN THE COMMUNITYHang out in Straylight Cafe, the cyberspace community.')
    expect(String(svgsUnder(kids(first)[0])[0].props.className)).toContain('lucide-coffee')
    expect(CHOICE_ICONS.straylight).toBeDefined()
  })

  it('is three panels on the branch, in order, the last with OPEN STRAYLIGHT CAFE', () => {
    expect(routeOf(TUTORIAL_SCRIPT.steps, 'straylight')).toEqual(['straylight', 'straylight-identity', 'straylight-open'])
    for (const step of ROUTE) expect(step.branch, step.id).toBe(true)
    expect(ROUTE.map((s) => s.title)).toEqual(['Straylight Cafe', 'Bring your identity', 'Open Straylight Cafe'])
    expect(STRAYLIGHT_IDENTITY.panel).toBe('straylight-identity')
    expect(STRAYLIGHT_OPEN.action).toEqual({ label: 'OPEN STRAYLIGHT CAFE', effect: 'open-straylight' })
    expect(STRAYLIGHT_OPEN.then).toBeUndefined()
    // Nothing waits: each panel is read and NEXTed.
    for (const step of ROUTE) expect(step.wait, step.id).toBeUndefined()
  })

  it('says no em dash anywhere', () => {
    const said = [
      ...ROUTE.flatMap((s) => [s.title, s.caption, s.hint, s.explain, s.action?.label]),
      ...Object.values(SAME_SIGNER), ...Object.values(LOCAL_KEY_COPY), CHOICE.choices![0].label, CHOICE.choices![0].about,
    ].filter(Boolean).join(' ')
    expect(said).not.toContain('—')
  })
})

describe('the identity panel', () => {
  it('an extension: log in to Armada with the same extension, and no key offered', async () => {
    useCyberspace.setState({ signerKind: 'nip07' })
    const reveal = vi.spyOn(useCyberspace.getState(), 'revealKey')
    mounted = await mount(<StraylightIdentity />)
    expect(mounted.says(SAME_SIGNER.nip07)).toBe(true)
    expect(mounted.buttons(LOCAL_KEY_COPY.show)).toHaveLength(0)
    expect(reveal).not.toHaveBeenCalled()
  })

  it('a signer app (bunker): log in with the same signer, and no key offered', async () => {
    useCyberspace.setState({ signerKind: 'nip46' })
    mounted = await mount(<StraylightIdentity />)
    expect(mounted.says(SAME_SIGNER.nip46)).toBe(true)
    expect(mounted.buttons(LOCAL_KEY_COPY.show)).toHaveLength(0)
  })

  it('a local key: the warning and SHOW MY KEY, and the key nowhere until it is tapped', async () => {
    useCyberspace.setState({ signerKind: 'local' })
    const reveal = vi.spyOn(useCyberspace.getState(), 'revealKey')
    const nsec = useCyberspace.getState().revealKey()
    reveal.mockClear()
    mounted = await mount(<StraylightIdentity />)
    expect(mounted.says(LOCAL_KEY_COPY.warning)).toBe(true)
    expect(mounted.says(LOCAL_KEY_COPY.signer)).toBe(true)
    expect(keyBox(mounted)).toBeUndefined()
    expect(everything(mounted)).not.toContain('nsec1')
    expect(reveal).not.toHaveBeenCalled()

    await mounted.press(LOCAL_KEY_COPY.show)
    expect(reveal).toHaveBeenCalledTimes(1)
    const box = keyBox(mounted)!
    expect(box.props.value).toBe(nsec)
    expect(box.props.readOnly).toBe(true)
    // The warning stays up beside it.
    expect(mounted.says(LOCAL_KEY_COPY.warning)).toBe(true)
  })

  it('the shown key is this identity\'s own', async () => {
    useCyberspace.setState({ signerKind: 'local' })
    mounted = await mount(<StraylightIdentity />)
    await mounted.press(LOCAL_KEY_COPY.show)
    const decoded = nip19.decode(String(keyBox(mounted)!.props.value))
    expect(decoded.type).toBe('nsec')
    expect(getPublicKey(decoded.data as Uint8Array)).toBe(pubkey())
  })

  it('COPY KEY puts it on the clipboard and nowhere else; nothing is logged', async () => {
    useCyberspace.setState({ signerKind: 'local' })
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m))
    mounted = await mount(<StraylightIdentity />)
    await mounted.press(LOCAL_KEY_COPY.show)
    const nsec = String(keyBox(mounted)!.props.value)
    await mounted.press(LOCAL_KEY_COPY.copy)
    expect(writeText).toHaveBeenCalledWith(nsec)
    expect(mounted.says(LOCAL_KEY_COPY.copied)).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
    for (const fn of [publish, publishMany]) expect(JSON.stringify(vi.mocked(fn).mock.calls)).not.toContain(nsec)
    for (const spy of logs) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(nsec)
  })

  it('a clipboard that refuses says so, in words that are not the key', async () => {
    useCyberspace.setState({ signerKind: 'local' })
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    mounted = await mount(<StraylightIdentity />)
    await mounted.press(LOCAL_KEY_COPY.show)
    await mounted.press(LOCAL_KEY_COPY.copy)
    expect(mounted.says(LOCAL_KEY_COPY.copyFailed)).toBe(true)
  })

  it('HIDE KEY puts it away', async () => {
    useCyberspace.setState({ signerKind: 'local' })
    mounted = await mount(<StraylightIdentity />)
    await mounted.press(LOCAL_KEY_COPY.show)
    expect(keyBox(mounted)).toBeDefined()
    await mounted.press(LOCAL_KEY_COPY.hide)
    expect(keyBox(mounted)).toBeUndefined()
    expect(everything(mounted)).not.toContain('nsec1')
    expect(mounted.buttons(LOCAL_KEY_COPY.show)).toHaveLength(1)
  })

  it('the tab going to the background puts it away', async () => {
    useCyberspace.setState({ signerKind: 'local' })
    mounted = await mount(<StraylightIdentity />)
    await mounted.press(LOCAL_KEY_COPY.show)
    expect(keyBox(mounted)).toBeDefined()
    page.doc.visibilityState = 'hidden'
    for (const fn of page.listeners.get('visibilitychange') ?? []) fn()
    await new Promise((r) => setTimeout(r, 5))
    expect(keyBox(mounted)).toBeUndefined()
  })

  it('leaving the panel puts it away: back on it, the key is hidden again', async () => {
    useCyberspace.setState({ signerKind: 'local' })
    useTutorial.getState().start({ at: 'choice' })
    useTutorial.getState().choose('straylight')
    useTutorial.getState().next()
    expect(id()).toBe('straylight-identity')
    mounted = await mount(<TutorialCoach />)
    await mounted.press(LOCAL_KEY_COPY.show)
    expect(keyBox(mounted)).toBeDefined()
    await mounted.press('NEXT')
    expect(id()).toBe('straylight-open')
    expect(everything(mounted)).not.toContain('nsec1')
    await mounted.press('BACK')
    expect(id()).toBe('straylight-identity')
    expect(keyBox(mounted)).toBeUndefined()
    expect(mounted.buttons(LOCAL_KEY_COPY.show)).toHaveLength(1)
  })

  it('folding the coach puts it away', async () => {
    useCyberspace.setState({ signerKind: 'local' })
    useTutorial.getState().start({ at: 'choice' })
    useTutorial.getState().choose('straylight')
    useTutorial.getState().next()
    mounted = await mount(<TutorialCoach />)
    await mounted.press(LOCAL_KEY_COPY.show)
    expect(keyBox(mounted)).toBeDefined()
    useTutorial.getState().setMinimized(true)
    await new Promise((r) => setTimeout(r, 5))
    expect(everything(mounted)).not.toContain('nsec1')
    useTutorial.getState().setMinimized(false)
    await new Promise((r) => setTimeout(r, 5))
    expect(keyBox(mounted)).toBeUndefined()
    expect(mounted.buttons(LOCAL_KEY_COPY.show)).toHaveLength(1)
  })

  it('the workshop opening puts it away', async () => {
    useCyberspace.setState({ signerKind: 'local' })
    useTutorial.getState().start({ at: 'choice' })
    useTutorial.getState().choose('straylight')
    useTutorial.getState().next()
    mounted = await mount(<TutorialCoach />)
    await mounted.press(LOCAL_KEY_COPY.show)
    expect(keyBox(mounted)).toBeDefined()
    useWorkshop.setState({ open: true })
    await new Promise((r) => setTimeout(r, 5))
    expect(everything(mounted)).not.toContain('nsec1')
    useWorkshop.setState({ open: false })
    await new Promise((r) => setTimeout(r, 5))
    expect(keyBox(mounted)).toBeUndefined()
  })

  it('another identity puts it away', async () => {
    useCyberspace.setState({ signerKind: 'local' })
    const was = useCyberspace.getState().identity
    mounted = await mount(<StraylightIdentity />)
    await mounted.press(LOCAL_KEY_COPY.show)
    expect(keyBox(mounted)).toBeDefined()
    useCyberspace.setState({ identity: { ...was, pubkey: 'f'.repeat(64) } })
    await new Promise((r) => setTimeout(r, 5))
    expect(keyBox(mounted)).toBeUndefined()
    expect(mounted.buttons(LOCAL_KEY_COPY.show)).toHaveLength(1)
    useCyberspace.setState({ identity: was })
  })

  it('no key to give off a local signer: exportNsec refuses', () => {
    expect(() => exportNsec(null)).toThrow()
    expect(() => exportNsec(new Uint8Array(31))).toThrow()
  })
})

describe('OPEN STRAYLIGHT CAFE', () => {
  it('opens the invite in a new tab, with no opener and no referrer, by a link clicked', () => {
    const links: Array<Record<string, unknown>> = []
    vi.stubGlobal('document', { ...page.doc, createElement: (tag: string) => { const a: Record<string, unknown> = { tag, click: vi.fn() }; links.push(a); return a } })
    runTutorialEffect('open-straylight')
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ tag: 'a', href: STRAYLIGHT_INVITE, target: '_blank', rel: 'noopener noreferrer' })
    expect(links[0].click).toHaveBeenCalledTimes(1)
    expect(STRAYLIGHT_REL).toBe('noopener noreferrer')
    expect(STRAYLIGHT_INVITE).toMatch(/^https:\/\/armada\.buzz\/invite\/naddr1[a-z0-9]+#[A-Za-z0-9_-]+$/)
  })

  it('the invite is written in one place in the app', () => {
    const root = join(__dirname, '..', '..')
    const hits: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p) }
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(p, 'utf8').includes('armada.buzz/invite')) hits.push(p)
      }
    }
    walk(root)
    expect(hits.map((p) => p.slice(root.length + 1))).toEqual([join('tutorial', 'straylight.ts')])
  })
})

describe('JOIN THE COMMUNITY, walked', () => {
  it('goes Straylight Cafe, identity, open, then back to the choices with it checked off', () => {
    useTutorial.getState().start({ at: 'choice' })
    useTutorial.getState().choose('straylight')
    expect(id()).toBe('straylight')
    useTutorial.getState().next()
    expect(id()).toBe('straylight-identity')
    useTutorial.getState().next()
    expect(id()).toBe('straylight-open')
    const click = vi.fn()
    vi.stubGlobal('document', { ...page.doc, createElement: () => ({ click }) })
    runTutorialEffect(STRAYLIGHT_OPEN.action!.effect)
    expect(click).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
    useTutorial.getState().next()
    expect(id()).toBe('choice')
    expect(useTutorial.getState().doneChoices).toEqual(['straylight'])
  })

  it('BACK from its first panel returns to the choices, not checked off', () => {
    useTutorial.getState().start({ at: 'choice' })
    useTutorial.getState().choose('straylight')
    useTutorial.getState().back()
    expect(id()).toBe('choice')
    expect(useTutorial.getState().doneChoices).toEqual([])
  })
})

describe('a key leaves only a local signer', () => {
  it('signed in with an extension, revealKey refuses, whatever the panel is told', async () => {
    await useCyberspace.getState().useExtension()
    expect(useCyberspace.getState().signerKind).toBe('nip07')
    expect(() => useCyberspace.getState().revealKey()).toThrow()
    // Even a panel told the signer is local gets no key out of it.
    useCyberspace.setState({ signerKind: 'local' })
    mounted = await mount(<StraylightIdentity />)
    await mounted.press(LOCAL_KEY_COPY.show)
    expect(keyBox(mounted)).toBeUndefined()
    expect(everything(mounted)).not.toContain('nsec1')
  })
})
