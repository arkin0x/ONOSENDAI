/**
 * audioSpheres.test.ts: each hidden sound's full-volume sphere in the world
 * (arkinox, 2026-11-01). The radius is the one the ears use (fadeRadius), in
 * scene units at the zoom on screen, about where the note is drawn; only
 * sounds, only on the plane in view, only at the zooms the notes are drawn
 * at, and none with no room for a sphere.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@react-three/fiber', () => ({ useFrame: () => undefined, useThree: () => undefined }))

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { itemCentre, type ViewAxes } from '../../lib/space'
import type { WorldItem } from '../../store/useShards'
import { fadeRadius, sourceLocal } from '../../lib/audioItem'

const FRONT: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }
const ORIGIN = { x: 1024n, y: 1024n, z: 1024n }
// Height 4: a 16-gibson region; 3 gibsons into it on every axis.
const AT = { x: 1027n, y: 1027n, z: 1027n }

function sound(key: string, fade: number | undefined, extra: Partial<WorldItem> = {}): WorldItem {
  return { key, type: 'audio', at: AT, plane: 0, height: 4, mine: false, audio: { title: key, ...(fade === undefined ? {} : { fade }) }, ...extra } as unknown as WorldItem
}

describe('the sound spheres', () => {
  it('ring each sound where its note is, with the radius the ears use, in scene units', async () => {
    const { audioSpheres } = await import('../AudioSpheres')
    const auto = fadeRadius(undefined, sourceLocal(AT, 4), 4)
    expect(auto).toBeGreaterThan(0)
    const [a, b] = audioSpheres([sound('auto', undefined), sound('two', 2)], 0, ORIGIN, 0, FRONT)
    // Centred where the note is drawn (itemCentre, as WorldMessages places it).
    expect(a).toEqual({ key: 'auto', centre: itemCentre(AT, ORIGIN, 0, FRONT), radius: auto })
    expect(b.radius).toBe(2)
    // At 2^1 a scene unit is two gibsons: the same sphere is half as many units.
    const [c] = audioSpheres([sound('two', 2)], 0, ORIGIN, 1, FRONT)
    expect(c.radius).toBe(1)
  })

  it('leave out what is not a sound, a sound on the other plane, and one with no room', async () => {
    const { audioSpheres } = await import('../AudioSpheres')
    const note = { ...sound('note', 2), type: 'message', audio: undefined } as unknown as WorldItem
    const other = sound('ideaspace', 2, { plane: 1 } as Partial<WorldItem>)
    const none = sound('zero', 0)
    expect(audioSpheres([note, other, none], 0, ORIGIN, 0, FRONT)).toEqual([])
  })

  it('stand down past the zoom where the notes stop being drawn', async () => {
    const { audioSpheres } = await import('../AudioSpheres')
    expect(audioSpheres([sound('two', 2)], 0, ORIGIN, 2, FRONT)).toEqual([])
  })
})
