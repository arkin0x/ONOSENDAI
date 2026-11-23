/**
 * tourFixes.test.ts: the owner's play test of the newcomer preview
 * (2026-11-23), one block per note:
 *
 * - every step that points at a control points at one the newcomer view
 *   shows at that step, and the pulse survives the control arriving and its
 *   class changing (GRAVITY did not pulse);
 * - the course target is a 3-gibson cube: inside and on its edges counts,
 *   one past does not;
 * - the chest shot looks from below and to the right, fits what the HUD
 *   leaves uncovered, and OPEN to TAKE keeps it without easing again;
 * - "Your AI" opens the menu on AGENTS, pulses COPY, and has FINISH only
 *   after the press;
 * - "Build something" follows each press until something is placed, and
 *   has FINISH only then;
 * - every tour button row is one height;
 * - "You made it!";
 * - the newcomer view's default is newcomers, one word to flip.
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'

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
vi.mock('../../lib/relay', async (orig) => ({ ...(await orig() as object), publish: vi.fn(async () => ({ ok: true, accepted: [] })), publishMany: vi.fn(async () => ({ ok: true, accepted: [] })), query: vi.fn(async () => []) }))
const menu = vi.hoisted(() => ({ calls: [] as boolean[] }))
vi.mock('../../hooks/useMenuOpen', async (orig) => ({ ...(await orig() as object), setMenuOpen: (o: boolean) => { menu.calls.push(o) } }))

import { ADVANCE_MS, useTutorial } from '../../store/useTutorial'
import { usePanelLayout } from '../../store/usePanelLayout'
import { useShards } from '../../store/useShards'
import { useTutorialCam, setTutorialShot, type TutorialShot } from '../../store/useTutorialCam'
import { useAgentInviteCopies } from '../../store/agentInvite'
import { markPulse } from '../../hud/TutorialCoach'
import { chestShotDir, fitInBand } from '../../lib/hopFraming'
import { REVEAL, revealed, type RevealId } from '../../newcomer/reveal'
import { stepsThrough, NEWCOMER_DEFAULT, newcomerViewOf } from '../../newcomer/useNewcomer'
import { AGENTS, BUILD_PLACE, COMMIT, FINISH, PAD_ARROWS, TUTORIAL_SCRIPT } from '../script'
import { TARGET, TARGET_SIDE, TARGET_ZONE, courseToWorld, onTarget, targetAt } from '../course'
import { tutorialLayout } from '../layout'
import { BUILD_STAGES, buildStage, type BuildFacts } from '../buildRoute'
import { BOARD_PICK_FIRST_GLOW, TRIPS_GLOW } from '../earthRoute'
import { FINER_KEY } from '../director'

const CSS = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')
const steps = TUTORIAL_SCRIPT.steps
const at = (id: string): number => steps.findIndex((s) => s.id === id)

/** The part of the newcomer view a selector's control lives in, or null for one the view never stages (a chip, the coach, a card). */
function partOf(selector: string): RevealId | null {
  const panel = selector.match(/\[data-panel-id="([a-z]+)"\]/)
  if (panel) return `panel.${panel[1]}` as RevealId
  if (selector.includes('.items-modal')) return 'panel.items'
  if (selector.includes('.hamburger-menu')) return 'menu'
  if (selector.includes('.touchpad__key--gravity')) return 'pad.gravity'
  if (/\.touchpad__key--zoom(in|out)/.test(selector)) return 'pad.zoom'
  if (selector.includes('.touchpad__key--')) return 'pad.arrows'
  if (selector.includes('.touchops__walk')) return 'pad.recall'
  if (/\.touchops__commit\.is-(hop|view|scan|build)\b/.test(selector)) return 'pad.modes'
  if (selector.includes('.touchops__commit')) return 'pad.go'
  return null
}

/** Each comma-separated control of a highlight. */
const parts = (highlight: string): string[] => highlight.split(/,(?![^(]*\))/).map((p) => p.trim()).filter(Boolean)

/** What a staged newcomer has seen on reaching `id`: the way through, and for a route step the route so far. */
function seenAt(id: string): Set<string> {
  const seen = new Set(stepsThrough(steps, at(id)))
  for (let s = steps[at(id)]; s; ) {
    const before = steps.find((st) => st.branch && st.then === s.id)
    if (!before) break
    seen.add(before.id)
    s = before
  }
  return seen
}

describe('every control the tour points at is on screen and pulses (owner: "gravity is not pulsing here")', () => {
  /** Each step's highlights: its scene's, and the ones its effect points at instead as it goes. */
  const pointed: Array<[string, string]> = [
    ...steps.filter((s) => s.scene?.highlight).map((s) => [s.id, s.scene!.highlight!] as [string, string]),
    ['to-course', PAD_ARROWS], ['to-course', COMMIT], ['to-course', FINER_KEY],
    ['earth-board', BOARD_PICK_FIRST_GLOW], ['earth-board', TRIPS_GLOW], ['earth-ride', TRIPS_GLOW],
    ...Object.values(BUILD_STAGES).map((b) => ['build-place', b.glow] as [string, string]),
  ]

  it.each(pointed)('%s points at %s, which the newcomer view shows then', (id, highlight) => {
    const state = { newcomer: true, staged: true, seen: seenAt(id) }
    for (const p of parts(highlight)) {
      const part = partOf(p)
      if (part) expect(revealed(part, state), `${id}: ${p} is in ${part}, which waits for ${REVEAL[part]}`).toBe(true)
    }
  })

  it('the pulse is put back after a class change, and marking again changes nothing', () => {
    const el = (): { classList: { set: Set<string>; add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean } } => {
      const set = new Set<string>()
      return { classList: { set, add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) } }
    }
    const gravity = el()
    const other = el()
    let marked = markPulse([], [gravity as unknown as Element])
    expect(gravity.classList.contains('demo-pulse')).toBe(true)
    // React writes the button's whole class as it arrives: the pulse is gone, and marking again puts it back.
    gravity.classList.set.clear()
    marked = markPulse(marked, [gravity as unknown as Element])
    expect(gravity.classList.contains('demo-pulse')).toBe(true)
    // Moving on: off the old control, on the new.
    marked = markPulse(marked, [other as unknown as Element])
    expect(gravity.classList.contains('demo-pulse')).toBe(false)
    expect(other.classList.contains('demo-pulse')).toBe(true)
  })

  it('a control arriving on the step that points at it keeps the pulse animating, and the coach watches class changes', () => {
    expect(CSS).toContain('.nc-arrive.demo-pulse { animation: nc-arrive 1.4s cubic-bezier(0.2, 0.7, 0.2, 1) backwards, demo-pulse 1.4s ease-out infinite; }')
    const coach = readFileSync(new URL('../../hud/TutorialCoach.tsx', import.meta.url), 'utf8')
    expect(coach).toContain("attributes: true, attributeFilter: ['class']")
  })
})

describe('the course target is a region (owner: "the space that we are supposed to move to is too small")', () => {
  const l = tutorialLayout({ x: 1n << 40n, y: 1n << 40n, z: 1n << 40n }, 0)
  it('is a 3-gibson cube round the target gibson', () => {
    expect(TARGET_SIDE).toBe(3)
    expect(TARGET_ZONE.y).toEqual([TARGET[1] - 1, TARGET[1] + 1])
  })
  it('counts every gibson inside and on its edges, and none past them', () => {
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
      expect(onTarget(l.frame, courseToWorld(l.frame, [TARGET[0] + dx, TARGET[1] + dy, TARGET[2] + dz]))).toBe(true)
    }
    for (const [dx, dy, dz] of [[2, 0, 0], [-2, 0, 0], [0, 2, 0], [0, -2, 0], [0, 0, 2], [0, 0, -2]]) {
      expect(onTarget(l.frame, courseToWorld(l.frame, [TARGET[0] + dx, TARGET[1] + dy, TARGET[2] + dz]))).toBe(false)
    }
    expect(onTarget(l.frame, targetAt(l.frame))).toBe(true)
  })
})

describe('the chest shot (owner: "this new view is below and to the right")', () => {
  it('looks from below and to the right of the chest, so the avatar in front stands to its left', () => {
    const front = new Vector3(0, 0, 1)
    const dir = chestShotDir(front)
    expect(dir.y).toBeLessThan(0)
    // Screen right as seen from the front, looking at the chest: up x front = +x.
    expect(dir.x).toBeGreaterThan(0)
    expect(dir.z).toBeGreaterThan(0)
    // The avatar (2 in front of the chest) projects left of it: its offset against the camera's right is negative.
    const look = dir.clone().negate()
    const right = new Vector3().crossVectors(look, new Vector3(0, 1, 0)).normalize()
    expect(new Vector3(0, 0, 2).dot(right)).toBeLessThan(0)
  })

  it('stands further back when the tour card and the pad leave less of the screen', () => {
    const whole = fitInBand(3, 50, 375, 812, { left: 0, top: 0, right: 375, bottom: 812 })
    const band = fitInBand(3, 50, 375, 812, { left: 0, top: 270, right: 375, bottom: 560 })
    expect(band).toBeGreaterThan(whole)
  })

  it('the shot is keyed by where the avatar stands: OPEN to TAKE keeps it, a new place frames again', async () => {
    const { welcomeChestShot } = await import('../director')
    const l = tutorialLayout({ x: 1n << 40n, y: 1n << 40n, z: 1n << 40n }, 0)
    const here = { x: 5n, y: 6n, z: 7n }
    expect(welcomeChestShot(l, here).key).toBe(welcomeChestShot(l, { ...here }).key)
    expect(welcomeChestShot(l, { ...here, x: 6n }).key).not.toBe(welcomeChestShot(l, here).key)
  })

  it('a step asking for the same chest keeps the shot as it is, eased or not', () => {
    const shot: TutorialShot = { key: 'welcome-chest', chest: { x: 0n, y: 0n, z: 0n }, points: [], margin: 1, ease: true }
    setTutorialShot(shot)
    useTutorialCam.setState({ shot: { ...shot, ease: false } })
    const eased = useTutorialCam.getState().shot
    setTutorialShot({ ...shot })
    expect(useTutorialCam.getState().shot).toBe(eased)
    setTutorialShot(null)
    expect(useTutorialCam.getState().shot).toBe(null)
  })

  it('OPEN, TAKE and the finish chest ask for it', () => {
    expect(steps[at('open')].effect).toBe('chest-shot')
    expect(steps[at('take')].effect).toBe('chest-shot')
    expect(FINISH.effect).toBe('finish-shot')
    // The lens shift that frames BUILD's cursor frames the shot too.
    const scene = readFileSync(new URL('../../scene/Scene.tsx', import.meta.url), 'utf8')
    expect(scene).toContain('useBuilder.getState().active || useTutorialCam.getState().shot !== null')
  })
})

describe('the tour steps that wait on a press', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    menu.calls.length = 0
    useTutorial.setState({ script: TUTORIAL_SCRIPT, doneChoices: [] })
    usePanelLayout.setState({ front: null, frontOnly: false })
  })
  afterEach(() => {
    useTutorial.getState().pause()
    vi.useRealTimers()
  })
  const id = (): string => useTutorial.getState().script.steps[useTutorial.getState().index].id

  it('Your AI opens the menu on AGENTS, pulses COPY, and has FINISH only once COPY is pressed', async () => {
    await import('../director')
    expect(AGENTS.scene?.highlight).toContain('[data-panel-id="agents"] .agents__invite-copy')
    useTutorial.getState().start({ at: 'choice' })
    useTutorial.getState().choose('agents')
    expect(id()).toBe('agents')
    expect(menu.calls).toContain(true)
    expect(usePanelLayout.getState().front).toBe('agents')
    // Waiting: the coach reads SKIP, not FINISH.
    expect(useTutorial.getState().done).toBe(false)
    useAgentInviteCopies.setState((s) => ({ presses: s.presses + 1 }))
    expect(useTutorial.getState().done).toBe(true)
    // Done, and it stays for FINISH: never on by itself.
    vi.advanceTimersByTime(ADVANCE_MS * 4)
    expect(id()).toBe('agents')
    expect(useTutorial.getState().doneChoices).toEqual(['agents'])
    useTutorial.getState().next()
    expect(id()).toBe('choice')
    expect(usePanelLayout.getState().front).toBe(null)
  })

  it('Build something follows each press, shows ITEMS alone, and has FINISH only once something is placed', async () => {
    await import('../buildRoute')
    expect(BUILD_PLACE.wait).toBe('placed')
    expect(BUILD_PLACE.stay).toBe(true)
    useTutorial.getState().start({ at: 'choice' })
    useTutorial.getState().choose('build')
    expect(id()).toBe('build-place')
    expect(usePanelLayout.getState()).toMatchObject({ front: 'items', frontOnly: true })
    expect(useTutorial.getState().stepNote).toBe(BUILD_STAGES.menu.note)
    expect(useTutorial.getState().stepHighlight).toBe(BUILD_STAGES.menu.glow)
    expect(useTutorial.getState().done).toBe(false)
    // Placed: done, and it stays for FINISH.
    useShards.setState({ placedLast: { pending: null, spot: 'x', count: 1 } as never })
    expect(useTutorial.getState().done).toBe(true)
    vi.advanceTimersByTime(ADVANCE_MS * 4)
    expect(id()).toBe('build-place')
    useTutorial.getState().next()
    expect(id()).toBe('choice')
    expect(usePanelLayout.getState()).toMatchObject({ front: null, frontOnly: false })
  })

  it('works out the next press from what the player has really done, in any order', () => {
    const base: BuildFacts = { menuOpen: false, itemsOpen: null, shardActionsOpen: false, inWorkshop: false, building: false, armed: false, picking: false, lined: false }
    const walk: Array<[Partial<BuildFacts>, string]> = [
      [{}, 'menu'],
      [{ menuOpen: true }, 'loot'],
      [{ menuOpen: true, itemsOpen: 'loot' }, 'actions'],
      [{ menuOpen: true, itemsOpen: 'loot', shardActionsOpen: true }, 'move'],
      [{ menuOpen: true, itemsOpen: 'loot', inWorkshop: true }, 'close'],
      [{ menuOpen: true, inWorkshop: true }, 'close'],
      [{ inWorkshop: true }, 'build'],
      [{ inWorkshop: true, building: true }, 'object'],
      [{ inWorkshop: true, building: true, picking: true }, 'pick'],
      [{ inWorkshop: true, building: true, lined: true }, 'place'],
    ]
    for (const [f, stage] of walk) expect(buildStage({ ...base, ...f })).toBe(stage)
    // Off script: the menu shut before OTHER LOOT points back at the menu; KEY ITEMS opened by mistake points at its ✕.
    expect(buildStage({ ...base, menuOpen: false })).toBe('menu')
    expect(buildStage({ ...base, menuOpen: true, itemsOpen: 'keys' })).toBe('keys')
    // The cursor off the avatar: the slot is COMMIT, so RECALL first, then the mode button.
    expect(buildStage({ ...base, inWorkshop: true, armed: true })).toBe('recall')
    // Straight into BUILD with a shard already in the workshop: OBJECT.
    expect(buildStage({ ...base, building: true })).toBe('object')
  })
})

describe('copy and buttons', () => {
  it('"You made it!"', () => {
    expect(FINISH.title).toBe('You made it!')
  })

  it('every tour button row is one height, every button in it, on every card', () => {
    expect(CSS).toContain('.demo__foot { --tour-row-h: 32px; }')
    expect(CSS).toContain('.tutorial-card__foot { --tour-row-h: 40px; }')
    expect(CSS).toContain('.demo__foot > .demo__btn,\n.tutorial-card__foot > .demo__btn { height: var(--tour-row-h); min-height: var(--tour-row-h); align-self: stretch; }')
    // Every button the coach puts in a row is a .demo__btn: the route list's DONE, the final card's FINISH, BACK, NEXT, SKIP, EXPLAIN.
    const coach = readFileSync(new URL('../../hud/TutorialCoach.tsx', import.meta.url), 'utf8')
    for (const row of coach.match(/<div className="(demo__foot|tutorial-card__foot)">[\s\S]*?<\/div>/g) ?? []) {
      for (const b of row.match(/<button\b[^>]*className=\{?[`"][^`"]*/g) ?? []) expect(b).toContain('demo__btn')
    }
  })

  it('chamfered buttons keep every edge outlined, the diagonals too', () => {
    expect(CSS).toContain('.cham-btn::before {')
    expect(CSS).toContain('--in-cut: calc(var(--cham-cut) - var(--cham-line-w) * 0.5858);')
    expect(readFileSync(new URL('../../hud/NewcomerSetting.tsx', import.meta.url), 'utf8')).toContain('cham-btn nc-setting__opt')
  })

  it('the newcomer view is the default for newcomers, one word away from everyone', () => {
    expect(NEWCOMER_DEFAULT).toBe('newcomers')
    // An experienced player with no record keeps the full HUD; a graduated one too.
    expect(newcomerViewOf({ seen: [] }, true)).toBe(false)
    expect(newcomerViewOf({ stage: 'graduated', seen: [] }, true)).toBe(false)
    expect(newcomerViewOf({ stage: 'newcomer', seen: [] }, true)).toBe(true)
  })
})
