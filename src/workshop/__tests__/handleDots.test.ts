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
import { Color, Group, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Scene, SphereGeometry, Vector2, Vector3, type Intersection } from 'three'
import { HandleDots, HandleHalos, HandleHits, PressMemory, dotCapacity, perPixelAt1, type Dot } from '../handleDots'

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

  it('makes no geometry per point: the hit target is one object, never drawn', () => {
    expect(body).not.toMatch(/<sphereGeometry/)
    expect(body).toContain('new HandleHits()')
    expect(body).toMatch(/<primitive object=\{hits\} onPointerDown=\{onPress\} onClick=\{onClick\} \/>/)
  })
})

/** A tap's ray through the canvas point (ndcX, ndcY), as R3F sets it up. */
function rayAt(cam: PerspectiveCamera, ndcX: number, ndcY: number): Raycaster {
  const r = new Raycaster()
  r.setFromCamera(new Vector2(ndcX, ndcY), cam)
  return r
}

describe('HandleHits', () => {
  const HEIGHT = 1080
  const RADIUS = 12
  function setup(points: Array<[number, number, number]>): { hits: HandleHits; cam: PerspectiveCamera } {
    const hits = new HandleHits()
    hits.radiusPx = RADIUS
    hits.heightPx = HEIGHT
    hits.set(points)
    const cam = camera()
    cam.updateMatrixWorld()
    return { hits, cam }
  }

  it('is one object in the scene for every point of a nave, and adds none per point', () => {
    const { hits } = setup(nave().map((d) => [...d.at] as [number, number, number]))
    expect(hits.children).toHaveLength(0)
    expect(hits.visible).toBe(false)
  })

  it('answers with the point it met, as R3F needs: its index, its object and its distance', () => {
    const { hits, cam } = setup([[0, 0, 0], [2, 0, 0]])
    const p = new Vector3(2, 0, 0).project(cam)
    const found = rayAt(cam, p.x, p.y).intersectObject(hits, false)
    expect(found.map((f) => f.index)).toEqual([1])
    expect(found[0].object).toBe(hits)
    expect(found[0].distance).toBeGreaterThan(0)
    expect(found[0].point.distanceTo(new Vector3(2, 0, 0))).toBeLessThan(0.5)
  })

  it('misses what is farther off than its radius on screen, at any zoom', () => {
    for (const eye of [[10, 9, 12], [2, 2, 2], [40, 30, 40]] as Array<[number, number, number]>) {
      const { hits, cam } = setup([[0, 0, 0]])
      cam.position.set(...eye); cam.lookAt(0, 0, 0); cam.updateMatrixWorld()
      const pxInNdc = 2 / HEIGHT
      expect(rayAt(cam, 0, (RADIUS * 0.9) * pxInNdc).intersectObject(hits, false)).toHaveLength(1)
      expect(rayAt(cam, 0, (RADIUS * 1.1) * pxInNdc).intersectObject(hits, false)).toHaveLength(0)
    }
  })

  it('finds what a real screen-scaled hit sphere found, ray for ray, nearest first', () => {
    // The object it replaces, built as the bench built it: a group scaled by
    // its distance from the camera, holding a ten-segment sphere of the hit
    // radius. That sphere is a polygon, so it sits a little inside the true
    // one: whatever it met must be met, and the same point must come first.
    const points: Array<[number, number, number]> = []
    for (let i = 0; i < 300; i++) points.push([((i * 37) % 23) - 11, ((i * 53) % 13) - 6, ((i * 71) % 17) - 8])
    const { hits, cam } = setup(points)
    const k = perPixelAt1(cam.fov, HEIGHT)
    const sphere = new SphereGeometry(RADIUS, 10, 10)
    const material = new MeshBasicMaterial()
    const scene = new Scene()
    const meshes = points.map((p, i) => {
      const g = new Group()
      g.position.set(...p)
      g.scale.setScalar(Math.max(1e-5, cam.position.distanceTo(g.position) * k))
      const m = new Mesh(sphere, material)
      m.userData.point = i
      g.add(m)
      scene.add(g)
      return m
    })
    scene.updateMatrixWorld(true)
    let compared = 0
    let grazing = 0
    for (let y = -0.8; y <= 0.8; y += 0.013) {
      for (let x = -0.8; x <= 0.8; x += 0.013) {
        const ray = rayAt(cam, x, y)
        const old = ray.intersectObjects(meshes, false)
        if (old.length === 0) continue
        const now = ray.intersectObject(hits, false)
        const oldFirst = old[0].object.userData.point as number
        // Every point the old spheres met, the new ones meet too.
        for (const h of old) expect(now.some((f) => f.index === h.object.userData.point)).toBe(true)
        // The same one first, unless the new one is a ray grazing the rim of a
        // nearer point's true sphere, outside the old one's facets. A ten
        // segment sphere's outline runs in to about 0.9 of its radius.
        if (now[0].index !== oldFirst) {
          const c = new Vector3(...points[now[0].index as number])
          const rim = ray.ray.distanceToPoint(c) / (RADIUS * k * cam.position.distanceTo(c))
          expect(rim).toBeGreaterThan(0.85)
          grazing++
        }
        compared++
      }
    }
    expect(compared).toBeGreaterThan(100)
    // The rim is a sliver of what a tap lands on.
    expect(grazing / compared).toBeLessThan(0.1)
    sphere.dispose(); material.dispose()
  })

  it('adds nothing to the list for a ray that meets nothing', () => {
    const { hits, cam } = setup(nave().map((d) => [...d.at] as [number, number, number]))
    const found: Intersection[] = []
    hits.raycast(rayAt(cam, 0.99, 0.99), found)
    expect(found).toHaveLength(0)
  })
})

describe('PressMemory, the guard on a tap (Bench.tsx Handles onClick)', () => {
  it('a lift on a point the press did not meet is no tap on it', () => {
    const p = new PressMemory()
    p.press('down 1', 3)
    expect(p.met(3)).toBe(true)
    expect(p.met(4)).toBe(false)
  })
  it('one press can meet several overlapping points', () => {
    const p = new PressMemory()
    p.press('down 1', 3); p.press('down 1', 4)
    expect(p.met(3)).toBe(true)
    expect(p.met(4)).toBe(true)
  })
  it('a new press forgets the last', () => {
    const p = new PressMemory()
    p.press('down 1', 3)
    p.press('down 2', 7)
    expect(p.met(3)).toBe(false)
    expect(p.met(7)).toBe(true)
  })
  it('a press that met nothing leaves nothing met', () => {
    const p = new PressMemory()
    p.press('down 1', 3)
    p.press('down 2', undefined)
    expect(p.met(3)).toBe(false)
  })
  it('is what the bench asks before it takes a tap', () => {
    const bench = readFileSync(join(__dirname, '..', 'Bench.tsx'), 'utf8')
    expect(bench).toMatch(/if \(!g \|\| !pressed\.met\(e\.index as number\)\) return/)
    expect(bench).toMatch(/pressed\.press\(e\.nativeEvent, e\.index\)/)
    expect(bench).toMatch(/onPointerDown=\{onPress\}/)
  })
})

describe('HandleHalos', () => {
  it('draws a whole nave selected as one object, and shows nothing with nothing selected', () => {
    const h = new HandleHalos(dotCapacity(NAVE_POINTS), null, 26, 0.85)
    h.set([])
    expect(h.points.visible).toBe(false)
    h.set(nave().map((d) => ({ at: d.at, color: '#ff8800' })))
    expect(h.points.visible).toBe(true)
    expect(h.points.geometry.drawRange.count).toBe(NAVE_POINTS)
    expect(h.points.children).toHaveLength(0)
    const at = h.points.geometry.getAttribute('position')
    expect([at.getX(30), at.getY(30), at.getZ(30)]).toEqual([...nave()[30].at])
    h.set([])
    expect(h.points.visible).toBe(false)
    expect(h.points.geometry.drawRange.count).toBe(0)
    h.dispose()
  })

  it('holds its size on screen, as a sprite in a screen-scaled group did', () => {
    const h = new HandleHalos(8, null, 26, 0.85)
    expect(h.points.material.sizeAttenuation).toBe(false)
    expect(h.points.material.size).toBe(26)
    expect(h.points.material.depthWrite).toBe(false)
    h.dispose()
  })
})

describe('the bench', () => {
  const bench = readFileSync(join(__dirname, '..', 'Bench.tsx'), 'utf8')
  const handles = bench.slice(bench.indexOf('function Handles()'), bench.indexOf('/** The face being picked'))

  it('makes no object, element or frame callback per point', () => {
    // Only the picked corners' rings go through a list, and only those: in the
    // JSX it returns, one .map, however its lines are broken, and it starts
    // from the picked points rather than from every point.
    const jsx = handles.slice(handles.lastIndexOf('return (\n    <>'))
    expect(jsx).toContain('<primitive object={hits}')
    const lists = jsx.match(/\.(map|flatMap|forEach)\(/g) ?? []
    expect(lists).toHaveLength(1)
    expect(jsx).toMatch(/groups\s*\.filter\(\s*\(g\) => g\.some\(\(i\) => pickedSet\.has\(i\)\)\s*\)\s*\.map\(/)
    expect(jsx).toMatch(/facePick\.length > 0 &&/)
    expect(handles).not.toMatch(/<sprite/)
    expect(handles).not.toMatch(/SphereGeometry/)
  })

  it('draws on demand and keeps its programs', () => {
    expect(bench).toMatch(/frameloop="demand"/)
    expect(bench).toMatch(/onCreated=\{\(\{ gl: renderer, scene \}\) => keepPrograms\(renderer, scene\)\}/)
    expect(bench).toMatch(/<BenchWake \/>/)
    expect(bench).toMatch(/useWorkshop\.subscribe\(wake\)/)
  })
})
