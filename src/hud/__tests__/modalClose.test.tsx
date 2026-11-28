/**
 * modalClose.test.tsx: every modal and sheet closes with the one ✕ (owner,
 * 2026-11-15: "i want the modals to have consistent close buttons. check
 * them all. good examples: shard feed, avatar modal. bad example: key
 * items, avatars").
 *
 * - ModalClose itself: the ✕, its name, greyed while it cannot close.
 * - Each modal touched renders it (read from its source), and none keeps an
 *   old close of its own (secret__close, secrets__close, ws__sheet-x, the
 *   tutorial's demo__icon ✕).
 * - Every modal root in src (role dialog on a .modal, or a sheet) is one of
 *   them, so a new modal without the ✕ fails here.
 * - Mounted: AVATARS and the confirm modal, the ✕ closing as their tap
 *   outside does; AVATARS has no CLOSE at the bottom any more.
 * - The ✕ is 26px with a 44px fingertip, in styles.css.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  queryEach: vi.fn(async () => []),
  queryChecked: vi.fn(async () => ({ events: [], trouble: null })),
}))
const avatars = Array.from({ length: 7 }, (_, i) => ({
  id: `${i}`.repeat(64).slice(0, 64),
  pubkey: `${(i + 1) % 10}`.repeat(64),
  createdAt: 1_700_000_000 - i * 60,
  type: 'hop',
  name: 'hop',
  role: 'base',
}))
vi.mock('../../hooks/useRecentAvatars', () => ({ useRecentAvatars: () => ({ avatars, status: 'ready', updating: false }) }))

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { mount, textOf, type Host } from '../../test/elementRoot'
import { ModalClose } from '../ui/ModalClose'
import { ConfirmModal } from '../ConfirmModal'
import { AvatarsPanel } from '../AvatarsPanel'

/** A page for the portals to land in: a host as elementRoot makes them, so what lands there can be read and pressed. */
const body = Object.defineProperties({ type: 'body', props: {}, children: [] as Array<Host | string> }, { nodeType: { value: 1 } }) as Host
const hadDocument = 'document' in globalThis
beforeEach(() => {
  body.children.length = 0
  if (!hadDocument) (globalThis as { document?: unknown }).document = { body, visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} }
})
afterEach(() => { if (!hadDocument) delete (globalThis as { document?: unknown }).document })
const portal = (): Host[] => flat(body)
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 5))
/** Press the one button in the portal that says this. */
async function pressIn(words: RegExp): Promise<void> {
  const b = portal().filter((h) => h.type === 'button' && words.test(textOf(h)))
  expect(b).toHaveLength(1)
  ;(b[0].props.onClick as () => void)()
  await settle()
}

const src = new URL('../../', import.meta.url)
const read = (rel: string): string => readFileSync(new URL(rel, src), 'utf8')
const cls = (h: Host): string => String(h.props.className ?? '')
const closes = (hosts: Host[]): Host[] => hosts.filter((h) => h.type === 'button' && cls(h).split(' ').includes('modal-close'))

/** Every modal and sheet this change gave the shared ✕, by its source under src/. */
const TOUCHED = [
  'hud/blueprint/BlueprintTool.tsx',
  'hud/blueprint/BlueprintsModal.tsx',
  'hud/blueprint/ExamineSheet.tsx',
  'terrain/PrizePanel.tsx',
  'terrain/SurveyCard.tsx',
  'terrain/TerrainView.tsx',
  'terrain/CrewPanel.tsx',
  'hud/ActionModal.tsx',
  'hud/AgentTalk.tsx',
  'hud/AvatarsPanel.tsx',
  'hud/ConfirmModal.tsx',
  'hud/CrashNote.tsx',
  'hud/DemoCoach.tsx',
  'hud/DiscoveredPanel.tsx',
  'hud/HosakaOffer.tsx',
  'hud/InventoryPanel.tsx',
  'hud/InvoiceModal.tsx',
  'hud/ItemFeedPicker.tsx',
  'hud/KeyItemInfo.tsx',
  'hud/LoginModal.tsx',
  'hud/LookPicker.tsx',
  'hud/LootDetail.tsx',
  'hud/MuteListModal.tsx',
  'hud/NearbyLootModal.tsx',
  'hud/Notifications.tsx',
  'hud/PersonModal.tsx',
  'hud/ProfileModal.tsx',
  'hud/ProfileView.tsx',
  'hud/SecretModal.tsx',
  'hud/SecretsModal.tsx',
  'hud/ShardFolders.tsx',
  'hud/StashModals.tsx',
  'hud/TutorialCoach.tsx',
  'workshop/PaletteModal.tsx',
  'workshop/ZipImport.tsx',
  'workshop/shell/Sheet.tsx',
]

/**
 * What has role dialog and is not a modal to close: each with why.
 * - GameView: the CLEAR card, whose one way on is EXIT GAME.
 * - ViewMenu: the camera pad, a control strip, not a modal.
 * - DeployBar: the bar a deploy is aimed and confirmed from, with its own CANCEL.
 * - Workshop: the workshop screen itself, closed from its top bar.
 * - KeyLock: the key lock, answered and never closed: unlock, log in again or choose another identity.
 */
const NOT_MODALS = ['game/GameView.tsx', 'hud/ViewMenu.tsx', 'hud/DeployBar.tsx', 'workshop/Workshop.tsx', 'hud/KeyLock.tsx']

function sources(dir: URL, rel = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir.pathname, name)
    if (statSync(path).isDirectory()) {
      if (name === '__tests__' || name === 'test') continue
      out.push(...sources(new URL(`${name}/`, dir), `${rel}${name}/`))
    } else if (name.endsWith('.tsx') && !name.includes('.test.')) out.push(`${rel}${name}`)
  }
  return out
}

describe('ModalClose', () => {
  it('is the ✕ in a small bordered square, named Close, a real button that closes', () => {
    const html = renderToString(createElement(ModalClose, { onClose: () => {} }))
    expect(html).toMatch(/^<button type="button" class="modal-close"/)
    expect(html).toContain('aria-label="Close"')
    expect(html).toContain('title="Close"')
    expect(html).toContain('>✕</button>')
    expect(renderToString(createElement(ModalClose, { onClose: () => {}, label: 'Hide', disabled: true }))).toMatch(/disabled=""[^>]*aria-label="Hide"/)
  })

  it('is drawn 26px with a 44px fingertip in styles.css, and nothing makes it bigger on a phone', () => {
    const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const body = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, sel]) => sel.trim() === '.modal-close')![2]
    expect(body).toMatch(/width: 26px;\s*height: 26px;/)
    expect(css).toMatch(/\.modal-close::before \{ content: ''; position: absolute; inset: -9px; \}/)
    // No other rule naming it sizes it (the KEY ITEMS box was a phone's min-width: 44px on its old class).
    const sizing = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel, b]) => /modal-close/.test(sel) && sel.trim() !== '.modal-close' && !/::before/.test(sel) && /\b(min-)?(width|height):/.test(b))
    expect(sizing).toEqual([])
  })
})

describe('every modal', () => {
  it.each(TOUCHED)('%s renders the shared ✕ and no close of its own', (file) => {
    const s = read(file)
    expect(s).toMatch(/import \{ ModalClose \} from '[./]+(hud\/)?ui\/ModalClose'/)
    expect(s).toMatch(/<ModalClose onClose=\{/)
    expect(s).not.toMatch(/className="[^"]*\b(secret__close|secrets__close|ws__sheet-x)\b/)
    expect(s).not.toMatch(/aria-label="Close the tutorial"[^>]*><X /)
  })

  it('is one of them: every role dialog on a .modal, and every sheet, in src renders the ✕', () => {
    const roots = sources(src).filter((f) => {
      const s = read(f)
      return /role="(alert)?dialog"/.test(s) || /<Sheet\b/.test(s)
    })
    const missing = roots.filter((f) => !NOT_MODALS.includes(f) && !TOUCHED.includes(f) && !/<(Sheet|Shell|ConfirmModal)\b/.test(read(f)))
    expect(missing).toEqual([])
  })
})

describe('mounted', () => {
  it('AVATARS has the ✕ on its title line, no CLOSE at the bottom, and the ✕ closes it as a tap outside does', async () => {
    const m = await mount(createElement(AvatarsPanel))
    await m.press(/^VIEW MORE/)
    const dialog = portal().find((h) => h.props.role === 'dialog')!
    expect(dialog.props['aria-label']).toBe('All avatars')
    const head = portal().find((h) => h.type === 'header')!
    expect(textOf(head)).toBe('Avatars7 SEEN✕')
    expect(closes(flat(head))).toHaveLength(1)
    expect(portal().filter((h) => h.type === 'button' && textOf(h) === 'CLOSE')).toHaveLength(0)
    await pressIn(/^✕$/)
    expect(portal().some((h) => h.props.role === 'dialog')).toBe(false)
    await m.unmount()
  })

  it('the confirm modal: the ✕ on the title line answers nothing, as a tap outside, and is greyed while the confirm is under way', async () => {
    const cancel = vi.fn()
    const aside = vi.fn()
    const m = await mount(createElement(ConfirmModal, { title: 'Delete it?', body: 'x', confirmLabel: 'DELETE', onConfirm: () => {}, onCancel: cancel, onBackdrop: aside }))
    const head = portal().find((h) => cls(h) === 'modal__head')!
    expect(textOf(head)).toBe('Delete it?✕')
    await pressIn(/^✕$/)
    expect(aside).toHaveBeenCalledTimes(1)
    expect(cancel).not.toHaveBeenCalled()
    await m.unmount()
    const busy = await mount(createElement(ConfirmModal, { title: 'Delete it?', body: 'x', confirmLabel: 'DELETE', busy: true, onConfirm: () => {}, onCancel: cancel }))
    expect(closes(portal())[0].props.disabled).toBe(true)
    await busy.unmount()
  })
})

function flat(h: Host): Host[] {
  return h.children.flatMap((c) => (typeof c === 'string' ? [] : [c, ...flat(c)]))
}
