/**
 * bounceRow.test.tsx - the workshop's BOUNCE control (arkinox, 2026-11-10:
 * "can i make bounce surfaces in the workshop now then?"): in the SHARD
 * panel beside CONSTRAIN, OFF / HEIGHT / REFLECT, a stepper and presets and
 * SPRINGBOARD only with a fixed height, a one-line explain, and a chip in the
 * shard list and the SHARD counts for a shard that bounces.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, settled, type Host } from '../../test/elementRoot'

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
import { useShardFolders } from '../../store/useShardFolders'
import { useCyberspace } from '../../store/useCyberspace'
import { EMPTY_TREE } from '../../lib/shardFolders'
import { BounceChip, BounceRow, ShardList } from '../Workshop'
import { withBounce } from '../../lib/walkBounce'

const SOURCE = readFileSync(join(__dirname, '..', 'Workshop.tsx'), 'utf8')

function pad(name = 'Pad'): ShardModel {
  return { ...newShard(name), mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }], faces: [] }
}

/** The pressed buttons' labels, in order. */
function pressed(html: string): string[] {
  return [...html.matchAll(/aria-pressed="true"[^>]*>([^<]+)</g)].map((m) => m[1])
}

const row = (): string => renderToStaticMarkup(<BounceRow />)

beforeEach(() => {
  const s = pad()
  useWorkshop.setState({ shards: [s], currentId: s.id, past: [], future: [] })
})

describe('BOUNCE in the SHARD panel', () => {
  it('sits right after CONSTRAIN, inside the SHARD panel', () => {
    const start = SOURCE.indexOf("{panel === 'shard' && shard && (")
    const end = SOURCE.indexOf('\n      )}\n', start)
    const shard = SOURCE.slice(start, end)
    const constrain = shard.indexOf('CONSTRAIN MOVEMENT IN WALK MODE')
    const bounce = shard.indexOf('<BounceRow />')
    expect(constrain).toBeGreaterThan(-1)
    expect(bounce).toBeGreaterThan(constrain)
  })

  it('OFF: three choices, OFF pressed, no stepper and no SPRINGBOARD; the explain line shows', () => {
    const html = row()
    expect(html).toContain('>OFF<')
    expect(html).toContain('>HEIGHT<')
    expect(html).toContain('>REFLECT<')
    expect(pressed(html)).toEqual(['OFF'])
    expect(html).not.toContain('springboard')
    expect(html).not.toContain('Bounce height')
    expect(html).toContain('Walkers with gravity on bounce off its top.')
    expect(html).not.toContain('—')
  })

  it('a fixed height: HEIGHT and its preset pressed, the stepper, and SPRINGBOARD to toggle', () => {
    useWorkshop.getState().setBounce(12)
    const html = row()
    expect(pressed(html)).toEqual(['HEIGHT', '12'])
    expect(html).toContain('aria-label="Bounce height"')
    expect(html).toMatch(/<span class="workshop__value">12<\/span>/)
    for (const n of [3, 6, 12, 18, 24]) expect(html).toContain(`>${n}</button>`)
    expect(html).toContain('springboard')
    expect(html).toContain('launch on walk-on')
    // The switch shows off until it is on.
    expect(html).toMatch(/id="ws-springboard"[^>]*aria-checked="false"|aria-checked="false"[^>]*id="ws-springboard"/)
    useWorkshop.getState().setBounce(12, true)
    expect(row()).toMatch(/id="ws-springboard"[^>]*aria-checked="true"|aria-checked="true"[^>]*id="ws-springboard"/)
  })

  it('a height off the presets presses no preset; the ends disable the stepper', () => {
    useWorkshop.getState().setBounce(1)
    let html = row()
    expect(pressed(html)).toEqual(['HEIGHT'])
    expect(html).toMatch(/<button class="workshop__btn"[^>]*disabled=""[^>]*aria-label="Lower bounce"/)
    useWorkshop.getState().setBounce(24)
    html = row()
    expect(html).toMatch(/<button class="workshop__btn"[^>]*disabled=""[^>]*aria-label="Higher bounce"/)
  })

  it('REFLECT: pressed, with no stepper and no SPRINGBOARD', () => {
    useWorkshop.getState().setBounce('reflect')
    const html = row()
    expect(pressed(html)).toEqual(['REFLECT'])
    expect(html).not.toContain('springboard')
    expect(html).not.toContain('Bounce height')
  })
})

describe('pressing it', () => {
  const extra = () => useWorkshop.getState().current()!.extra
  /** The stepper's buttons fire on press (hooks/useRepeatable); a release stops the repeat. */
  async function step(m: Awaited<ReturnType<typeof mount>>, label: string): Promise<void> {
    const b = m.all().find((h) => h.type === 'button' && h.props['aria-label'] === label)!
    expect(b.props.disabled).toBeFalsy()
    // The hold timer is the window's; this renderer has no window, so the global's stands in for the press.
    vi.stubGlobal('window', globalThis)
    try {
      ;(b.props.onPointerDown as (e: unknown) => void)({ preventDefault() {}, stopPropagation() {} })
      ;(b.props.onPointerUp as () => void)()
    } finally { vi.unstubAllGlobals() }
    await settled()
  }
  const springSwitch = (m: Awaited<ReturnType<typeof mount>>): Host | undefined => m.all().find((h) => h.props.id === 'ws-springboard' && h.type === 'button')

  it('HEIGHT, a preset, the stepper, SPRINGBOARD, REFLECT and OFF write exactly what a walker reads', async () => {
    const m = await mount(<BounceRow />)
    expect(springSwitch(m)).toBeUndefined()
    await m.press('HEIGHT')
    expect(extra()).toEqual({ bounce: 12 })
    expect(springSwitch(m)).toBeDefined()
    await m.press(/^6$/)
    expect(extra()).toEqual({ bounce: 6 })
    await step(m, 'Higher bounce')
    expect(extra()).toEqual({ bounce: 7 })
    await step(m, 'Lower bounce')
    await step(m, 'Lower bounce')
    expect(extra()).toEqual({ bounce: 5 })
    ;(springSwitch(m)!.props.onClick as () => void)()
    await settled()
    expect(extra()).toEqual({ bounce: 5, springboard: true })
    // A preset and the stepper keep the springboard.
    await m.press(/^24$/)
    expect(extra()).toEqual({ bounce: 24, springboard: true })
    // HEIGHT pressed again is no change.
    const past = useWorkshop.getState().past.length
    await m.press('HEIGHT')
    expect(useWorkshop.getState().past.length).toBe(past)
    await m.press('REFLECT')
    expect(extra()).toEqual({ bounce: 'reflect' })
    expect(springSwitch(m)).toBeUndefined()
    await m.press('OFF')
    expect(useWorkshop.getState().current()).not.toHaveProperty('extra')
    await m.unmount()
  })

  it('the stepper stops at 1 and 24', async () => {
    useWorkshop.getState().setBounce(2)
    const m = await mount(<BounceRow />)
    await step(m, 'Lower bounce')
    expect(extra()).toEqual({ bounce: 1 })
    expect(m.all().find((h) => h.props['aria-label'] === 'Lower bounce')!.props.disabled).toBe(true)
    useWorkshop.getState().setBounce(23)
    await settled()
    await step(m, 'Higher bounce')
    expect(extra()).toEqual({ bounce: 24 })
    expect(m.all().find((h) => h.props['aria-label'] === 'Higher bounce')!.props.disabled).toBe(true)
    await m.unmount()
  })
})

describe('the chip', () => {
  it('renders BOUNCE, SPRING and REFLECT, and nothing for a shard that does not bounce', () => {
    expect(renderToStaticMarkup(<BounceChip shard={pad()} />)).toBe('')
    expect(renderToStaticMarkup(<BounceChip shard={withBounce(pad(), 12)} />)).toContain('>BOUNCE 12<')
    expect(renderToStaticMarkup(<BounceChip shard={withBounce(pad(), 12, true)} />)).toContain('>SPRING 12<')
    expect(renderToStaticMarkup(<BounceChip shard={withBounce(pad(), 'reflect')} />)).toContain('>REFLECT<')
  })

  it('shows in the MENU list row of a bouncy shard only', async () => {
    const a = withBounce(pad('Trampoline'), 6)
    const b = pad('Plain')
    useWorkshop.setState({ shards: [a, b], currentId: a.id })
    useShardFolders.setState({ owner: useCyberspace.getState().identity.pubkey, tree: EMPTY_TREE, storage: 'indexeddb' })
    const m = await mount(<ShardList currentId={a.id} onOpen={() => {}} />)
    expect(m.says('Plain')).toBe(true)
    const chips = m.all().filter((h) => String(h.props.className ?? '').includes('ws__bounce-chip'))
    expect(chips).toHaveLength(1)
    expect(m.says('BOUNCE 6')).toBe(true)
    await m.unmount()
  })

  it('shows in the SHARD panel counts line', () => {
    expect(SOURCE).toContain('{bounceChip(shard) && <> · <BounceChip shard={shard} /></>}')
  })
})
