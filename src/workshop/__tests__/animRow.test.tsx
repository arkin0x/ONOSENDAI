/**
 * animRow.test.tsx - the workshop's minimal ANIM control (lib/anim.ts): in
 * the SHARD panel after BOUNCE, a field for the motion list as the payload
 * writes it, SET reading it as every reader will, CLEAR removing it, each an
 * undoable edit.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, settled } from '../../test/elementRoot'

// Thumbnails draw through a shared WebGL stage; nothing here to draw on.
vi.mock('../../hud/ShardThumb', () => ({ ShardThumb: () => null }))
// Radix's switch reaches for the DOM (HTMLFormElement), which this renderer has
// none of: a plain switch button stands in, pressing calls onCheckedChange.
vi.mock('../../hud/ui/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange }: { id: string; checked: boolean; onCheckedChange: (v: boolean) => void }) => (
    <button type="button" role="switch" id={id} aria-checked={checked} onClick={() => onCheckedChange(!checked)}>switch</button>
  ),
  Field: ({ label, hint, children }: { label: string; hint?: string; children: unknown }) => (
    <div className="ui-field"><span>{label}</span>{hint && <span>{hint}</span>}{children as never}</div>
  ),
}))

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { newShard, type ShardModel } from 'sno-core/shards'
import { useWorkshop } from '../../store/useWorkshop'
import { AnimRow } from '../Workshop'

const SOURCE = readFileSync(join(__dirname, '..', 'Workshop.tsx'), 'utf8')

function pad(name = 'Hoop'): ShardModel {
  return { ...newShard(name), mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }], faces: [] }
}

beforeEach(() => {
  const s = pad()
  useWorkshop.setState({ shards: [s], currentId: s.id, past: [], future: [] })
})

const anim = (): unknown => useWorkshop.getState().current()!.extra?.anim

async function typeAndSet(m: Awaited<ReturnType<typeof mount>>, text: string): Promise<void> {
  const input = m.all().find((h) => h.type === 'input')!
  ;(input.props.onChange as (e: unknown) => void)({ target: { value: text } })
  await settled()
  const form = m.all().find((h) => h.type === 'form')!
  ;(form.props.onSubmit as (e: unknown) => void)({ preventDefault() {} })
  await settled()
}

describe('ANIM in the SHARD panel', () => {
  it('sits after BOUNCE, inside the SHARD panel', () => {
    const start = SOURCE.indexOf("{panel === 'shard' && shard && (")
    const end = SOURCE.indexOf('\n      )}\n', start)
    const shard = SOURCE.slice(start, end)
    expect(shard.indexOf('<AnimRow />')).toBeGreaterThan(shard.indexOf('<BounceRow />'))
  })

  it('SET writes the motions canonically and says how many; malformed entries are dropped and counted', async () => {
    const m = await mount(<AnimRow />)
    await typeAndSet(m, '[["turn","y",30,1,0]]')
    expect(anim()).toEqual([['turn', 'y', 30, 1, 0]])
    expect(m.says('1 motion; VIEW shows it moving')).toBe(true)
    await typeAndSet(m, '[["turn","y",30,1,0],["spin","y",1,1,0]]')
    expect(anim()).toEqual([['turn', 'y', 30, 1, 0]])
    expect(m.says('1 of 2 kept')).toBe(true)
    await m.unmount()
  })

  it('not JSON changes nothing; CLEAR and an empty SET remove the field; each SET is undoable', async () => {
    const m = await mount(<AnimRow />)
    await typeAndSet(m, '[["slide","z",720,4,1,0]]')
    await typeAndSet(m, 'turn please')
    expect(anim()).toEqual([['slide', 'z', 720, 4, 1, 0]])
    expect(m.says('Not JSON')).toBe(true)
    useWorkshop.getState().undo()
    expect(anim()).toBeUndefined()
    useWorkshop.getState().redo()
    await settled()
    expect(anim()).toEqual([['slide', 'z', 720, 4, 1, 0]])
    const clear = m.all().find((h) => h.type === 'button' && h.props.title === 'Remove the motion')!
    ;(clear.props.onClick as () => void)()
    await settled()
    expect(anim()).toBeUndefined()
    await m.unmount()
  })
})
