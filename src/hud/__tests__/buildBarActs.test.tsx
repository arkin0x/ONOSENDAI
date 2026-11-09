/**
 * buildBarActs.test.tsx: the BUILD bar's buttons (arkinox, 2026-11-09: "the
 * BUILD mode overlay should have buttons for Item, Chest, Door. Remove the
 * verb prefixes from each button ... We want them to sit nicely in the same
 * spot every time"). Nouns in a fixed order, every one always there, each
 * doing what its verb did; the verbs stay in the tooltips. Pressed through
 * their real onClick (elementRoot.ts). No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({
  onAuthChange: () => () => {},
  signInFailed: () => false,
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../../scene/CardSpin', () => ({ CardSpin: () => null }))
vi.mock('../../scene/ShardSpin', () => ({ ShardSpin: () => null }))
// The bar's cover measures a real box.
vi.mock('../../hooks/useCover', () => ({ useCover: () => () => undefined }))

import { mount, settled, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'
import { useShards } from '../../store/useShards'
import { useStash } from '../stash'
import { placeSpawn } from '../../store/fixtures/placeSpawn'
import { moveDirection } from '../../lib/moves'
import { useKeyboard } from '../../hooks/useKeyboard'
import { BuildBar } from '../BuildBar'

const ORDER = ['OBJECT', 'MESSAGE', 'AUDIO', 'ITEM', 'CHEST', 'DOOR', 'AGAIN']

const acts = (bar: Mounted): Host[] => bar.all().filter((h) => h.type === 'button' && h.props.className === 'buildbar__act')
const act = (bar: Mounted, label: string): Host => acts(bar).find((h) => textOf(h) === label)!

beforeEach(() => {
  useCyberspace.setState({ live: false })
  useShards.setState({ pending: null, placedLast: null, deployStatus: 'idle' })
  useStash.getState().close()
  useBuilder.setState({ active: true })
})

afterEach(() => {
  if (useShards.getState().pending) useShards.getState().cancelDeploy()
  useStash.getState().close()
  useBuilder.setState({ active: false })
})

describe('the BUILD bar: ITEM, CHEST, DOOR, and no verbs', () => {
  it('shows every button by its noun, in one fixed order', async () => {
    const bar = await mount(<BuildBar />)
    expect(acts(bar).map(textOf)).toEqual(ORDER)
    for (const verb of ['PLACE OBJECT', 'HIDE MESSAGE', 'PLACE AUDIO', 'PLACE AGAIN', 'FORGE AN ITEM', 'SEAL A CHEST', 'SEAL A DOOR']) expect(bar.says(verb)).toBe(false)
    await bar.unmount()
  })

  it('keeps the verbs in the tooltips', async () => {
    const bar = await mount(<BuildBar />)
    expect(act(bar, 'ITEM').props.title).toMatch(/^Forge an item/)
    expect(act(bar, 'CHEST').props.title).toMatch(/^Seal a chest/)
    expect(act(bar, 'DOOR').props.title).toMatch(/^Seal a door/)
    expect(act(bar, 'OBJECT').props.title).toMatch(/^Place object/)
    await bar.unmount()
  })

  it('names each button by its full phrase, its visible word inside it (label in name)', async () => {
    const bar = await mount(<BuildBar />)
    const names = ['Place object', 'Hide message', 'Place audio', 'Forge an item', 'Seal a chest', 'Seal a door', 'Place again']
    expect(acts(bar).map((h) => h.props['aria-label'])).toEqual(names)
    for (const h of acts(bar)) expect(String(h.props['aria-label']).toUpperCase()).toContain(textOf(h))
    await bar.unmount()
  })

  it('AGAIN holds its cell, dimmed, when there is nothing to place again: nothing after it moves', async () => {
    const bar = await mount(<BuildBar />)
    expect(acts(bar)).toHaveLength(ORDER.length)
    expect(act(bar, 'AGAIN').props.disabled).toBe(true)
    await bar.unmount()
  })

  it('ITEM opens the item composer, as FORGE AN ITEM did', async () => {
    const bar = await mount(<BuildBar />)
    await bar.press(/^ITEM$/)
    expect(useStash.getState().key).toBe(true)
    await bar.unmount()
  })

  it('CHEST lines an empty chest up on the hide bar to place first, as SEAL A CHEST did', async () => {
    const bar = await mount(<BuildBar />)
    await bar.press(/^CHEST$/)
    const p = useShards.getState().pending
    expect(p?.type).toBe('chest')
    expect(p?.type === 'chest' && p.door).toBeFalsy()
    await bar.unmount()
  })

  it('DOOR lines a door up on the hide bar to place first, as SEAL A DOOR did', async () => {
    const bar = await mount(<BuildBar />)
    await bar.press(/^DOOR$/)
    const p = useShards.getState().pending
    expect(p?.type === 'chest' && p.door).toBe(true)
    await bar.unmount()
  })

  it('OBJECT, MESSAGE and AUDIO open what they opened before', async () => {
    const bar = await mount(<BuildBar />)
    await bar.press(/^OBJECT$/)
    expect(useStash.getState().models).toBe(true)
    useStash.getState().close()
    await bar.press(/^MESSAGE$/)
    expect(useStash.getState().message).toBe(true)
    useStash.getState().close()
    await bar.press(/^AUDIO$/)
    expect(useStash.getState().audio).toBe(true)
    await bar.unmount()
  })
})

/**
 * RETURN TO AVATAR (arkinox, 2026-11-09: "lets move "Avatar" up to the same
 * row as the exit button. Change it to "Return to Avatar" and make it
 * disappear when its inactive"). In the header beside EXIT, and only while
 * the build cursor is away from your avatar.
 */
describe('the BUILD bar: RETURN TO AVATAR beside EXIT', () => {
  const S = () => useCyberspace.getState()
  const head = (bar: Mounted): Host => bar.all().find((h) => h.props.className === 'buildbar__head')!
  const headButtons = (bar: Mounted): string[] => head(bar).children.filter((c): c is Host => typeof c !== 'string' && c.type === 'button').map(textOf)
  const home = (bar: Mounted): Host | undefined => bar.buttons('RETURN TO AVATAR')[0]
  // A real session, as BUILD (B) opens one: the build cursor starts on your avatar.
  const enter = async (): Promise<void> => {
    useBuilder.getState().exit()
    S().clearFocus()
    await placeSpawn()
    useBuilder.getState().enter('build')
  }
  const away = (): void => { S().moveCursor(moveDirection(S().axes(), 'up')) }
  const realToAvatar = useBuilder.getState().toAvatar
  afterEach(() => { useBuilder.setState({ toAvatar: realToAvatar }) })
  // The test renderer hands a ref the host record itself (elementRoot.ts),
  // so a focus spy set on EXIT's record is what the bar's ref calls.
  const exitWithFocusSpy = (bar: Mounted): ReturnType<typeof vi.fn> => {
    const exit = bar.buttons(/^EXIT$/)[0] as Host & { focus?: () => void }
    const focus = vi.fn()
    exit.focus = focus
    return focus
  }

  it('is not there at all on your avatar, where it would do nothing', async () => {
    await enter()
    const bar = await mount(<BuildBar />)
    expect(useBuilder.getState().active).toBe(true)
    expect(home(bar)).toBeUndefined()
    expect(headButtons(bar)).toEqual(['EXIT'])
    await bar.unmount()
  })

  it('is in the header, just left of EXIT, when the cursor is away from your avatar', async () => {
    await enter()
    away()
    const bar = await mount(<BuildBar />)
    expect(headButtons(bar)).toEqual(['RETURN TO AVATAR', 'EXIT'])
    expect(acts(bar).map(textOf)).toEqual(ORDER)
    const b = home(bar)!
    expect(b.props.disabled).toBeFalsy()
    expect(b.props['aria-label']).toBe('Return to avatar')
    expect(b.props.title).toMatch(/^Return to avatar: .*\(X\)$/)
    await bar.unmount()
  })

  it('comes as the cursor leaves your avatar and goes once pressed, EXIT staying last', async () => {
    await enter()
    const bar = await mount(<BuildBar />)
    expect(headButtons(bar)).toEqual(['EXIT'])
    away()
    await settled()
    expect(headButtons(bar)).toEqual(['RETURN TO AVATAR', 'EXIT'])
    await bar.press('RETURN TO AVATAR')
    expect(S().cursor).toEqual(S().position)
    expect(useBuilder.getState().active).toBe(true)
    expect(headButtons(bar)).toEqual(['EXIT'])
    await bar.unmount()
  })

  // The real keyboard path: useKeyboard mounted beside the bar, listening on
  // a stand-in window, and a key pressed on a target, as the browser sends it.
  type Listener = (e: unknown) => void
  const keyboard = (): { key: (code: string, target: object) => void } => {
    const listeners = new Map<string, Set<Listener>>()
    vi.stubGlobal('window', {
      addEventListener: (t: string, f: Listener) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t)!.add(f) },
      removeEventListener: (t: string, f: Listener) => { listeners.get(t)?.delete(f) },
    })
    return {
      key: (code, target) => {
        const e = { code, key: code.replace(/^Key/, '').toLowerCase(), target, repeat: false, defaultPrevented: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault: () => { e.defaultPrevented = true } }
        for (const f of listeners.get('keydown') ?? []) f(e)
      },
    }
  }
  function Keys(): null { useKeyboard(); return null }
  const canvas = { tagName: 'CANVAS', closest: () => null }
  const focusedOn = (h: Host): object => ({ tagName: 'BUTTON', closest: () => h })
  afterEach(() => { vi.unstubAllGlobals() })

  it('hands the focus to EXIT when pressed with the focus on it, since it leaves the screen', async () => {
    await enter()
    away()
    const bar = await mount(<BuildBar />)
    const focus = exitWithFocusSpy(bar)
    ;(home(bar)!.props.onFocus as () => void)()
    await bar.press('RETURN TO AVATAR')
    expect(home(bar)).toBeUndefined()
    expect(focus).toHaveBeenCalledTimes(1)
    await bar.unmount()
  })

  it('X with the button focused: the button goes and the focus goes to EXIT', async () => {
    const kb = keyboard()
    await enter()
    away()
    const bar = await mount(<><Keys /><BuildBar /></>)
    const focus = exitWithFocusSpy(bar)
    const b = home(bar)!
    ;(b.props.onFocus as () => void)()
    kb.key('KeyX', focusedOn(b))
    await settled()
    expect(S().cursor).toEqual(S().position)
    expect(home(bar)).toBeUndefined()
    expect(focus).toHaveBeenCalledTimes(1)
    await bar.unmount()
  })

  it('X from the canvas: the button goes and the focus is left alone', async () => {
    const kb = keyboard()
    await enter()
    away()
    const bar = await mount(<><Keys /><BuildBar /></>)
    const focus = exitWithFocusSpy(bar)
    kb.key('KeyX', canvas)
    await settled()
    expect(S().cursor).toEqual(S().position)
    expect(home(bar)).toBeUndefined()
    expect(focus).not.toHaveBeenCalled()
    await bar.unmount()
  })

  it('a focus that left the button first is not taken back to EXIT', async () => {
    const kb = keyboard()
    await enter()
    away()
    const bar = await mount(<><Keys /><BuildBar /></>)
    const focus = exitWithFocusSpy(bar)
    const b = home(bar)!
    ;(b.props.onFocus as () => void)()
    ;(b.props.onBlur as () => void)()
    kb.key('KeyX', canvas)
    await settled()
    expect(home(bar)).toBeUndefined()
    expect(focus).not.toHaveBeenCalled()
    await bar.unmount()
  })

  it('P on your avatar flips the build plane away from your head: the button comes', async () => {
    const kb = keyboard()
    await enter()
    const bar = await mount(<><Keys /><BuildBar /></>)
    expect(home(bar)).toBeUndefined()
    kb.key('KeyP', canvas)
    await settled()
    expect(useBuilder.getState().active).toBe(true)
    expect(S().cursor).toEqual(S().position)
    expect(headButtons(bar)).toEqual(['RETURN TO AVATAR', 'EXIT'])
    kb.key('KeyX', canvas)
    await settled()
    expect(home(bar)).toBeUndefined()
    await bar.unmount()
  })

  it('stays while a chain explorer mark stands with the cursor on your avatar, and pressing it clears the mark', async () => {
    await enter()
    const bar = await mount(<BuildBar />)
    expect(home(bar)).toBeUndefined()
    // A mark on an action standing where you stand (a boarding head).
    useBuilder.setState({ scrub: 0 })
    await settled()
    expect(S().cursor).toEqual(S().position)
    expect(headButtons(bar)).toEqual(['RETURN TO AVATAR', 'EXIT'])
    await bar.press('RETURN TO AVATAR')
    expect(useBuilder.getState().scrub).toBeNull()
    expect(home(bar)).toBeUndefined()
    await bar.unmount()
  })

  it('calls toAvatar when pressed', async () => {
    await enter()
    away()
    const toAvatar = vi.fn()
    useBuilder.setState({ toAvatar })
    const bar = await mount(<BuildBar />)
    await bar.press('RETURN TO AVATAR')
    expect(toAvatar).toHaveBeenCalledTimes(1)
    await bar.unmount()
  })
})
