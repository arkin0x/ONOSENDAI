import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@react-three/fiber', () => ({ useFrame: () => undefined, useThree: () => undefined }))

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
})
