import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every panel the menu holds has an EXPLAIN pill (hud/Explanation.tsx).
 *
 * The /demo tour's menu step says so in arkinox's words ("Each includes an
 * EXPLAIN button to help you learn more"), and Official links, View and
 * Controls had none until 2026-10-15. Read from the source: the panel
 * registry in Hud.tsx names each component, and its body, or a component it
 * renders, must render <Explanation>.
 */
const HUD = 'src/hud'

function sources(): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of readdirSync(HUD)) if (f.endsWith('.tsx')) out.set(f, readFileSync(join(HUD, f), 'utf8'))
  return out
}

/** The body of top-level function `name`, up to the next top-level declaration. */
function bodyOf(all: Map<string, string>, name: string): string | null {
  for (const src of all.values()) {
    const m = new RegExp(`^(export )?function ${name}\\b`, 'm').exec(src)
    if (!m) continue
    const rest = src.slice(m.index + m[0].length)
    const end = rest.search(/^(export )?(function|const|let|interface|type) /m)
    return end < 0 ? rest : rest.slice(0, end)
  }
  return null
}

describe('every menu panel has EXPLAIN', () => {
  it('each component in the panel registry renders <Explanation>', () => {
    const all = sources()
    const hud = all.get('Hud.tsx')!
    const registry = /const PANELS: Record<PanelId, \(\) => JSX\.Element> = \{([\s\S]*?)\n\}/.exec(hud)?.[1] ?? ''
    const entries = [...registry.matchAll(/^\s*(\w+): (\w+),/gm)].map((m) => [m[1], m[2]] as const)
    expect(entries.length).toBeGreaterThanOrEqual(20)
    // A panel may hand its body to a component of its own (HiddenPanel to
    // BagList): the components it renders are followed, two levels down.
    const explains = (name: string, depth: number): boolean => {
      const body = bodyOf(all, name) ?? ''
      if (/<Explanation\b/.test(body)) return true
      if (depth === 0) return false
      return [...new Set([...body.matchAll(/<([A-Z]\w+)/g)].map((m) => m[1]))].some((child) => child !== name && explains(child, depth - 1))
    }
    const missing = entries.filter(([, name]) => !explains(name, 2)).map(([id]) => id)
    expect(missing).toEqual([])
  })
})
