/**
 * animEditor.test.tsx - MOTION in the workshop's SHARD panel (AnimEditor),
 * mounted for real: presets press into canonical motions on the shard,
 * controls write what they show (speed in cycles a minute stored as c/b a
 * block, amounts in gibsons stored as ticks, path points), a fifth motion is
 * refused with a plain message, every press is one undoable edit, what the
 * shard publishes carries the canonical `anim`, the preview plays, pauses and
 * scrubs, and the reduced-motion note shows when the viewer asked for less
 * motion. No em dashes in anything it says.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The viewer asked for reduced motion: one media query for the whole page (scene/animMotion.ts), read on first use.
vi.stubGlobal('window', { ...globalThis, matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }) })

import { mount, settled, textOf, type Host } from '../../test/elementRoot'
import { newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { useWorkshop } from '../../store/useWorkshop'
import { useAnimPreview } from '../../store/animPreview'
import { AnimEditor } from '../AnimEditor'

const EDITOR = readFileSync(join(__dirname, '..', 'AnimEditor.tsx'), 'utf8')

function hoop(): ShardModel {
  return { ...newShard('Hoop'), unit: 0, mode: 'solid', vertices: [{ p: [3, 0, 0], c: [1, 1, 1] }, { p: [-3, 5, 0], c: [1, 1, 1] }], faces: [] }
}

beforeEach(() => {
  const s = hoop()
  useWorkshop.setState({ shards: [s], currentId: s.id, past: [], future: [] })
  useAnimPreview.getState().stop()
})

const anim = (): unknown => useWorkshop.getState().current()!.extra?.anim
const byLabel = (m: Awaited<ReturnType<typeof mount>>, label: string): Host => {
  const h = m.all().find((x) => x.props['aria-label'] === label)
  if (!h) throw new Error(`nothing labelled ${label}`)
  return h
}
async function type(m: Awaited<ReturnType<typeof mount>>, label: string, text: string): Promise<void> {
  ;(byLabel(m, label).props.onChange as (e: unknown) => void)({ target: { value: text } })
  await settled()
  ;(byLabel(m, label).props.onKeyDown as (e: unknown) => void)({ key: 'Enter', preventDefault() {}, stopPropagation() {} })
  await settled()
}
/** A stepper fires on press (hooks/useRepeatable); the release stops the repeat. */
async function step(m: Awaited<ReturnType<typeof mount>>, label: string): Promise<void> {
  const b = byLabel(m, label)
  ;(b.props.onPointerDown as (e: unknown) => void)({ preventDefault() {}, stopPropagation() {} })
  ;(b.props.onPointerUp as () => void)()
  await settled()
}
async function click(m: Awaited<ReturnType<typeof mount>>, label: string): Promise<void> {
  ;(byLabel(m, label).props.onClick as () => void)()
  await settled()
}

describe('the MOTION panel', () => {
  it('lives whole in the MOTION sheet, a top-level area; nothing motion stays in SHARD', () => {
    const sheet = readFileSync(join(__dirname, '..', 'sheets', 'MotionSheet.tsx'), 'utf8')
    expect(sheet).toContain('<AnimEditor />')
    expect(readFileSync(join(__dirname, '..', 'sheets', 'areas.ts'), 'utf8')).toContain('export const MOTION_READY = true')
    const shard = readFileSync(join(__dirname, '..', 'sheets', 'ShardSheet.tsx'), 'utf8')
    expect(shard).not.toMatch(/AnimEditor|AnimRow|\bMOTION\b|\banim\b/)
    // The preview row is pinned at the top of the sheet.
    expect(EDITOR).toContain('ws__anim-preview')
  })

  it('says nothing with an em dash', () => {
    expect(EDITOR).not.toContain('—')
  })

  it('presets press into canonical motions, sized for the object, and play the preview', async () => {
    const m = await mount(<AnimEditor />)
    await m.press('SPIN')
    expect(anim()).toEqual([['turn', 'y', 1, 20, 0]])
    expect(useAnimPreview.getState()).toMatchObject({ on: true, playing: true })
    await m.press('FERRIS WHEEL')
    expect(anim()).toEqual([['turn', 'y', 1, 20, 0], ['orbit', 'z', 600, 1, 30, 0]])
    expect(m.says('1. SPIN')).toBe(true)
    expect(m.says('2. FERRIS WHEEL')).toBe(true)
    await m.unmount()
    // The preview outlives the panel (a phone closes it to watch), and stops on a tool change or another shard.
    expect(useAnimPreview.getState().on).toBe(true)
    useWorkshop.getState().setTool('select')
    expect(useAnimPreview.getState().on).toBe(false)
  })

  it('a fifth motion is refused: the presets go quiet and it says why', async () => {
    const m = await mount(<AnimEditor />)
    for (const p of ['SPIN', 'BOB', 'PENDULUM', 'ELEVATOR']) await m.press(p)
    expect((anim() as unknown[]).length).toBe(4)
    expect(m.says('Up to 4 motions')).toBe(true)
    expect(m.buttons('FOLLOW PATH')[0].props.disabled).toBe(true)
    await m.unmount()
  })

  it('SPEED shows cycles a minute and stores c cycles every b seconds in lowest terms; REVERSE flips it', async () => {
    const m = await mount(<AnimEditor />)
    await m.press('SPIN')
    expect(byLabel(m, 'Speed, per minute').props.value).toBe('3')
    expect(m.says('1 every 20 s')).toBe(true)
    await type(m, 'Speed, per minute', '2.5')
    expect(anim()).toEqual([['turn', 'y', 1, 24, 0]])
    await type(m, 'Speed, per minute', '100000')
    expect(anim()).toEqual([['turn', 'y', 2, 1, 0]])
    expect(m.says('Top speed is 120 a minute')).toBe(true)
    await click(m, 'Reverse')
    expect(anim()).toEqual([['turn', 'y', -2, 1, 0]])
    await m.unmount()
  })

  it('a PENDULUM or a BACK AND FORTH has no REVERSE: the spec writes them with a positive c', async () => {
    const m = await mount(<AnimEditor />)
    await m.press('PENDULUM')
    expect(m.all().some((h) => h.props['aria-label'] === 'Reverse')).toBe(false)
    await m.unmount()
  })

  it('AXIS, the amount in gibsons, REST and START write what they show', async () => {
    const m = await mount(<AnimEditor />)
    await m.press('ELEVATOR')
    expect(anim()).toEqual([['lift', 'y', 1200, 25, 1, 30, 0]])
    await m.press('X')
    await type(m, 'TRAVEL, gibsons', '2.5')
    await step(m, 'Longer rests')
    await type(m, 'Start, degrees', '90')
    expect(anim()).toEqual([['lift', 'x', 300, 30, 1, 30, 90]])
    await m.unmount()
  })

  it('a path\'s points: add, set, move and remove; Z in the bench\'s frame is the field\'s negated', async () => {
    const m = await mount(<AnimEditor />)
    await m.press('FOLLOW PATH')
    expect(anim()).toEqual([['path', 1, 60, 0, [600, 0, 0, 1], [0, 0, 0, 1]]])
    await m.press('ADD POINT')
    await type(m, 'Point 2 Z', '2')
    await type(m, 'Point 2 time', '4')
    expect(anim()).toEqual([['path', 1, 60, 0, [600, 0, 0, 1], [600, 120, -240, 4], [0, 0, 0, 1]]])
    await click(m, 'Move point 2 up')
    expect((anim() as unknown[][])[0][4]).toEqual([600, 120, -240, 4])
    await click(m, 'Remove point 1')
    expect(anim()).toEqual([['path', 1, 60, 0, [600, 0, 0, 1], [0, 0, 0, 1]]])
    expect(byLabel(m, 'Remove point 1').props.disabled).toBe(true)
    await m.unmount()
  })

  it('every press is one undoable edit, and removing the last motion removes the field', async () => {
    const m = await mount(<AnimEditor />)
    await m.press('SPIN')
    await m.press('BOB')
    await click(m, 'Move BACK AND FORTH up')
    expect((anim() as unknown[][]).map((x) => x[0])).toEqual(['slide', 'turn'])
    useWorkshop.getState().undo()
    await settled()
    expect((anim() as unknown[][]).map((x) => x[0])).toEqual(['turn', 'slide'])
    useWorkshop.getState().undo()
    useWorkshop.getState().undo()
    await settled()
    expect(anim()).toBeUndefined()
    useWorkshop.getState().redo()
    await settled()
    expect(anim()).toEqual([['turn', 'y', 1, 20, 0]])
    await click(m, 'Remove SPIN')
    expect(useWorkshop.getState().current()!.extra).toBeUndefined()
    await m.unmount()
  })

  it('what it publishes carries the canonical field', async () => {
    const m = await mount(<AnimEditor />)
    await m.press('PENDULUM')
    await type(m, 'Speed, per minute', '4')
    const payload = toPayload(useWorkshop.getState().current()!) as unknown as Record<string, unknown>
    expect(payload.anim).toEqual([['swing', 'x', 30, 1, 15, 0]])
    const wire = JSON.parse(useWorkshop.getState().exportCurrent()!)
    expect(JSON.stringify(wire)).toContain('"anim":[["swing","x",30,1,15,0]]')
    await m.unmount()
  })

  it('PLAY, PAUSE and the scrub drive the preview; under reduced motion it says so', async () => {
    const m = await mount(<AnimEditor />)
    await m.press('SPIN')
    expect(m.says('Reduced motion is on. Scrub to see it move.')).toBe(true)
    await click(m, 'Pause')
    expect(useAnimPreview.getState()).toMatchObject({ on: true, playing: false, scrub: null })
    await click(m, 'Play')
    expect(useAnimPreview.getState().playing).toBe(true)
    const rail = byLabel(m, 'Scrub one cycle')
    ;(rail.props.onKeyDown as (e: unknown) => void)({ key: 'ArrowRight', preventDefault() {}, stopPropagation() {} })
    await settled()
    expect(useAnimPreview.getState()).toMatchObject({ playing: false, scrub: 0.05 })
    expect(textOf(m.all().find((h) => h.props.role === 'group' && h.props['aria-label'] === 'Motions')!)).not.toContain('—')
    await click(m, 'Stop')
    expect(useAnimPreview.getState()).toMatchObject({ on: false, playing: false, scrub: null })
    // Another shard stops a preview too.
    await click(m, 'Play')
    const other = hoop()
    useWorkshop.setState({ shards: [...useWorkshop.getState().shards, other], currentId: other.id })
    expect(useAnimPreview.getState().on).toBe(false)
    await m.unmount()
  })
})
