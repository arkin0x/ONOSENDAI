/**
 * compassKept.test.tsx - the compass is hidden while out of the way, never
 * unmounted (2026-11-18). Each mount of its canvas is a WebGL context of its
 * own; BUILD unmounted it at every hide and every move, so a long session of
 * BUILD made a new context each time.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { describe, expect, it, vi } from 'vitest'

const canvases = { mounted: 0, unmounted: 0 }
vi.mock('@react-three/fiber', () => ({
  // A canvas that counts its mounts, as each would be a WebGL context.
  Canvas: () => {
    useEffect(() => {
      canvases.mounted++
      return () => { canvases.unmounted++ }
    }, [])
    return null
  },
  useFrame: () => {},
  useThree: () => ({}),
}))

import { mount, type Host } from '../../test/elementRoot'
import { Compass3D } from '../Compass3D'

let hidden = false
const listeners = new Set<() => void>()
const setHidden = (h: boolean): void => { hidden = h; for (const l of listeners) l() }
const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l) } }

function Placed({ onTap }: { onTap: () => void }): JSX.Element {
  const h = useSyncExternalStore(subscribe, () => hidden)
  return <Compass3D hidden={h} onTap={onTap} />
}

const box = (all: Host[]): Host => all.find((h) => typeof h.props.className === 'string' && (h.props.className as string).includes('compass-3d'))!

describe('Compass3D hidden', () => {
  it('keeps one canvas through hide and show, and takes no tap while hidden', async () => {
    const onTap = vi.fn()
    const m = await mount(<Placed onTap={onTap} />)
    expect(canvases.mounted).toBe(1)
    expect(box(m.all()).props.role).toBe('button')
    for (let n = 0; n < 5; n++) {
      setHidden(true)
      await new Promise((r) => setTimeout(r, 5))
      const b = box(m.all())
      expect(b.props.className).toContain('compass-3d--hidden')
      expect(b.props.onPointerDown).toBeUndefined()
      expect(b.props.role).toBeUndefined()
      setHidden(false)
      await new Promise((r) => setTimeout(r, 5))
      expect(box(m.all()).props.className).not.toContain('compass-3d--hidden')
    }
    expect(canvases).toEqual({ mounted: 1, unmounted: 0 })
    await m.unmount()
    expect(canvases.unmounted).toBe(1)
  })
})
