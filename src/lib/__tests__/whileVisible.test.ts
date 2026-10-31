/**
 * A hidden tab stops the clocks and measures that only a person looking at the
 * page can read (lib/whileVisible).
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { whileVisible } from '../whileVisible'

afterEach(() => vi.unstubAllGlobals())

describe('whileVisible', () => {
  it('runs on screen and not while hidden, and picks up again on return', () => {
    const doc = { visibilityState: 'visible' }
    vi.stubGlobal('document', doc)
    const fn = vi.fn()
    const tick = whileVisible(fn)
    tick()
    expect(fn).toHaveBeenCalledTimes(1)
    doc.visibilityState = 'hidden'
    tick()
    tick()
    expect(fn).toHaveBeenCalledTimes(1)
    doc.visibilityState = 'visible'
    tick()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('runs where there is no document, as under a test or a worker', () => {
    const fn = vi.fn()
    whileVisible(fn)()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('what stops while hidden', () => {
  const SRC = path.resolve(__dirname, '../..')
  const uses = ['hud/AvatarsPanel.tsx', 'hud/TargetsPanel.tsx', 'hud/DiscoveredPanel.tsx', 'hud/ChainExplorer.tsx', 'hud/SpectateBar.tsx', 'hud/Notifications.tsx', 'hooks/useCover.ts']
  for (const f of uses) {
    it(`${f} goes through it`, () => {
      expect(fs.readFileSync(path.join(SRC, f), 'utf8')).toMatch(/setInterval\(whileVisible\(/)
    })
  }
})
