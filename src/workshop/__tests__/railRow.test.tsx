/**
 * railRow.test.tsx - the SHARD sheet's shared slider row, driven as a person
 * drives it: OPACITY's keys (arrows, Page Up and Down, Home, End), its #
 * field (typing, SET, Escape), a drag that undoes in one step, and a greyed
 * RADIUS that no key moves.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount, type Host, type Mounted } from '../../test/elementRoot'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { newShard, type ShardMode, type ShardModel } from 'sno-core/shards'
import { useWorkshop } from '../../store/useWorkshop'
import { GLOW_START } from '../../lib/pointGlow'
import { OpacityRow } from '../shardRows'
import { PointGlowRows } from '../glowRows'

const w = useWorkshop.getState
const percent = (): number => w().current()?.opacity ?? 100

function load(mode: ShardMode = 'points', opacity?: number): void {
  const s: ShardModel = { ...newShard('Glass'), mode, vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }], ...(opacity === undefined ? {} : { opacity }) }
  useWorkshop.setState({ shards: [s], currentId: s.id, past: [], future: [], glowLast: { ...GLOW_START } })
}

const byLabel = (m: Mounted, label: string, role?: string): Host | undefined => m.all().find((h) => h.props['aria-label'] === label && (role === undefined || h.props.role === role))
const call = (h: Host, prop: string, arg?: unknown): void => { (h.props[prop] as (a?: unknown) => void)(arg) }
const key = (k: string) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, preventDefault: () => {}, stopPropagation: () => {} })
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

describe('OPACITY through the shared rail', () => {
  beforeEach(() => load('points', 50))

  it('arrows step one percent, Page Up and Down ten, Home 0 and End 100 (stored as none)', async () => {
    const m = await mount(<OpacityRow />)
    const rail = (): Host => byLabel(m, 'Opacity', 'slider')!
    for (const [k, want] of [['ArrowRight', 51], ['ArrowUp', 52], ['ArrowLeft', 51], ['ArrowDown', 50], ['PageUp', 60], ['PageDown', 50], ['Home', 0], ['End', 100]] as const) {
      call(rail(), 'onKeyDown', key(k))
      await settle()
      expect([k, percent()]).toEqual([k, want])
    }
    expect(w().current()?.opacity).toBeUndefined()
    // A key the rail does not use leaves it alone.
    call(rail(), 'onKeyDown', key('a'))
    expect(w().past.length).toBe(8)
    await m.unmount()
  })

  it('# opens a field: a typed percent SETs, bad input keeps SET disabled, Escape puts it away', async () => {
    const m = await mount(<OpacityRow />)
    call(byLabel(m, 'Type an opacity percent')!, 'onClick')
    await settle()
    const field = (): Host | undefined => byLabel(m, 'Opacity percent')
    const set = (): Host => m.buttons('SET')[0]
    expect(field()).toBeDefined()
    expect(set().props.disabled).toBe(true)
    // Letters are stripped, so nothing is typed and SET stays off.
    call(field()!, 'onChange', { target: { value: 'abc' } })
    await settle()
    expect(field()!.props.value).toBe('')
    expect(set().props.disabled).toBe(true)
    call(field()!, 'onChange', { target: { value: '35' } })
    await settle()
    expect(set().props.disabled).toBe(false)
    const form = m.all().find((h) => h.type === 'form')!
    call(form, 'onSubmit', { preventDefault: () => {} })
    await settle()
    expect(percent()).toBe(35)
    expect(field()).toBeUndefined()
    // Open again, then Escape: the field goes and nothing changes.
    call(byLabel(m, 'Type an opacity percent')!, 'onClick')
    await settle()
    call(field()!, 'onChange', { target: { value: '80' } })
    call(field()!, 'onKeyDown', { key: 'Escape', preventDefault: () => {} })
    await settle()
    expect(field()).toBeUndefined()
    expect(percent()).toBe(35)
    await m.unmount()
  })

  it('a drag draws every step and ends as one undo', async () => {
    const m = await mount(<OpacityRow />)
    const rail = byLabel(m, 'Opacity', 'slider')!
    Object.assign(rail, { getBoundingClientRect: () => ({ left: 0, width: 100 }) })
    const target = { setPointerCapture: () => {}, focus: () => {} }
    const ev = (x: number) => ({ clientX: x, pointerId: 1, currentTarget: target, preventDefault: () => {}, stopPropagation: () => {} })
    const before = w().current()
    call(rail, 'onPointerDown', ev(20))
    expect(percent()).toBe(20)
    call(rail, 'onPointerMove', ev(10))
    call(rail, 'onPointerMove', ev(5))
    expect(percent()).toBe(5)
    expect(w().past.length).toBe(3)
    call(rail, 'onPointerUp')
    expect(w().past).toEqual([before])
    w().undo()
    expect(percent()).toBe(50)
    await m.unmount()
  })
})

describe('a greyed row', () => {
  it('RADIUS with GLOW OFF: no key moves it and # is off', async () => {
    load('points')
    const m = await mount(<PointGlowRows />)
    const rail = byLabel(m, 'Glow radius', 'slider')!
    expect(rail.props.tabIndex).toBe(-1)
    expect(rail.props['aria-disabled']).toBe(true)
    for (const k of ['ArrowRight', 'PageUp', 'End', 'Home']) call(rail, 'onKeyDown', key(k))
    await settle()
    expect(w().current()?.extra).toBeUndefined()
    expect(w().past.length).toBe(0)
    expect(byLabel(m, 'Type a glow radius in gibsons')!.props.disabled).toBe(true)
    await m.unmount()
  })

  it('POINT SIZE reads AUTO with no number, from 0', async () => {
    load('points')
    const m = await mount(<PointGlowRows />)
    const rail = byLabel(m, 'Point size', 'slider')!
    expect(rail.props['aria-valuemin']).toBe(0)
    expect(rail.props['aria-valuenow']).toBeUndefined()
    expect(rail.props['aria-valuetext']).toBe('AUTO')
    // From AUTO the rail's keys still work: Right is 0, no dots.
    call(rail, 'onKeyDown', key('ArrowRight'))
    await settle()
    expect(w().current()?.extra).toEqual({ pointsize: 0 })
    expect(byLabel(m, 'Point size', 'slider')!.props['aria-valuenow']).toBe(0)
    await m.unmount()
  })
})
