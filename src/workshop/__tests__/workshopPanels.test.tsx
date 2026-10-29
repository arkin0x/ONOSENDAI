/**
 * workshopPanels.test.tsx - the workshop's top bar (arkinox, 2026-10-23):
 * MENU, GRID, SHARD and AVATAR, in that order, one panel open at a time.
 * MENU keeps the shard list and the ways in; SHARD has the open shard's name,
 * the Shard Feed, its counts, DRAW, OPACITY (a slider with a number to type)
 * and CONSTRAIN; AVATAR has what you wear, the ghost for scale and SET AVATAR.
 * Every control that moved is in its new panel, once, and gone from MENU.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'

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
import { dragHistory } from '../../lib/opacityStep'
import { OpacityRow } from '../Workshop'

const SOURCE = readFileSync(join(__dirname, '..', 'Workshop.tsx'), 'utf8')

/** The JSX of one top-bar panel, from its `{panel === 'x' && shard && (` to its close. */
function panel(name: string): string {
  const open = `{panel === '${name}' && shard && (`
  const start = SOURCE.indexOf(open)
  expect(start).toBeGreaterThan(-1)
  const end = SOURCE.indexOf('\n      )}\n', start)
  expect(end).toBeGreaterThan(start)
  return SOURCE.slice(start, end)
}

/** The chip row's JSX. */
function chips(): string {
  const start = SOURCE.indexOf('<div className="ws__chips">')
  const end = SOURCE.indexOf('\n      </div>', start)
  return SOURCE.slice(start, end)
}

/** One marker for each control that moved, and where it went. */
const MOVED: Record<'shard' | 'avatar', string[]> = {
  shard: [
    'className="workshop__name"',
    '<span className="workshop__label">SHARD FEED</span>',
    'usePublished.getState().publish(shard)',
    'onClick={() => setRetractAsk(shard.id)}',
    "{retractAsk === shard.id && (",
    'BYTES ON THE WIRE',
    '<div className="ws__stats">',
    'aria-label="Render mode"',
    '<OpacityRow />',
    'CONSTRAIN MOVEMENT IN WALK MODE',
  ],
  avatar: [
    '<span className="workshop__label">MY AVATAR</span>',
    '<ShardThumb shard={myAvatar} />',
    'className="workshop__tag"',
    'aria-label="Copy your avatar into your objects"',
    'aria-label="Copy your avatar to the clipboard"',
    'label="show default avatar ghost for scale"',
    '<span className="workshop__label">SET AVATAR</span>',
    '>USE THIS SHARD</button>',
    '>ICOSAHEDRON</button>',
    '>BROADCAST</button>',
    'useAvatars.getState().cancelAdopt()',
    'WORK ${work.required} BITS',
  ],
}

describe('the workshop top bar', () => {
  it('reads MENU, GRID, SHARD, AVATAR, with SHARD a box and AVATAR a venetian mask', () => {
    const row = chips()
    const at = ['>MENU', '>GRID', '>SHARD', '>AVATAR'].map((label) => row.indexOf(label))
    for (const i of at) expect(i).toBeGreaterThan(-1)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(row).toContain("<Box size={12} strokeWidth={2.25} aria-hidden />SHARD")
    expect(row).toContain("<VenetianMask size={12} strokeWidth={2.25} aria-hidden />AVATAR")
    expect(row).toContain("toggle('shard')")
    expect(row).toContain("toggle('avatar')")
  })

  it('opens one panel at a time, from one piece of state', () => {
    expect(SOURCE).toContain("type Panel = 'menu' | 'tools' | 'grid' | 'shard' | 'avatar'")
    // Escape closes whichever is open, before anything else in the workshop.
    expect(SOURCE).toContain('if (panel !== null) setPanel(null)')
  })

  it('puts each moved control in its new panel, once, and none of them in MENU', () => {
    const menu = panel('menu')
    for (const [where, markers] of Object.entries(MOVED)) {
      const body = panel(where)
      for (const m of markers) {
        expect(body, `${m} in ${where.toUpperCase()}`).toContain(m)
        expect(SOURCE.split(m).length - 1, `${m} once`).toBe(1)
        expect(menu, `${m} not in MENU`).not.toContain(m)
      }
    }
  })

  it('keeps the list and the ways in under MENU', () => {
    const menu = panel('menu')
    for (const m of ['SHARDS ({shards.length})', '+ NEW SHARD', '>PASTE</button>', "{importing ? 'READING' : 'IMPORT'}", '{pasteOpen && (', '<ShardFolders', 'CLEAR THIS SCENE', '<Explanation>']) {
      expect(menu).toContain(m)
    }
  })

  it('puts SHARD in order: name, Shard Feed, counts, DRAW, OPACITY, CONSTRAIN', () => {
    const s = panel('shard')
    const order = MOVED.shard.filter((m) => !m.includes('retract') && !m.includes('publish(') && !m.includes('BYTES')).map((m) => s.indexOf(m))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('sends the mining chip to AVATAR', () => {
    expect(chips()).toContain("onClick={() => { if (panel !== 'avatar') toggle('avatar') }} title=\"Your avatar: see AVATAR\"")
  })
})

describe('OPACITY in SHARD', () => {
  const shard = (opacity?: number): ShardModel => ({ ...newShard('Water'), ...(opacity === undefined ? {} : { opacity }) })
  beforeEach(() => {
    const s = shard()
    useWorkshop.setState({ shards: [s], currentId: s.id, past: [], future: [] })
  })

  it('is a slider from the floor to 100 with the value, the steppers and #', () => {
    const s = shard(40)
    useWorkshop.setState({ shards: [s], currentId: s.id })
    const html = renderToStaticMarkup(<OpacityRow />)
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-valuemin="10"')
    expect(html).toContain('aria-valuemax="100"')
    expect(html).toContain('aria-valuenow="40"')
    expect(html).toContain('40%')
    // (40 - 10) / 90 of the way along.
    expect(html).toContain('left:33.33')
    expect(html).toContain('aria-label="More see-through"')
    expect(html).toContain('aria-label="More solid"')
    expect(html).toContain('aria-label="Type an opacity percent"')
    expect(html).toContain('linescrub__hash')
  })

  it('reads solid with no opacity, and a stored 5 as the floor', () => {
    expect(renderToStaticMarkup(<OpacityRow />)).toContain('aria-valuenow="100"')
    const s = shard(5)
    useWorkshop.setState({ shards: [s], currentId: s.id })
    expect(renderToStaticMarkup(<OpacityRow />)).toContain('aria-valuenow="10"')
  })

  it('undoes a whole drag in one step', () => {
    const w = useWorkshop.getState
    const before = w().current()!
    const past = w().past
    // A drag from 100 down to 60, one edit per whole percent it passed.
    for (let p = 99; p >= 60; p--) w().setOpacity(p)
    expect(w().past.length).toBe(40)
    useWorkshop.setState({ past: dragHistory(past, before, w().past) })
    expect(w().past.length).toBe(1)
    expect(w().current()!.opacity).toBe(60)
    w().undo()
    expect(w().current()).not.toHaveProperty('opacity')
    expect(w().past.length).toBe(0)
  })
})
