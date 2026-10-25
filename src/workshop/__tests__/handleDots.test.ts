/**
 * The bench's handle dots (arkinox, 2026-10-23: "i let onosendai sit in the
 * background on the workshop with that basilica piece open and the tab froze.
 * memory says 12.7GB"). A Basilica nave has 1,731 points; drawn as a mesh
 * each beside a drawn hit sphere, that was 3,462 objects through three's
 * render loop every frame and about 147 KB of garbage a frame. These pin the
 * two things that keep it flat: every dot is one object, and a bench left
 * alone writes and uploads nothing, frame after frame.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Color, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { HandleDots, dotCapacity, perPixelAt1, type Dot } from '../handleDots'

const NAVE_POINTS = 1731

function nave(): Dot[] {
  const out: Dot[] = []
  for (let i = 0; i < NAVE_POINTS; i++) out.push({ at: [(i % 24) - 12, Math.floor(i / 24) % 12, -Math.floor(i / 288)], radiusPx: 4.25, color: i % 2 ? '#ff8800' : '#00aaff' })
  return out
}

function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(50, 16 / 9, 0.05, 200)
  c.position.set(10, 9, 12)
  c.lookAt(0, 0, 0)
  return c
}

describe('HandleDots', () => {
  it('draws every point of a Basilica nave as one object', () => {
    const d = new HandleDots(dotCapacity(NAVE_POINTS))
    d.set(nave())
    expect(d.mesh.isInstancedMesh).toBe(true)
    expect(d.mesh.count).toBe(NAVE_POINTS)
    expect(d.mesh.children).toHaveLength(0)
    d.dispose()
  })

  it('writes nothing while the camera and the canvas stay as they are', () => {
    const d = new HandleDots(dotCapacity(NAVE_POINTS))
    d.set(nave())
    const cam = camera()
    expect(d.update(cam, 1080)).toBe(true)
    const matrices = d.mesh.instanceMatrix.version
    const colors = d.mesh.instanceColor!.version
    // An hour at 144 Hz would be half a million of these; a thousand say the same.
    for (let f = 0; f < 1000; f++) expect(d.update(cam, 1080)).toBe(false)
    expect(d.mesh.instanceMatrix.version).toBe(matrices)
    expect(d.mesh.instanceColor!.version).toBe(colors)
    // Turning the camera in place changes no dot's size on screen.
    cam.lookAt(5, 0, 0)
    expect(d.update(cam, 1080)).toBe(false)
    d.dispose()
  })

  it('writes again when the camera moves, the canvas resizes, the zoom changes or the dots change', () => {
    const d = new HandleDots(dotCapacity(NAVE_POINTS))
    d.set(nave())
    const cam = camera()
    d.update(cam, 1080)
    cam.position.set(4, 3, 5)
    expect(d.update(cam, 1080)).toBe(true)
    expect(d.update(cam, 720)).toBe(true)
    cam.fov = 40
    expect(d.update(cam, 720)).toBe(true)
    d.set(nave().slice(0, 10))
    expect(d.mesh.count).toBe(10)
    expect(d.update(cam, 720)).toBe(true)
    expect(d.update(cam, 720)).toBe(false)
    d.dispose()
  })

  it('holds each dot its radius in pixels, at its place, in its colour', () => {
    const d = new HandleDots(64)
    d.set([{ at: [1, 2, -3], radiusPx: 6, color: '#ff0000' }, { at: [0, 0, 0], radiusPx: 4.25, color: '#00ff00' }])
    const cam = camera()
    d.update(cam, 1000)
    const m = new Matrix4()
    const pos = new Vector3()
    const scale = new Vector3()
    d.mesh.getMatrixAt(0, m)
    pos.setFromMatrixPosition(m)
    scale.setFromMatrixScale(m)
    expect(pos.toArray()).toEqual([1, 2, -3])
    const k = perPixelAt1(50, 1000)
    expect(scale.x).toBeCloseTo(cam.position.distanceTo(new Vector3(1, 2, -3)) * k * 6)
    const c = new Color()
    d.mesh.getColorAt(1, c)
    expect(c.equals(new Color('#00ff00'))).toBe(true)
    d.dispose()
  })

  it('a tap never lands on the dots: the hit targets are the handles', () => {
    const d = new HandleDots(64)
    const hits: unknown[] = []
    d.mesh.raycast({} as never, hits as never)
    expect(hits).toHaveLength(0)
    d.dispose()
  })

  it('room grows by doubling, so placing points one by one rarely makes a new one', () => {
    expect(dotCapacity(0)).toBe(64)
    expect(dotCapacity(64)).toBe(64)
    expect(dotCapacity(65)).toBe(128)
    expect(dotCapacity(NAVE_POINTS)).toBe(2048)
  })
})

describe('the bench draws its handles as one object (Bench.tsx Handles)', () => {
  const src = readFileSync(join(__dirname, '..', 'Bench.tsx'), 'utf8')
  const start = src.indexOf('function Handles(')
  const body = src.slice(start, src.indexOf('\n}\n', start))

  it('draws the dots through HandleDots', () => {
    expect(start).toBeGreaterThan(-1)
    expect(body).toContain('new HandleDots(')
    expect(body).toContain('<primitive object={dots.mesh} />')
  })

  it('makes no geometry per point: the hit targets share one and are never drawn', () => {
    expect(body).not.toMatch(/<sphereGeometry/)
    expect(body).toMatch(/<mesh visible=\{false\} geometry=\{hitGeometry\} material=\{HIT_MATERIAL\}/)
  })
})
