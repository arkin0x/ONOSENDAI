/**
 * itemIcon.test.ts: one icon per kind of hidden thing, everywhere in the HUD.
 *
 * Until 2026-10-10 a shard was a text diamond in every row and a lucide
 * Diamond on the Stash button, a message a text pencil and a lucide
 * PencilLine, and one menu showed two key icons and two message icons at once
 * (arkinox, from a screenshot). ItemIcon is now the only place a kind's icon
 * is named. The first group pins the mapping the owner asked for. The second
 * reads every source under src/hud, as hookOrder.test.ts does, so a text
 * glyph or a second icon for a kind cannot creep back in.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { Bitcoin, KeyRound, Pyramid, ScrollText, Vault } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { ItemIcon, distinctKinds, itemIconOf } from '../ItemIcon'

describe('the icon each kind wears', () => {
  it('is the one the owner chose, one per kind', () => {
    expect(itemIconOf('shard')).toBe(Pyramid)
    expect(itemIconOf('message')).toBe(ScrollText)
    expect(itemIconOf('message', true)).toBe(Bitcoin)
    expect(itemIconOf('key')).toBe(KeyRound)
    expect(itemIconOf('chest')).toBe(Vault)
    // Only a message can be a coin; the flag means nothing on the others.
    expect(itemIconOf('shard', true)).toBe(Pyramid)
    expect(itemIconOf('key', true)).toBe(KeyRound)
    expect(itemIconOf('chest', true)).toBe(Vault)
  })

  it('renders hidden from readers, in the text color, at the size asked, under its own class and the caller\'s', () => {
    const html = renderToString(createElement(ItemIcon, { type: 'message', coin: true, size: 11, className: 'chest__glyph' }))
    expect(html).toContain('lucide-bitcoin')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('stroke="currentColor"')
    expect(html).toContain('width="11"')
    expect(html).toContain('stroke-width="2.25"')
    expect(html).toContain('class="lucide lucide-bitcoin item-icon chest__glyph"')
    expect(renderToString(createElement(ItemIcon, { type: 'shard' }))).toContain('class="lucide lucide-pyramid item-icon"')
  })

  it('a bag shows each kind once, in the order first seen, a coin apart from a message', () => {
    const items = [
      { type: 'message' as const, coin: false },
      { type: 'shard' as const, coin: false },
      { type: 'message' as const, coin: true },
      { type: 'message' as const, coin: false },
      { type: 'shard' as const, coin: true },
      { type: 'key' as const, coin: false },
    ]
    expect(distinctKinds(items)).toEqual([
      { type: 'message', coin: false },
      { type: 'shard', coin: false },
      { type: 'message', coin: true },
      { type: 'key', coin: false },
    ])
    expect(distinctKinds([])).toEqual([])
  })
})

const HUD = join(__dirname, '..')

/** Every .ts and .tsx under src/hud, tests included. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return sources(p)
    return /\.tsx?$/.test(f) ? [p] : []
  })
}

/** The old text glyphs, as escapes so this file passes its own test: a diamond, a pencil, a key, a square and a Bitcoin sign. */
const GLYPHS = ['\u25C7', '\u270E', '\u26B7', '\u25A3', '\u20BF']
/** The lucide icons a kind used to wear on a button, beside a different glyph in its rows. */
const RETIRED = ['Diamond', 'PencilLine']
/** The icons a kind wears now. Only ItemIcon names them; a test may import them to compare. */
const KIND_ICONS = ['Pyramid', 'ScrollText', 'Bitcoin', 'KeyRound', 'Vault']

/** The names a file imports from lucide-react, aliases and `type` dropped. */
export function lucideImports(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]
      if (name) out.push(name)
    }
  }
  return out
}

describe('no second icon for a kind, anywhere in src/hud', () => {
  const files = sources(HUD)

  it('reads the hud', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => basename(f) === 'ItemIcon.tsx')).toBe(true)
  })

  it('no file draws a kind as a text glyph', () => {
    const hits = files.flatMap((f) => {
      const text = readFileSync(f, 'utf8')
      return GLYPHS.filter((g) => text.includes(g)).map((g) => `${relative(HUD, f)} has U+${g.codePointAt(0)!.toString(16).toUpperCase()}`)
    })
    expect(hits).toEqual([])
  })

  it('no file imports a retired icon, and the kind icons come only through ItemIcon', () => {
    const hits = files.flatMap((f) => {
      const inTests = f.includes('__tests__')
      return lucideImports(readFileSync(f, 'utf8'))
        .filter((n) => RETIRED.includes(n) || (KIND_ICONS.includes(n) && basename(f) !== 'ItemIcon.tsx' && !inTests))
        .map((n) => `${relative(HUD, f)} imports ${n} from lucide-react`)
    })
    expect(hits).toEqual([])
  })

  it('reads an import the way the sources write one', () => {
    expect(lucideImports("import { Rss, Wrench } from 'lucide-react'\nimport { KeyRound as Key, type LucideIcon } from 'lucide-react'")).toEqual(['Rss', 'Wrench', 'KeyRound', 'LucideIcon'])
    expect(lucideImports("import { useState } from 'react'")).toEqual([])
  })
})
