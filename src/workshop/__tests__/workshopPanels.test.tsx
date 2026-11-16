/**
 * workshopPanels.test.tsx - the workshop's top bar (arkinox, 2026-10-23;
 * workshop redesign, phase 1): MENU, SHARD, MOTION, AVATAR and GRID, each its
 * own sheet, one open at a time.
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
import { OpacityRow } from '../shardRows'

const read = (...p: string[]): string => readFileSync(join(__dirname, '..', ...p), 'utf8')
const WORKSHOP = read('Workshop.tsx')
const TOPBAR = read('shell', 'TopBar.tsx')
const SHEET: Record<'menu' | 'shard' | 'avatar' | 'grid', string> = {
  menu: read('sheets', 'MenuSheet.tsx'),
  shard: read('sheets', 'ShardSheet.tsx'),
  avatar: read('sheets', 'AvatarSheet.tsx'),
  grid: read('sheets', 'GridSheet.tsx'),
}
/** Every source the workshop draws its controls from, to count a control once across all of them. */
const ALL = [WORKSHOP, TOPBAR, ...Object.values(SHEET), read('shell', 'ViewBall.tsx'), read('shell', 'Strip.tsx'), read('shell', 'Rail.tsx'), read('shell', 'Dock.tsx'), read('shell', 'HeldBar.tsx'), read('shell', 'MoveHandles.tsx'), read('sheets', 'MoreSheet.tsx')].join('\n')

/** One marker for each control that moved, and where it went. */
const MOVED: Record<'shard' | 'avatar', string[]> = {
  shard: [
    'className="workshop__name"',
    '<span className="workshop__label">SHARD FEED</span>',
    // PUBLISH, and the ask before publishing a shard that carries sealed
    // parts (#543), whose LEAVE THEM OUT publishes too: so publish(shard)
    // itself is written twice in the SHARD sheet, and the markers are the
    // button's press and the ask.
    'onClick={() => { if (carriesSealedParts(shard)) setPublishAsk(shard.id); else void usePublished.getState().publish(shard) }}',
    '{publishAsk === shard.id && (',
    'onClick={() => setRetractAsk(shard.id)}',
    "{retractAsk === shard.id && (",
    'BYTES ON THE WIRE',
    '<div className="ws__stats">',
    'aria-label="Render mode"',
    '<OpacityRow />',
    '<PointGlowRows />',
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

describe('the workshop top bar (workshop redesign, phase 1)', () => {
  it('reads MENU, SHARD, MOTION, AVATAR, GRID, with SHARD a box and AVATAR a venetian mask, between the way out and DEPLOY', () => {
    const at = ["area: 'menu', label: 'MENU', icon: Menu", "area: 'shard', label: 'SHARD', icon: Box", "area: 'motion', label: 'MOTION'", "area: 'avatar', label: 'AVATAR', icon: VenetianMask", "area: 'grid', label: 'GRID', icon: Grid3x3"].map((m) => TOPBAR.indexOf(m))
    for (const i of at) expect(i).toBeGreaterThan(-1)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    const close = TOPBAR.indexOf('aria-label="Close the workshop"')
    const areas = TOPBAR.indexOf('{AREAS.map(')
    const deploy = TOPBAR.indexOf('<span>DEPLOY</span>')
    expect(close).toBeGreaterThan(-1)
    expect(close).toBeLessThan(areas)
    expect(areas).toBeLessThan(deploy)
  })

  it('opens one sheet at a time, from one piece of state', () => {
    expect(WORKSHOP).toContain('const [sheet, setSheet] = useState<SheetKind | null>(null)')
    // Escape closes whichever is open, before anything else in the workshop.
    expect(WORKSHOP).toContain('if (sheet !== null) setSheet(null)')
  })

  it('puts each moved control in its own sheet, once, and none of them in MENU', () => {
    for (const [where, markers] of Object.entries(MOVED)) {
      const body = SHEET[where as 'shard' | 'avatar']
      for (const m of markers) {
        expect(body, `${m} in ${where.toUpperCase()}`).toContain(m)
        expect(ALL.split(m).length - 1, `${m} once`).toBe(1)
        expect(SHEET.menu, `${m} not in MENU`).not.toContain(m)
      }
    }
  })

  it('keeps the list and the ways in under MENU', () => {
    for (const m of ['SHARDS ({shardCount})', '+ NEW SHARD', '>PASTE</button>', "{importing ? 'READING' : 'IMPORT'}", '{pasteOpen && (', '<ShardList currentId={currentId} onOpen={onOpen} query={query} />', 'CLEAR THIS SCENE', '<Explanation>']) {
      expect(SHEET.menu).toContain(m)
    }
  })

  it('puts SHARD in order: name, Shard Feed, counts, DRAW, OPACITY, POINT SIZE to GLOW STRENGTH, CONSTRAIN', () => {
    const s = SHEET.shard
    const order = MOVED.shard.filter((m) => !m.includes('retract') && !m.includes('publish(') && !m.includes('publishAsk ===') && !m.includes('BYTES')).map((m) => s.indexOf(m))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('keeps one LEVEL, the rail\'s, and none in GRID', () => {
    expect(SHEET.grid).not.toContain('LevelStack')
    expect(ALL.split('aria-label="Raise the grid floor"').length - 1).toBe(1)
  })

  it('shows the avatar being mined as a ring on AVATAR, which opens AVATAR', () => {
    expect(TOPBAR).toContain("const busy = area === 'avatar' && work !== null")
    expect(TOPBAR).toContain('{busy && <span className="ws__topbtn-ring" aria-hidden />}')
    expect(TOPBAR).toContain('`${work}: see AVATAR`')
  })
})

describe('OPACITY in SHARD', () => {
  const shard = (opacity?: number): ShardModel => ({ ...newShard('Water'), ...(opacity === undefined ? {} : { opacity }) })
  beforeEach(() => {
    const s = shard()
    useWorkshop.setState({ shards: [s], currentId: s.id, past: [], future: [] })
  })

  it('is a slider from 0 to 100 with the value, the steppers and #', () => {
    const s = shard(40)
    useWorkshop.setState({ shards: [s], currentId: s.id })
    const html = renderToStaticMarkup(<OpacityRow />)
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-valuemin="0"')
    expect(html).toContain('aria-valuemax="100"')
    expect(html).toContain('aria-valuenow="40"')
    expect(html).toContain('40%')
    // 40 / 100 of the way along.
    expect(html).toContain('left:40')
    expect(html).toContain('aria-label="More see-through"')
    expect(html).toContain('aria-label="More solid"')
    expect(html).toContain('aria-label="Type an opacity percent"')
    expect(html).toContain('linescrub__hash')
  })

  it('reads solid with no opacity, and a stored 5 as 5 (no floor)', () => {
    expect(renderToStaticMarkup(<OpacityRow />)).toContain('aria-valuenow="100"')
    const s = shard(5)
    useWorkshop.setState({ shards: [s], currentId: s.id })
    expect(renderToStaticMarkup(<OpacityRow />)).toContain('aria-valuenow="5"')
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
