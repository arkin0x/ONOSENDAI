/**
 * eyeEdit.test.tsx - the avatar's eye in the workshop, UI A "the eye on the
 * bench" (arkinox, 2026-11-16): AVATAR's FIRST-PERSON EYE row (AUTO or
 * CHOSEN, the place in gibsons, SET EYE), SET EYE closing the sheet and
 * putting the eye in hand, the move handles stepping it by the grid step,
 * AUTO, CENTER and ORIGIN, NUMBERS, UNDO and REDO, TRY WALK looking from the
 * workshop's eye and coming back, and every shortcut's printed hint.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Host } from '../../test/elementRoot'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

// Nothing here draws: the bench, the compass, the thumbnails and WHAT YOU SEE are WebGL.
vi.mock('../Bench', () => ({ Bench: () => null }))
vi.mock('../EyePreview', () => ({ EyePreview: () => <div className="ws__eyeview" aria-label="What you see" /> }))
vi.mock('../../scene/Compass3D', () => ({ Compass3D: () => null }))
vi.mock('../../hud/ShardThumb', () => ({ ShardThumb: () => null }))
vi.mock('../../hooks/useScrollMemory', () => ({ useScrollMemory: () => () => {} }))
vi.mock('../../hud/ui/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange }: { id: string; checked: boolean; onCheckedChange: (v: boolean) => void }) => (
    <button type="button" role="switch" id={id} aria-checked={checked} onClick={() => onCheckedChange(!checked)}>switch</button>
  ),
  Field: ({ label, children }: { label: string; children: unknown }) => <div className="ui-field"><span>{label}</span>{children as never}</div>,
}))
const { mount, textOf } = await import('../../test/elementRoot')
const { Workshop } = await import('../Workshop')
const { MoveHandles } = await import('../shell/MoveHandles')
const { reportHandles } = await import('../benchAxes')
const { useWorkshop } = await import('../../store/useWorkshop')
const { escapeTop } = await import('../../hooks/useEscape')
const { newShard } = await import('sno-core/shards')
const { useBeginner } = await import('../beginner')
const { useTutorial } = await import('../../store/useTutorial')
const { eyeStatus: statusParts } = await import('../shell/EyeBar')
const eyeStatus = (label: string): string => statusParts(label).join('')
const { eyeSetting, eyeNote } = await import('../sheets/EyeRow')
const { withEye } = await import('../../lib/avatarEye')
const { useAvatars } = await import('../../store/useAvatars')

/** A shard one unit tall and wide, so its automatic eye is 105 ticks up (120 - floor(120 / 8)): 0.88 gibsons. */
function cube() {
  const s = newShard('Cube')
  return {
    ...s,
    vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]].map((p) => ({ p: p as [number, number, number], c: [1, 1, 1] as [number, number, number] })),
    faces: [[0, 1, 2], [0, 2, 3]] as Array<[number, number, number]>,
  }
}

const cls = (h: Host): string => String(h.props.className ?? '')
const byClass = (all: Host[], c: string): Host[] => all.filter((h) => cls(h).split(/\s+/).includes(c))
const words = (h: Host | string): string => (typeof h === 'string' ? h : h.type === '#text' ? String(h.props.text) : h.type === 'kbd' ? '' : h.children.map(words).join(''))
const buttonsIn = (h: Host): Host[] => { const out: Host[] = []; const walkH = (n: Host | string): void => { if (typeof n === 'string') return; if (n.type === 'button') out.push(n); n.children.forEach(walkH) }; walkH(h); return out }
const keyOf = (b: Host): string => { const k = b.children.find((x): x is Host => typeof x !== 'string' && x.type === 'kbd'); return k ? textOf(k) : '' }
const eye = (): unknown => useWorkshop.getState().current()?.extra?.eye
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

beforeEach(() => {
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  if (typeof document === 'undefined') vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null })
  const s = cube()
  useWorkshop.setState({ open: true, shards: [s], currentId: s.id, tool: 'view', selection: [], partSel: [], selectedFaces: [], facePick: [], clip: null, past: [], future: [], openPanel: null, notice: null, eyeEdit: false, division: 1 })
  localStorage.setItem('onosendai:workshop-intro', '1')
  useBeginner.setState({ tools: 'all', step: null, glow: null, done: true, uses: { view: 3, stamp: 3, select: 3, paint: 3, add: 3, face: 3 } })
  useTutorial.setState({ active: false })
  useAvatars.setState({ shards: {} })
})
afterEach(() => {
  useWorkshop.setState({ open: false, eyeEdit: false })
  vi.unstubAllGlobals()
})

describe('FIRST-PERSON EYE in the AVATAR sheet', () => {
  it('says AUTO and the automatic eye in gibsons, then CHOSEN and the chosen one, in the bench\'s frame', async () => {
    const m = await mount(<Workshop />)
    await m.press('AVATAR')
    const row = m.all().find((h) => h.props['aria-label'] === 'First-person eye')!
    expect(row).toBeTruthy()
    expect(words(row)).toContain('FIRST-PERSON EYE')
    expect(words(row)).toContain('Where your camera sits in WALK.')
    expect(words(row)).toContain('AUTO')
    expect(words(row)).toContain('0, 0.88, 0')
    expect(words(row)).toContain('USE THIS SHARD PUBLISHES THE EYE AND FACING.')
    expect(cls(byClass(m.all(), 'ws__eyerow-note')[0])).toBe('ws__eyerow-note')
    expect(buttonsIn(row).map(words)).toEqual(['SET EYE'])
    useWorkshop.getState().setEye([0, 240, 120])
    await tick()
    const after = m.all().find((h) => h.props['aria-label'] === 'First-person eye')!
    expect(words(after)).toContain('CHOSEN')
    // The payload's +Z is the bench's -Z.
    expect(words(after)).toContain('0, 2, -1')
    expect(eyeSetting(useWorkshop.getState().current()!)).toEqual({ mode: 'CHOSEN', place: '0, 2, -1' })
    await m.unmount()
  })

  it('SET EYE closes the sheet and puts the eye in hand: the eye\'s slots in the strip, its status line over them', async () => {
    const m = await mount(<Workshop />)
    await m.press('AVATAR')
    await m.press('SET EYE')
    expect(useWorkshop.getState().eyeEdit).toBe(true)
    expect(byClass(m.all(), 'ws__sheet')).toEqual([])
    const strip = byClass(m.all(), 'ws__strip')[0]
    expect(cls(strip)).toContain('ws__strip--eye')
    expect(buttonsIn(strip).map(words)).toEqual(['AUTO', 'CENTER', 'ORIGIN', 'NUMBERS', 'TRY WALK', 'DONE'])
    const line = byClass(m.all(), 'ws__eyeline')[0]
    expect(words(line)).toBe(`${eyeStatus('0, 0.88, 0')}AUTO`)
    expect(eyeStatus('0, 1.33, 0')).toBe('EYE 0, 1.33, 0 GIBSONS FROM 0, 0, 0')
    // WHAT YOU SEE stands under the view ball.
    expect(m.all().some((h) => h.props['aria-label'] === 'What you see')).toBe(true)
    await m.press('DONE')
    expect(useWorkshop.getState().eyeEdit).toBe(false)
    expect(cls(byClass(m.all(), 'ws__strip')[0])).not.toContain('ws__strip--eye')
    expect(m.all().some((h) => h.props['aria-label'] === 'What you see')).toBe(false)
    await m.unmount()
  })

  it('says when the avatar you wear is this shape with another eye', () => {
    const s = useWorkshop.getState().current()!
    // Not worn, or worn with the same eye: how the eye is published.
    expect(eyeNote(s, null)).toBe('USE THIS SHARD PUBLISHES THE EYE AND FACING.')
    expect(eyeNote(s, { ...s, name: 'Worn' })).toBe('USE THIS SHARD PUBLISHES THE EYE AND FACING.')
    // The workshop's eye moved, the worn one still automatic.
    const chosen = withEye(s, [0, 240, 0])
    expect(eyeNote(chosen, s)).toBe('YOUR WORN AVATAR STILL USES AUTO. USE THIS SHARD TO UPDATE IT.')
    expect(eyeNote(s, chosen)).toBe('YOUR WORN AVATAR STILL USES 0, 2, 0. USE THIS SHARD TO UPDATE IT.')
    // Another shape altogether: nothing to compare.
    expect(eyeNote(chosen, { ...s, vertices: s.vertices.slice(0, 2) })).toBe('USE THIS SHARD PUBLISHES THE EYE AND FACING.')
  })

  it('keeps the strip one height, the eye\'s status line inside it, and the guide card away', () => {
    const css = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8')
    const rule = (sel: string): string => { const at = css.indexOf(`\n${sel} {`); expect(at, sel).toBeGreaterThan(-1); return css.slice(at, css.indexOf('}', at)) }
    // The eye's strip is the strip and one reserved row for its status line, the same height from SET EYE to DONE.
    expect(rule('.ws__strip.ws__strip--eye')).toContain('height: calc(var(--ws-strip) + var(--ws-eyeline))')
    expect(rule('.ws__eyeline')).toContain('height: var(--ws-eyeline)')
    // Its slots keep the held bar's 48px: no rule shrinks them.
    expect(css).not.toMatch(/\.ws__eyebar \.ws__heldbtn \{[^}]*height/)
    const ws = readFileSync(join(__dirname, '..', 'Workshop.tsx'), 'utf8')
    expect(ws).toContain('{sheet === null && !eyeEdit && <Guide />}')
  })

  it('greys the slots that cannot act rather than hiding them', async () => {
    const empty = newShard('Empty')
    useWorkshop.setState({ shards: [empty], currentId: empty.id })
    useWorkshop.getState().setEyeEdit(true)
    const m = await mount(<Workshop />)
    const strip = byClass(m.all(), 'ws__strip')[0]
    const slots = buttonsIn(strip)
    expect(slots.map(words)).toEqual(['AUTO', 'CENTER', 'ORIGIN', 'NUMBERS', 'TRY WALK', 'DONE'])
    expect(slots.filter((b) => b.props.disabled).map(words)).toEqual(['CENTER', 'TRY WALK'])
    await m.unmount()
  })

  it('puts the eye down on Esc, on a tool, on a sheet, and when something is picked up', async () => {
    const m = await mount(<Workshop />)
    const w = useWorkshop.getState
    w().setEyeEdit(true); await tick()
    escapeTop(); await tick()
    expect(w().eyeEdit).toBe(false)
    expect(w().open).toBe(true)
    w().setEyeEdit(true); await tick()
    w().setTool('select'); await tick()
    expect(w().eyeEdit).toBe(false)
    w().setEyeEdit(true); await tick()
    await m.press('GRID')
    expect(w().eyeEdit).toBe(false)
    await m.press('GRID')
    w().setEyeEdit(true); await tick()
    w().setSelection([0]); await tick()
    expect(w().eyeEdit).toBe(false)
    await m.unmount()
  })
})

describe('the eye in hand', () => {
  it('lets go of whatever was held', () => {
    useWorkshop.setState({ selection: [0, 1], selectedFaces: [0] })
    useWorkshop.getState().setEyeEdit(true)
    const st = useWorkshop.getState()
    expect(st.selection).toEqual([])
    expect(st.selectedFaces).toEqual([])
  })

  it('AUTO writes nothing, CENTER the box\'s middle, ORIGIN [0, 0, 0], each one UNDO', async () => {
    useWorkshop.getState().setEyeEdit(true)
    const m = await mount(<Workshop />)
    // AUTO on an automatic eye is no edit at all.
    await m.press('AUTO')
    expect(eye()).toBeUndefined()
    expect(useWorkshop.getState().past).toHaveLength(0)
    await m.press('CENTER')
    // The cube runs 0..120 on X and Y and sits at Z 0.
    expect(eye()).toEqual([60, 60, 0])
    expect(words(byClass(m.all(), 'ws__eyeline')[0])).toBe(`${eyeStatus('0.5, 0.5, 0')}CHOSEN`)
    await m.press('ORIGIN')
    expect(eye()).toEqual([0, 0, 0])
    expect(words(byClass(m.all(), 'ws__eyeline')[0])).toBe(`${eyeStatus('0, 0, 0')}CHOSEN`)
    const origin = buttonsIn(byClass(m.all(), 'ws__strip')[0]).find((b) => words(b) === 'ORIGIN')!
    expect(origin.props['aria-pressed']).toBe(true)
    await m.press('AUTO')
    expect(useWorkshop.getState().current()!.extra).toBeUndefined()
    expect(useWorkshop.getState().past).toHaveLength(3)
    useWorkshop.getState().undo()
    expect(eye()).toEqual([0, 0, 0])
    useWorkshop.getState().undo()
    expect(eye()).toEqual([60, 60, 0])
    useWorkshop.getState().redo()
    expect(eye()).toEqual([0, 0, 0])
    // UNDO keeps the eye in hand.
    expect(useWorkshop.getState().eyeEdit).toBe(true)
    await m.unmount()
  })

  it('NUMBERS opens X, Y and Z steppers in gibsons, each press one grid step', async () => {
    useWorkshop.setState({ division: 4 })
    useWorkshop.getState().setEyeEdit(true)
    const m = await mount(<Workshop />)
    await m.press('NUMBERS')
    const nums = byClass(m.all(), 'ws__eyenums')[0]
    expect(nums).toBeTruthy()
    expect(words(nums)).toContain('A STEP IS 0.25 GIBSONS')
    const press = (label: string): void => {
      const b = buttonsIn(nums).find((x) => x.props['aria-label'] === label)!
      ;(b.props.onPointerDown as (e: unknown) => void)({ preventDefault: () => {}, stopPropagation: () => {} })
      ;(b.props.onPointerUp as () => void)()
    }
    // From the automatic eye, 105 up, off the grid: the first step up lands on the grid at 120, and the eye is CHOSEN.
    press('Y up a step')
    expect(eye()).toEqual([0, 120, 0])
    press('Y up a step')
    expect(eye()).toEqual([0, 150, 0])
    press('X down a step')
    expect(eye()).toEqual([-30, 150, 0])
    // The bench's +Z is the payload's -Z.
    press('Z up a step')
    expect(eye()).toEqual([-30, 150, -30])
    await tick()
    expect(words(byClass(m.all(), 'ws__eyenums')[0])).toContain('-0.25')
    expect(words(byClass(m.all(), 'ws__eyeline')[0])).toBe(`${eyeStatus('-0.25, 1.25, 0.25')}CHOSEN`)
    await m.unmount()
  })

  it('stops at the reach WALK honours: 4 gibsons at the avatar\'s true scale', () => {
    // The cube at unit 0 is drawn at true scale: 4 gibsons is 480 ticks.
    useWorkshop.getState().setEye([0, 480, 0])
    expect(useWorkshop.getState().moveEye(1, 120)).toBe(false)
    expect(eye()).toEqual([0, 480, 0])
    expect(useWorkshop.getState().moveEye(1, -120)).toBe(true)
    expect(eye()).toEqual([0, 360, 0])
    // At unit 1 a tick is twice the gibsons: the reach is 240 ticks, and NUMBERS stops there too.
    useWorkshop.setState({ shards: [{ ...useWorkshop.getState().current()!, unit: 1 }] })
    useWorkshop.getState().setEye([0, 240, 0])
    expect(useWorkshop.getState().moveEye(1, 120)).toBe(false)
    expect(useWorkshop.getState().moveEye(0, 120)).toBe(true)
    expect(eye()).toEqual([120, 240, 0])
  })

  it('prints only the eye WALK uses: one past the size limit is brought in along its line', async () => {
    // 9 gibsons up, written by hand: WALK brings it to 4.
    useWorkshop.getState().setEye([0, 1080, 0])
    expect(eyeSetting(useWorkshop.getState().current()!)).toEqual({ mode: 'CHOSEN', place: '0, 4, 0' })
    // NUMBERS shows the same eye.
    useWorkshop.getState().setEyeEdit(true)
    const m = await mount(<Workshop />)
    await m.press('NUMBERS')
    const y = byClass(m.all(), 'ws__eyenum').find((h) => h.props['aria-label'] === 'Y')!
    expect(words(y)).toBe('\u22124Y+')
    await m.unmount()
  })

  it('moves from the eye WALK uses, so an eye left past the limit comes back inside on the first move', () => {
    const w = useWorkshop.getState
    // At unit 0, 480 ticks is the limit, 4 gibsons. The unit raised to 1, the limit is 240 ticks.
    w().setEye([0, 480, 0])
    useWorkshop.setState({ shards: [{ ...w().current()!, unit: 1 }] })
    // Away from the middle: refused, nothing written.
    expect(w().moveEye(1, 120)).toBe(false)
    expect(eye()).toEqual([0, 480, 0])
    // Back toward the middle: from the pulled-in 240, one step down, written inside the limit.
    expect(w().moveEye(1, -120)).toBe(true)
    expect(eye()).toEqual([0, 120, 0])
    // Sideways from a far eye: pulled in first, then the step.
    w().setEye([0, 960, 0])
    expect(w().moveEye(0, 120)).toBe(true)
    expect(eye()).toEqual([120, 240, 0])
  })
})

describe('the move handles on the eye', () => {
  /** The handles drawn on a frame: the hosts given what the draw writes, then the frame reported. */
  async function handles() {
    const m = await mount(<MoveHandles />)
    const dress = (): void => { for (const h of m.all()) Object.assign(h, { style: (h as unknown as { style?: object }).style ?? {}, setAttribute: () => {} }) }
    dress()
    // +X right, +Y up, +Z down and left, 50px a unit; 0, 0, 0 below.
    reportHandles({ center: [100, 100], perUnit: [[50, 0], [0, -50], [-30, 30]], origin: [100, 200] })
    const knob = (axis: string): Host => m.all().find((h) => h.type === 'button' && String(h.props['aria-label']).startsWith(`Move the eye along ${axis}`))!
    const ev = (x: number, y: number, type = 'pointermove') => ({ pointerType: 'mouse', button: 0, pointerId: 1, clientX: x, clientY: y, type, preventDefault: () => {}, stopPropagation: () => {}, currentTarget: { setPointerCapture: () => {} } })
    return { m, dress, knob, ev }
  }

  it('are the eye\'s while SET EYE is on: a tap is one grid step at the current snap, a drag whole steps and one UNDO', async () => {
    useWorkshop.setState({ division: 4 })
    useWorkshop.getState().setEyeEdit(true)
    const { m, knob, ev } = await handles()
    const y = knob('Y')
    expect(y).toBeTruthy()
    ;(y.props.onPointerDown as (e: unknown) => void)(ev(0, 0, 'pointerdown'))
    ;(y.props.onPointerUp as (e: unknown) => void)(ev(0, 0, 'pointerup'))
    // From AUTO's 105, off the grid of 30: the first step lands on it, at 120.
    expect(eye()).toEqual([0, 120, 0])
    expect(useWorkshop.getState().past).toHaveLength(1)
    // Two units up the screen: 240 ticks, eight steps of 30, one UNDO.
    ;(y.props.onPointerDown as (e: unknown) => void)(ev(0, 0, 'pointerdown'))
    ;(y.props.onPointerMove as (e: unknown) => void)(ev(0, -100))
    ;(y.props.onPointerUp as (e: unknown) => void)(ev(0, -100, 'pointerup'))
    expect(eye()).toEqual([0, 360, 0])
    expect(useWorkshop.getState().past).toHaveLength(2)
    useWorkshop.getState().undo()
    expect(eye()).toEqual([0, 120, 0])
    useWorkshop.getState().undo()
    expect(eye()).toBeUndefined()
    // +Z on the bench is the payload's -Z.
    const z = knob('Z')
    ;(z.props.onPointerDown as (e: unknown) => void)(ev(0, 0, 'pointerdown'))
    ;(z.props.onPointerUp as (e: unknown) => void)(ev(0, 0, 'pointerup'))
    expect(eye()).toEqual([0, 105, -30])
    // After CENTER (60, 60, 0), off a whole unit's grid on Y: one step up lands on the grid at 120.
    useWorkshop.setState({ division: 1 })
    useWorkshop.getState().setEye([60, 60, 0])
    ;(y.props.onPointerDown as (e: unknown) => void)(ev(0, 0, 'pointerdown'))
    ;(y.props.onPointerUp as (e: unknown) => void)(ev(0, 0, 'pointerup'))
    expect(eye()).toEqual([60, 120, 0])
    // The marker, the dashed line and TODAY'S EYE are drawn.
    expect(m.all().some((h) => cls(h).includes('ws__handle-hub--eye'))).toBe(true)
    expect(m.all().some((h) => cls(h).includes('ws__eye-line'))).toBe(true)
    expect(m.all().some((h) => words(h) === '0, 0, 0 · TODAY\'S EYE')).toBe(true)
    await m.unmount()
  })

  it('move what is held, not the eye, once SET EYE is off', async () => {
    useWorkshop.setState({ selection: [0] })
    const { m, knob } = await handles()
    expect(knob('Y')).toBeUndefined()
    expect(m.all().some((h) => cls(h).includes('ws__handle-hub--eye'))).toBe(false)
    await m.unmount()
  })
})

describe('key hints', () => {
  it('prints E on SET EYE and DONE, and the move keys on the status line', async () => {
    const m = await mount(<Workshop />)
    await m.press('AVATAR')
    expect(keyOf(m.buttons('SET EYE')[0])).toBe('E')
    await m.press('SET EYE')
    expect(keyOf(m.buttons('DONE')[0])).toBe('E')
    const keys = byClass(m.all(), 'ws__eyeline-keys')[0]
    expect(keys.type).toBe('kbd')
    expect(textOf(keys)).toBe('WASD R F MOVE · E DONE')
    await m.unmount()
  })

  it('writes no em dash anywhere it touches', () => {
    for (const f of ['shell/EyeBar.tsx', 'sheets/EyeRow.tsx', 'EyePreview.tsx', 'shell/MoveHandles.tsx']) {
      expect(readFileSync(join(__dirname, '..', f), 'utf8')).not.toContain(String.fromCharCode(0x2014))
    }
  })
})
