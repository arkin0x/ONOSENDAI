/**
 * WalkProbe.tsx: a DEV-only instrument for how the camera moves through the
 * world, measured where it matters, at the moment each frame is drawn.
 *
 * An invisible mesh is placed at a fixed world point the way the rest of the
 * scene is placed (against the anchor's aligned origin, through React), and
 * its onBeforeRender records the camera's position against it. Camera minus
 * probe is then the eye's world position in render cells, as the frame on
 * screen shows it: a change of origin that the camera absorbs in a different
 * frame than the scene does shows up as a spike, which a reading of the store
 * or the camera alone would never see.
 *
 * Mounted only in DEV; recording only while `window.__walkTrace` is an array.
 */

import { useMemo, useRef } from 'react'
import { Box3, MeshBasicMaterial, SphereGeometry, type Camera, type Mesh, type Object3D, type WebGLRenderer } from 'three'

const scratchBox = new Box3()
import { placeCentre, type Position, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'

interface Trace { t: number; frame: number; rel: [number, number, number]; cam: [number, number, number]; q: [number, number, number, number]; view: [number, number, number, number]; events: number; walking: boolean; behind: number; links: number; scans: number; near: Array<[number, number, number, string]> }

export function WalkProbe({ axes }: { axes: ViewAxes }): JSX.Element {
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  // The fixed world point: wherever the anchor was when the probe mounted.
  const base = useRef<Position>({ ...anchor })
  const at = placeCentre(base.current, alignedOrigin(anchor, scaleExp), scaleExp, axes)
  const geometry = useMemo(() => new SphereGeometry(0.001), [])
  const material = useMemo(() => new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 }), [])
  const lastFrame = useRef(-1)
  const onBeforeRender = (renderer: WebGLRenderer, _scene: unknown, camera: Camera, _g: unknown, _m: unknown, _gr: unknown, mesh?: Mesh): void => {
    const trace = (window as unknown as { __walkTrace?: Trace[] }).__walkTrace
    if (!Array.isArray(trace)) return
    // Shader links counted, so a measurement can show a walk compiles nothing.
    const gl = renderer.getContext() as WebGL2RenderingContext & { __links?: number }
    if (gl.__links === undefined) {
      gl.__links = 0
      const link = gl.linkProgram.bind(gl)
      gl.linkProgram = (prog: WebGLProgram) => { gl.__links! += 1; link(prog) }
    }
    const frame = renderer.info.render.frame
    if (frame === lastFrame.current) return
    lastFrame.current = frame
    const p = (mesh ?? probe.current)!.position
    // What is drawn at your head that could show at the eye: the avatar
    // shapes (render order 10, the outline at the proven head among them)
    // and the crossing flash (11), with how far each is from the eye.
    const near: Array<[number, number, number, string]> = []
    let root = probe.current as unknown as Object3D | null
    while (root?.parent) root = root.parent
    root?.traverseVisible((o) => {
      if (o.renderOrder !== 10 && o.renderOrder !== 11) return
      const m = (o as unknown as { material?: { opacity?: number } }).material
      const g = (o as unknown as { geometry?: { boundingBox: Box3 | null; computeBoundingBox: () => void } }).geometry
      if (!g) return
      if (!g.boundingBox) g.computeBoundingBox()
      const box = scratchBox.copy(g.boundingBox!).applyMatrix4(o.matrixWorld)
      near.push([o.renderOrder, Math.round(box.distanceToPoint(camera.position) * 1000) / 1000, Math.round((m?.opacity ?? 1) * 1000) / 1000, o.type])
    })
    const s = useCyberspace.getState()
    trace.push({
      t: performance.now(), frame,
      rel: [camera.position.x - p.x, camera.position.y - p.y, camera.position.z - p.z],
      cam: [camera.position.x, camera.position.y, camera.position.z],
      q: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w],
      view: [s.view.x, s.view.y, s.view.z, s.view.w],
      near,
      events: s.events.length, walking: s.walking,
      links: gl.__links,
      scans: ((window as unknown as { __terrain?: { scans?: number[] } }).__terrain?.scans ?? []).length,
      behind: (window as unknown as { __walkBehind?: () => number }).__walkBehind?.() ?? -1,
    })
  }
  const probe = useRef<Mesh>(null)
  return <mesh ref={probe} position={at} geometry={geometry} material={material} frustumCulled={false} onBeforeRender={onBeforeRender as never} />
}
