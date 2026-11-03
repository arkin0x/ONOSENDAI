import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mount } from '../../test/elementRoot'

vi.mock('@react-three/fiber', () => ({ useFrame: () => undefined, useThree: () => undefined }))
// The box is what is measured here, not words: a label needs a Canvas.
vi.mock('../WorldLabel', async (real) => ({ ...(await real<object>()), WorldLabel: () => null }))

describe('the box of a held item and of a sound', () => {
  const source = readFileSync(new URL('../WorldMessages.tsx', import.meta.url), 'utf8')

  it('is half a gibson at every scale: a scene unit is 2^scaleExp gibsons', async () => {
    const { placedBoxSide } = await import('../WorldMessages')
    expect(placedBoxSide(0)).toBe(0.5)
    expect(placedBoxSide(3) * 2 ** 3).toBe(0.5)
    expect(placedBoxSide(10) * 2 ** 10).toBe(0.5)
  })

  it('draws for a held item and for a sound, and is not sized to the screen', () => {
    expect(source).toMatch(/: <PlacedBox at=\{w\.centre\} \/>/)
    expect(source).toMatch(/<PlacedBox at=\{at\} opacity=\{opacity\} \/>\s*<AudioNote/)
    const body = source.slice(source.indexOf('function PlacedBox'), source.indexOf('The line color and opacity'))
    expect(body).not.toMatch(/useFrame|perPixel|markRecede/)
  })

  it('is opaque and out of the bloom: its faces and edges write depth and the tag (white and vanishing, 2026-11-01)', async () => {
    const { placedBoxProps } = await import('../WorldMessages')
    const { TAG_BLEND } = await import('../shardFaces')
    const props = placedBoxProps(1)
    expect(props).toMatchObject({ transparent: true, opacity: 1, forceSinglePass: true, ...TAG_BLEND })
    expect(props.depthWrite).not.toBe(false)
  })

  it('draws its faces, its edges and a sound’s note with those props, the faces under the edges', async () => {
    const { AudioMark, placedBoxProps } = await import('../WorldMessages')
    const m = await mount(createElement(AudioMark, { title: 'Rain Loop', at: [1, 2, 3] }))
    const want = placedBoxProps(1)
    const faces = m.all().filter((h) => h.type === 'meshBasicMaterial')
    const edges = m.all().filter((h) => h.type === 'lineBasicMaterial')
    // The box's fill, and the note's head, stem and flag.
    expect(faces).toHaveLength(4)
    expect(edges).toHaveLength(1)
    for (const h of [...faces, ...edges]) expect(h.props).toMatchObject(want)
    expect(faces.filter((h) => h.props.polygonOffset === true)).toHaveLength(1)
    await m.unmount()
  })

  it('stands a sound’s note outside the box, toward the camera, from any side', async () => {
    const { NOTE_STANDOFF } = await import('../WorldMessages')
    // Half the box's diagonal, in its own units (edge 1), is the farthest a face reaches.
    expect(NOTE_STANDOFF).toBeGreaterThan(Math.sqrt(3) / 2)
    expect(NOTE_STANDOFF).toBeLessThan(1)
  })
})
