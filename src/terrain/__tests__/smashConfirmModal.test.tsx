/**
 * smashConfirmModal.test.tsx - the confirm a wasted smash brings up
 * (terrain/SmashConfirm.tsx; lib/blueprint/smashConfirm.ts has the rules):
 * "Smash anyway?" over the question, SMASH and CANCEL, and a "Don't ask
 * again" box that starts OFF. CANCEL spends nothing; SMASH with the box
 * ticked turns the question off for this identity.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
// The Radix box reads the DOM (closest) as it draws; a plain stand-in with the same props, so the wiring is what is tested.
vi.mock('../../hud/ui/Checkbox', async () => {
  const { createElement: h } = await import('react')
  return { Checkbox: (p: { id?: string; checked?: boolean; onCheckedChange?: (v: boolean) => void }) => h('button', { role: 'checkbox', id: p.id, 'aria-checked': p.checked, onClick: () => p.onCheckedChange?.(!p.checked) }) }
})

import { createElement } from 'react'
import { mount, settled, textOf, type Host } from '../../test/elementRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { DONT_ASK_LABEL, SMASH_ASK_TITLE, SmashConfirm } from '../SmashConfirm'
import { askBeforeSmash, forgetSmashAsk, smashAskingFor, useSmashConfirm } from '../../lib/blueprint/smashConfirm'

/** A body for the portal: a host as elementRoot makes them, so what lands in it can be read. */
const body = Object.defineProperties({ type: 'body', props: {}, children: [] as Array<Host | string> }, { nodeType: { value: 1 } }) as Host
const hadDocument = 'document' in globalThis
const ME = '9'.repeat(64)
let before: { pubkey: string; npub: string }
beforeEach(() => {
  body.children.length = 0
  if (!hadDocument) (globalThis as { document?: unknown }).document = { body }
  before = useCyberspace.getState().identity
  useCyberspace.setState({ identity: { pubkey: ME, npub: '' } })
  forgetSmashAsk()
})
afterEach(() => {
  if (!hadDocument) delete (globalThis as { document?: unknown }).document
  useCyberspace.setState({ identity: before })
  forgetSmashAsk()
})

function all(h: Host | string, out: Host[] = []): Host[] {
  if (typeof h === 'string') return out
  out.push(h)
  h.children.forEach((c) => all(c, out))
  return out
}
const button = (words: string): Host => all(body).find((h) => h.type === 'button' && textOf(h) === words)!
const WORDS = "This won't compile. It breaks 5 blocks, including placed Glowcore. Smash anyway?"

describe('the confirm before a wasted smash', () => {
  it.skipIf(hadDocument)('says the question under "Smash anyway?", with SMASH, CANCEL and the box OFF; CANCEL spends nothing', async () => {
    const go = vi.fn()
    const m = await mount(createElement(SmashConfirm))
    expect(all(body).some((h) => h.props.role === 'dialog')).toBe(false)
    askBeforeSmash({ words: WORDS, count: 5, rare: ['Glowcore'], miss: null }, go)
    await settled()
    const dialog = all(body).find((h) => h.props.role === 'dialog')!
    expect(dialog.props['aria-label']).toBe(SMASH_ASK_TITLE)
    expect(textOf(dialog)).toContain("This won't compile. It breaks 5 blocks, including placed Glowcore.")
    expect(textOf(dialog)).toContain(DONT_ASK_LABEL)
    const box = all(body).find((h) => h.props.id === 'smash-ask-dont')!
    expect(box.props.role).toBe('checkbox')
    expect(box.props['aria-checked']).toBe(false)
    ;(button('CANCEL').props.onClick as () => void)()
    await settled()
    expect(go).not.toHaveBeenCalled()
    expect(useSmashConfirm.getState().ask).toBeNull()
    expect(all(body).some((h) => h.props.role === 'dialog')).toBe(false)
    expect(smashAskingFor(ME)).toBe(true)
    await m.unmount()
  })

  it.skipIf(hadDocument)('a new question starts with the box OFF, never a tick left from the last', async () => {
    const m = await mount(createElement(SmashConfirm))
    askBeforeSmash({ words: WORDS, count: 5, rare: ['Glowcore'], miss: null }, vi.fn())
    await settled()
    ;(all(body).find((h) => h.props.id === 'smash-ask-dont')!.props.onClick as () => void)()
    await settled()
    expect(all(body).find((h) => h.props.id === 'smash-ask-dont')!.props['aria-checked']).toBe(true)
    // Another smash asks while this one is up, and again after a CANCEL: OFF from the first draw each time.
    askBeforeSmash({ words: WORDS, count: 6, rare: ['Glowcore'], miss: null }, vi.fn())
    await settled()
    expect(all(body).find((h) => h.props.id === 'smash-ask-dont')!.props['aria-checked']).toBe(false)
    ;(button('CANCEL').props.onClick as () => void)()
    await settled()
    askBeforeSmash({ words: WORDS, count: 5, rare: ['Glowcore'], miss: null }, vi.fn())
    await settled()
    expect(all(body).find((h) => h.props.id === 'smash-ask-dont')!.props['aria-checked']).toBe(false)
    await m.unmount()
  })

  it.skipIf(hadDocument)('SMASH with "Don\'t ask again" ticked smashes and turns the question off for this identity', async () => {
    const go = vi.fn()
    const m = await mount(createElement(SmashConfirm))
    askBeforeSmash({ words: WORDS, count: 5, rare: ['Glowcore'], miss: null }, go)
    await settled()
    ;(all(body).find((h) => h.props.id === 'smash-ask-dont')!.props.onClick as () => void)()
    await settled()
    expect(all(body).find((h) => h.props.id === 'smash-ask-dont')!.props['aria-checked']).toBe(true)
    ;(button('SMASH').props.onClick as () => void)()
    await settled()
    expect(go).toHaveBeenCalledTimes(1)
    expect(smashAskingFor(ME)).toBe(false)
    await m.unmount()
  })
})
