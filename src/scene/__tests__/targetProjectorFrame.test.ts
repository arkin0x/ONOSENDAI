/**
 * targetProjectorFrame.test.ts: the HUD's label under another avatar holds
 * still when a proof lands (arkinox, 2026-11-18: "every chain action that
 * resolves causes the other avatar in my hud to jitter").
 *
 * A landing re-centres render space on your new chain head: the commit moves
 * every avatar's group by the shift, and the rig moves the camera by the
 * same shift in the next frame (OrbitControls.update, which brings the
 * camera's own matrix up to date). Nothing is rendered in between, so the
 * avatar's world matrix is still where the last render drew it (Box3
 * setFromObject does not update parents). The projector read that stale
 * matrix against the moved camera: the name,
 * picture and ring were drawn a whole segment off for one frame, then
 * snapped back. Measured in the browser (scripts/walk-jitter-probe.mjs,
 * standing still while a proof landed): the label jumped 78 to 980 px and
 * back for one frame at each landing; 0 px after the fix.
 */
import { describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))

import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three'
import { drawnLabelAnchor, projectorOrigin } from '../TargetProjector'
import { labelAnchor } from '../../lib/avatarLabel'
import { commitAnchor } from '../../lib/renderFrame'
import { alignedOrigin } from '../../store/useCyberspace'

/** Another avatar as OtherAvatar draws it: the placed group, the drawn group in it, a gibson-sized shape. */
function avatarAt(scene: Scene, at: Vector3): { placed: Group; drawn: Group } {
  const placed = new Group()
  const drawn = new Group()
  drawn.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()))
  placed.add(drawn)
  placed.position.copy(at)
  scene.add(placed)
  return { placed, drawn }
}

/** What the projector computed before the fix: the drawn group's box with its parent's matrix as last rendered. */
function staleAnchor(drawn: Group, camera: PerspectiveCamera): { x: number; y: number; bottom: number } | null {
  const box = new Box3().setFromObject(drawn)
  const corner = new Vector3()
  return labelAnchor({ min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] }, (p) => {
    corner.set(p[0], p[1], p[2]).applyMatrix4(camera.matrixWorldInverse)
    if (corner.z >= 0) return null
    corner.applyMatrix4(camera.projectionMatrix)
    return [corner.x, corner.y]
  })
}

describe('the HUD label under another avatar, as a proof lands', () => {
  it('does not move when render space re-centres and the camera follows in the same frame', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera(55, 375 / 812, 0.1, 6000)
    const other = new Vector3(4, 0, -20)
    const { placed, drawn } = avatarAt(scene, other)
    const eye = new Vector3(0, 0.6, 0)
    camera.position.copy(eye)
    camera.lookAt(0, 0.6, -10)
    // The last render: every world matrix up to date.
    scene.updateMatrixWorld()
    camera.updateMatrixWorld()
    const before = drawnLabelAnchor(drawn, camera)
    expect(before).toBeDefined()

    // A landing 35 gibsons back along the walk: the commit re-places the
    // avatar by the shift, the rig moves the camera by it and OrbitControls
    // aims it again. No render in between.
    const shift = new Vector3(0, 0, 35)
    placed.position.add(shift)
    camera.position.add(shift)
    camera.lookAt(0 + shift.x, 0.6 + shift.y, -10 + shift.z)

    // Before the fix: the avatar as last drawn, against the moved camera.
    const stale = staleAnchor(drawn, camera)
    expect(stale).not.toBeNull()
    expect(Math.abs(stale!.x - before!.x) * 375 / 2).toBeGreaterThan(20)

    // Now: exactly where it was on the screen (the projector updates the camera once a frame).
    camera.updateMatrixWorld()
    const after = drawnLabelAnchor(drawn, camera)
    expect(after).toBeDefined()
    expect(after!.x).toBeCloseTo(before!.x, 9)
    expect(after!.y).toBeCloseTo(before!.y, 9)
    expect(after!.bottom).toBeCloseTo(before!.bottom, 9)
  })

  it('measures from the anchor the scene was committed with, not the store anchor a landing has already moved', () => {
    const drawnWith = { x: 1000n, y: 2000n, z: 3000n }
    const landed = { x: 1035n, y: 2000n, z: 3000n }
    commitAnchor(drawnWith)
    // The store has the new head; the scene on screen has not been committed with it yet.
    expect(projectorOrigin({ anchor: landed, scaleExp: 0 })).toEqual(alignedOrigin(drawnWith, 0))
    commitAnchor(landed)
    expect(projectorOrigin({ anchor: landed, scaleExp: 0 })).toEqual(alignedOrigin(landed, 0))
  })
})
