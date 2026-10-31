/**
 * A hidden tab stops the clocks and measures that only a person looking at the
 * page can read (lib/whileVisible).
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { everyWhileVisible, whileVisible } from '../whileVisible'

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

describe('everyWhileVisible', () => {
  const page = (): { visibilityState: string; listeners: Set<() => void>; addEventListener(n: string, f: () => void): void; removeEventListener(n: string, f: () => void): void } => {
    const listeners = new Set<() => void>()
    return { visibilityState: 'visible', listeners, addEventListener: (_, f) => { listeners.add(f) }, removeEventListener: (_, f) => { listeners.delete(f) } }
  }

  it('ticks on screen, not while hidden, and once as the page comes back so a label is right when read', () => {
    vi.useFakeTimers()
    try {
      const doc = page()
      vi.stubGlobal('document', doc)
      const fn = vi.fn()
      const stop = everyWhileVisible(fn, 1000)
      vi.advanceTimersByTime(2000)
      expect(fn).toHaveBeenCalledTimes(2)
      doc.visibilityState = 'hidden'
      for (const f of doc.listeners) f()
      vi.advanceTimersByTime(5000)
      expect(fn).toHaveBeenCalledTimes(2)
      doc.visibilityState = 'visible'
      for (const f of doc.listeners) f()
      expect(fn).toHaveBeenCalledTimes(3)
      stop()
      expect(doc.listeners.size).toBe(0)
      vi.advanceTimersByTime(5000)
      expect(fn).toHaveBeenCalledTimes(3)
    } finally { vi.useRealTimers() }
  })
})

describe('what stops while hidden', () => {
  const SRC = path.resolve(__dirname, '../..')
  for (const f of ['hud/AvatarsPanel.tsx', 'hud/TargetsPanel.tsx', 'hud/DiscoveredPanel.tsx', 'hud/ChainExplorer.tsx', 'hud/SpectateBar.tsx']) {
    it(`${f} goes through it`, () => {
      expect(fs.readFileSync(path.join(SRC, f), 'utf8')).toMatch(/return everyWhileVisible\(/)
    })
  }
  it('the cover measure goes through it', () => {
    expect(fs.readFileSync(path.join(SRC, 'hooks/useCover.ts'), 'utf8')).toMatch(/setInterval\(whileVisible\(/)
  })
  it('the notification poll does not: waiting leaves a hole it may never read across (review of #564)', () => {
    expect(fs.readFileSync(path.join(SRC, 'hud/Notifications.tsx'), 'utf8')).not.toMatch(/whileVisible/)
  })
})
