/**
 * tutorialChoiceIcons.test.tsx: the tutorial's "Where next?" card (arkinox,
 * 2026-11-13: "align-left a large icon representing each end-tutorial
 * option, then the existing text inside the option can be to the right").
 * Every route wears its icon in the left column, hidden from a screen
 * reader, and its words (its accessible name) are what they were, a route
 * already done included. No network.
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
  ;(globalThis as { document?: unknown }).document ??= { addEventListener: () => undefined, removeEventListener: () => undefined, body: { nodeType: 1 } }
})

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  onAuthChange: () => () => {},
  signInFailed: () => false,
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
// The card renders through a portal into document.body; here, the element itself.
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-dom')>()), createPortal: (el: unknown) => el }))
vi.mock('../../hooks/useCover', () => ({ useCover: () => () => undefined }))
vi.mock('../../hooks/useEscape', () => ({ useEscape: () => undefined }))

import { mount, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { registerTutorialChoice, useTutorial } from '../../store/useTutorial'
import { CHOICE } from '../../tutorial/script'
import { CHOICE_ICONS, TutorialCoach } from '../TutorialCoach'

/** Each route's icon, as lucide names its svg's class. */
const ICON_CLASS: Record<string, string> = {
  hyperspace: 'lucide-earth',
  dungeon: 'lucide-gamepad-2',
  agents: 'lucide-bot',
  friend: 'lucide-target',
  build: 'lucide-wrench',
}

const kids = (h: Host): Host[] => h.children.filter((c): c is Host => typeof c !== 'string')
const routes = (card: Mounted): Host[] => card.all().filter((h) => h.type === 'button' && String(h.props.className).includes('tutorial-choice'))
const svgsUnder = (h: Host): Host[] => { const out: Host[] = []; const go = (x: Host): void => { if (x.type === 'svg') out.push(x); kids(x).forEach(go) }; go(h); return out }

let card: Mounted | null = null

beforeEach(() => {
  // The dungeon is offered once its run is registered (tutorial/dungeon.ts does it in the app; this file's registry is its own).
  registerTutorialChoice('dungeon', { run: () => {} })
  useTutorial.setState({ active: true, index: 0, script: { steps: [CHOICE] }, doneChoices: [], choosing: null, choiceNote: '' })
})
afterEach(async () => {
  await card?.unmount()
  card = null
  useTutorial.setState({ active: false, doneChoices: [] })
})

describe('the Where next? card', () => {
  it('every route has an icon', () => {
    for (const c of CHOICE.choices!) expect(CHOICE_ICONS[c.id], c.id).toBeDefined()
  })

  it('each route: its icon first, in the left column, hidden; then its words, unchanged', async () => {
    card = await mount(<TutorialCoach />)
    const buttons = routes(card)
    expect(buttons.map((b) => textOf(b))).toEqual(CHOICE.choices!.map((c) => c.label + c.about))
    CHOICE.choices!.forEach((c, i) => {
      const [column, words] = kids(buttons[i])
      expect(column.props.className).toBe('tutorial-choice__icon')
      expect(column.props['aria-hidden']).toBe(true)
      // The column holds the icon and no words, so the button's name is its words alone.
      expect(textOf(column)).toBe('')
      const [svg] = svgsUnder(column)
      expect(String(svg.props.className), c.id).toContain(ICON_CLASS[c.id])
      expect(words.props.className).toBe('tutorial-choice__text')
      expect(textOf(words)).toBe(c.label + c.about)
      // No aria-label of its own: the words name it, as before.
      expect(buttons[i].props['aria-label']).toBeUndefined()
    })
  })

  it('a route already done keeps its icon beside its check and DONE words', async () => {
    useTutorial.setState({ doneChoices: ['agents'] })
    card = await mount(<TutorialCoach />)
    const agents = routes(card).find((b) => textOf(b).startsWith('BRING YOUR AI'))!
    expect(String(agents.props.className)).toContain('is-done')
    const [column, words] = kids(agents)
    expect(String(svgsUnder(column)[0].props.className)).toContain('lucide-bot')
    expect(textOf(words)).toBe('BRING YOUR AIDone. Try another.')
    // The check mark sits with the label, in the words, not in the icon column.
    expect(svgsUnder(words).some((s) => String(s.props.className).includes('lucide-check'))).toBe(true)
  })

  it('a route under way says One moment. beside its icon, and every route waits', async () => {
    useTutorial.setState({ choosing: 'dungeon' })
    card = await mount(<TutorialCoach />)
    const buttons = routes(card)
    const dungeon = buttons.find((b) => textOf(b).startsWith('PLAY THE DUNGEON'))!
    const [column, words] = kids(dungeon)
    expect(String(svgsUnder(column)[0].props.className)).toContain('lucide-gamepad-2')
    expect(textOf(words)).toBe('PLAY THE DUNGEONOne moment.')
    for (const b of buttons) expect(b.props['aria-disabled']).toBe(true)
  })
})
