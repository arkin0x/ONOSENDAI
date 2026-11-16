/**
 * facingRow.test.tsx - FACING in the AVATAR sheet (DECK-0003 §1.18; arkinox,
 * 2026-11-16): PATH and UPRIGHT next to FIRST-PERSON EYE, in its style; a
 * press writes the field through sno-core (PATH leaves it out), one UNDO; the
 * bench shows the choice while the sheet is open; the shared reserved line
 * says when the worn avatar still turns the old way.
 */

import { Vector3 } from 'three'
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
const { mount } = await import('../../test/elementRoot')
const { Workshop } = await import('../Workshop')
const { useWorkshop } = await import('../../store/useWorkshop')
const { newShard } = await import('sno-core/shards')
const { useBeginner } = await import('../beginner')
const { useTutorial } = await import('../../store/useTutorial')
const { eyeNote } = await import('../sheets/EyeRow')
const { useFacingPreview } = await import('../../store/facingPreview')
const { facingPreviewTurn } = await import('../FacingPreview')
const { withFace } = await import('sno-core/face')
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
const words = (h: Host | string): string => (typeof h === 'string' ? h : h.type === '#text' ? String(h.props.text) : h.type === 'kbd' ? '' : h.children.map(words).join(''))
const buttonsIn = (h: Host): Host[] => { const out: Host[] = []; const walkH = (n: Host | string): void => { if (typeof n === 'string') return; if (n.type === 'button') out.push(n); n.children.forEach(walkH) }; walkH(h); return out }
const face = (): unknown => useWorkshop.getState().current()?.extra?.face

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

describe('FACING in the AVATAR sheet', () => {
  it('stands above FIRST-PERSON EYE in its style: PATH and UPRIGHT, PATH on by default', async () => {
    const m = await mount(<Workshop />)
    await m.press('AVATAR')
    const groups = m.all().filter((h) => h.props.role === 'group' && (h.props['aria-label'] === 'Facing' || h.props['aria-label'] === 'First-person eye'))
    const row = groups.find((h) => h.props['aria-label'] === 'Facing' && cls(h).includes('ws__eyerow'))!
    expect(row).toBeTruthy()
    expect(words(row)).toContain('FACING')
    expect(words(row)).toContain('How you turn as you move.')
    const buttons = buttonsIn(row)
    expect(buttons.map(words)).toEqual(['PATH', 'UPRIGHT'])
    expect(buttons.map((b) => b.props['aria-pressed'])).toEqual([true, false])
    // Above the eye row, as one block in the sheet.
    const order = m.all().filter((h) => cls(h).split(/\s+/).includes('ws__eyerow')).map((h) => h.props['aria-label'])
    expect(order).toEqual(['Facing', 'First-person eye'])
    await m.unmount()
  })

  it('UPRIGHT writes the field, PATH takes it away again, each one UNDO; pressing what is on changes nothing', async () => {
    const m = await mount(<Workshop />)
    await m.press('AVATAR')
    await m.press('UPRIGHT')
    expect(face()).toBe('upright')
    const row = m.all().find((h) => h.props['aria-label'] === 'Facing' && cls(h).includes('ws__eyerow'))!
    expect(buttonsIn(row).map((b) => b.props['aria-pressed'])).toEqual([false, true])
    const steps = useWorkshop.getState().past.length
    await m.press('UPRIGHT')
    expect(useWorkshop.getState().past.length).toBe(steps)
    await m.press('PATH')
    expect(face()).toBeUndefined()
    expect(useWorkshop.getState().current()!.extra?.face).toBeUndefined()
    useWorkshop.getState().undo()
    expect(face()).toBe('upright')
    useWorkshop.getState().undo()
    expect(face()).toBeUndefined()
    await m.unmount()
  })

  it('shows the choice on the bench only while the AVATAR sheet is open', async () => {
    const m = await mount(<Workshop />)
    expect(useFacingPreview.getState().on).toBe(false)
    await m.press('AVATAR')
    expect(useFacingPreview.getState().on).toBe(true)
    await m.press('AVATAR')
    expect(useFacingPreview.getState().on).toBe(false)
    await m.unmount()
  })

  it('on the bench, UPRIGHT stands up and PATH tilts up the arrow', () => {
    const nose = (q: ReturnType<typeof facingPreviewTurn>): number[] => new Vector3(0, 0, -1).applyQuaternion(q).toArray().map((n) => +n.toFixed(3) + 0)
    const top = (q: ReturnType<typeof facingPreviewTurn>): number[] => new Vector3(0, 1, 0).applyQuaternion(q).toArray().map((n) => +n.toFixed(3) + 0)
    expect(top(facingPreviewTurn('upright'))).toEqual([0, 1, 0])
    expect(nose(facingPreviewTurn('upright'))).toEqual([1, 0, 0])
    expect(nose(facingPreviewTurn('path'))).toEqual([0.707, 0.707, 0])
  })

  it('says when the avatar you wear is this shape with another facing', () => {
    const s = useWorkshop.getState().current()!
    const up = withFace(s, 'upright')
    expect(eyeNote(up, s)).toBe('YOUR WORN AVATAR STILL USES PATH. USE THIS SHARD TO UPDATE IT.')
    expect(eyeNote(s, up)).toBe('YOUR WORN AVATAR STILL USES UPRIGHT. USE THIS SHARD TO UPDATE IT.')
    expect(eyeNote(withEye(up, [0, 240, 0]), s)).toBe('YOUR WORN AVATAR STILL USES ITS OLD EYE AND FACING. USE THIS SHARD TO UPDATE IT.')
    expect(eyeNote(up, up)).toBe('USE THIS SHARD PUBLISHES THE EYE AND FACING.')
  })
})
