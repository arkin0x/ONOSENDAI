/**
 * ShaderPointField.tsx — the terrain K field as GL_POINTS.
 *
 * One vertex per visible cell, sized and colored by K in the shaders. The field
 * is a cube around the view window, so this is at most VOLUME_SIZE^3 points, and
 * the CPU emits only cells it actually has.
 *
 * Positions are in cell units on the screen axes, the same frame Rooms, Cursor
 * and Avatar draw in, offset by the view window so the field stays put while the
 * camera pans to the cursor.
 */

import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three'
import { VOLUME_RADIUS, VOLUME_SIZE, type TerrainVolume } from '../hooks/useTerrainVolume'
import { UNKNOWN } from '../workers/terrain.worker'
import { useCyberspace } from '../store/useCyberspace'
import type { ViewWindow } from '../hooks/useViewWindow'

interface Props {
  volume: TerrainVolume
  win: ViewWindow
}

/**
 * Seconds over which a newly loaded point fades in.
 *
 * Terrain now arrives in a burst when the cursor settles, and popping several
 * thousand points on in a single frame reads as a flash. A quarter second is
 * long enough to read as the field resolving out of the dark and short enough
 * that it never feels behind the cursor it just caught up with. The ramp is
 * one way, up, and each cell rides it exactly once, so nothing strobes and the
 * effect stays acceptable under prefers-reduced-motion.
 */
const FADE_IN_S = 0.25

/**
 * When each visible cell first appeared, in performance.now() seconds, keyed
 * by its cell offset from the anchor. Carried across geometry rebuilds so a
 * cell that survives a rebuild keeps its age and stays solid; only genuinely
 * new cells fade in. Rebuilding the map from the cells actually emitted keeps
 * it from outgrowing one volume. A module singleton because the registry has
 * to outlive any single geometry, and rebuilding it is idempotent, which is
 * what StrictMode's doubled render requires.
 */
let births = new Map<string, number>()

/**
 * Vertex shader: point size in pixels, from K.
 *
 * K = 0 has no size and disappears, as do cells outside the universe, which
 * arrive as 0. From K = 1 up the size runs between a pixel floor and a
 * fraction of a tile.
 */
const vertexShader = /* glsl */ `
  attribute float aK;
  attribute float aBirth;
  uniform float uNow;
  uniform float uFadeIn;
  uniform float uTime;
  uniform float uFarPx;
  uniform float uNearPx;
  uniform float uKSpread;
  uniform float uDpr;
  uniform vec3 uFocus;
  uniform vec3 uCentre;
  uniform float uFadeRadius;
  uniform float uFadeStart;
  uniform float uNearRadius;

  varying float vK;
  varying float vPx;
  varying float vFade;

  void main() {
    vK = aK;

    // Alpha falls to nothing before the volume's own edge, so the field reads as
    // a ball of dust with no boundary rather than as a box of it.
    //
    // Two things gave the cube away. The fade floored at 0.16 instead of zero,
    // so the outermost dots were still a fifth visible and then simply stopped
    // where the data did, drawing the faces. And its radius was R*sqrt(3), sized
    // to reach the cube's corners, which left everything nearer than that fully
    // lit. Fading to zero by R hides the corners instead of chasing them.
    //
    // Centred on the volume, NOT on uFocus. The window that centres the volume
    // settles behind the cursor, so during a fast run the two are cells apart;
    // a ball centred on the cursor would then hang off one side of the cube and
    // expose the face it overhung.
    float rim = distance(position, uCentre);
    vFade = 1.0 - smoothstep(uFadeStart, uFadeRadius, rim);

    // Newly loaded cells resolve in over uFadeIn seconds instead of popping.
    // aBirth is fixed at the cell's first appearance and survives rebuilds, so
    // a cell that was already visible never dips or flashes.
    float grow = clamp((uNow - aBirth) / uFadeIn, 0.0, 1.0);
    vFade *= grow * grow * (3.0 - 2.0 * grow);

    // K = 0 keeps zero size and disappears, which is also how cells outside the
    // universe read, since they arrive as 0.
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    float px = 0.0;

    if (aK >= 1.0) {
      // Sized directly in pixels rather than in world units through perspective.
      // The field wants to read as fine dust, a pixel or two across, with only
      // the cells you are pointing at standing out. At that size perspective
      // attenuation has no room to express itself, and the cursor is what the
      // eye tracks anyway.
      //
      // Quadratic, not quartic. A quartic ramp collapsed almost immediately:
      // one cell out it had already given back four fifths of the bump, so
      // everything looked the same size. Quadratic still dies within
      // uNearRadius but leaves the first two cells visibly larger.
      float prox = clamp(1.0 - distance(position, uFocus) / max(uNearRadius, 0.001), 0.0, 1.0);
      float near = prox * prox;

      // K still moves the size a little, so terrain stays legible in the dust.
      float kFactor = aK / 16.0;
      float far = uFarPx * (1.0 - uKSpread + uKSpread * 2.0 * kFactor);
      px = mix(far, uNearPx, near);

      // Pulse for expensive terrain.
      if (kFactor > 0.7) {
        px *= 1.0 + 0.06 * sin(uTime * 2.5 + float(gl_VertexID) * 0.37);
      }
    }

    // Fully faded dots cost nothing: the fragment shader would discard them
    // anyway, but only after rasterising, and roughly half a cube lies outside
    // its own inscribed ball.
    px *= step(0.004, vFade);

    // gl_PointSize is in drawing-buffer pixels while these sizes are CSS px, so
    // scale by the device pixel ratio or every dot lands at 1/dpr.
    vPx = px * uDpr;
    gl_PointSize = vPx;
    gl_Position = projectionMatrix * mvPosition;
  }
`

/**
 * Fragment shader: a solid disc, colored by K. Stops match TERRAIN_STOPS.
 *
 * The disc is computed from gl_PointCoord rather than sampled from a gradient
 * texture. The texture faded linearly from the centre, so alpha was already
 * half at half the radius and the visible dot measured about 4px inside a 9px
 * sprite. Here the disc is solid to its rim with a fixed ~2px feathered edge,
 * so what you see is the size that was asked for.
 */
const fragmentShader = /* glsl */ `
  uniform float uTime;

  varying float vK;
  varying float vPx;
  varying float vFade;

  vec3 terrainColor(float k) {
    vec3 c0  = vec3(0.024, 0.067, 0.110);
    vec3 c4  = vec3(0.043, 0.208, 0.314);
    vec3 c6  = vec3(0.055, 0.373, 0.478);
    vec3 c8  = vec3(0.110, 0.561, 0.478);
    vec3 c10 = vec3(0.561, 0.749, 0.247);
    vec3 c12 = vec3(0.910, 0.639, 0.239);
    vec3 c14 = vec3(0.949, 0.396, 0.235);
    vec3 c16 = vec3(1.000, 0.180, 0.420);

    if (k < 4.0)  return mix(c0,  c4,  k / 4.0);
    if (k < 6.0)  return mix(c4,  c6,  (k - 4.0)  / 2.0);
    if (k < 8.0)  return mix(c6,  c8,  (k - 6.0)  / 2.0);
    if (k < 10.0) return mix(c8,  c10, (k - 8.0)  / 2.0);
    if (k < 12.0) return mix(c10, c12, (k - 10.0) / 2.0);
    if (k < 14.0) return mix(c12, c14, (k - 12.0) / 2.0);
    return mix(c14, c16, (k - 14.0) / 2.0);
  }

  void main() {
    // 0 at the centre, 1 at the sprite's rim.
    float d = length(gl_PointCoord - vec2(0.5)) * 2.0;

    // Feather a constant couple of pixels, whatever the dot's size.
    float edge = clamp(2.0 / max(vPx, 1.0), 0.04, 0.5);
    float alpha = (1.0 - smoothstep(1.0 - edge, 1.0, d)) * vFade;

    // Discarding faded points is also what keeps this affordable: transparent
    // points with bloom are overdraw-bound, so dropping the far half of a volume
    // is the difference between a slideshow and a usable frame rate.
    if (alpha < 0.02) discard;

    vec3 color = terrainColor(vK);

    float kFactor = vK / 16.0;
    if (kFactor > 0.7) {
      float dist = length(gl_PointCoord - 0.5);
      float pulse = 0.15 * (1.0 - dist * 2.0) * (0.5 + 0.5 * sin(uTime * 3.0));
      color += vec3(pulse);
    }

    gl_FragColor = vec4(color, alpha);
  }
`

function buildGeometry(volume: TerrainVolume, win: ViewWindow): BufferGeometry {
  const R = volume.radius
  const N = VOLUME_SIZE
  const { values } = volume

  let count = 0
  for (let i = 0; i < values.length; i++) if (values[i] !== UNKNOWN) count++

  const positions = new Float32Array(count * 3)
  const kValues = new Float32Array(count)
  const birthValues = new Float32Array(count)

  // On the same clock the uNow uniform runs on, so ages line up exactly.
  const now = performance.now() / 1000
  const nextBirths = new Map<string, number>()

  let v = 0
  for (let depth = 0; depth < N; depth++) {
    for (let row = 0; row < N; row++) {
      const slice = (depth * N + row) * N
      for (let col = 0; col < N; col++) {
        const k = values[slice + col]
        if (k === UNKNOWN) continue

        const x = win.right + (col - R)
        const y = win.up + (row - R)
        const z = win.out + (depth - R)
        positions[v * 3] = x
        positions[v * 3 + 1] = y
        positions[v * 3 + 2] = z
        kValues[v] = k

        // First seen now, or however long ago the registry remembers.
        const key = `${x},${y},${z}`
        const born = births.get(key) ?? now
        nextBirths.set(key, born)
        birthValues[v] = born
        v++
      }
    }
  }
  births = nextBirths

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aK', new Float32BufferAttribute(kValues, 1))
  geometry.setAttribute('aBirth', new Float32BufferAttribute(birthValues, 1))

  // Lets the browser verifier read what actually reached the GPU.
  if (import.meta.env.DEV) {
    ;(window as unknown as { __terrainPoints?: number }).__terrainPoints = count
  }

  return geometry
}

export function ShaderPointField({ volume, win }: Props): JSX.Element {
  const pointsRef = useRef<Points>(null)

  const geometry = useMemo(
    () => buildGeometry(volume, win),
    [volume, win.right, win.up, win.out],
  )

  // GPU buffers are not garbage collected; release each one when replaced.
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo(() => new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      /** The births clock, in performance.now() seconds; see buildGeometry. */
      uNow: { value: performance.now() / 1000 },
      /** How long a newly loaded point takes to reach full alpha. */
      uFadeIn: { value: FADE_IN_S },
      // Small and flat across the common K values, growing sharply at the top.
      /** Diameter of an ordinary gibson, in CSS pixels. The field is dust. */
      uFarPx: { value: 1.3 },
      /** Diameter at the cursor itself. Falls to uFarPx within uNearRadius. */
      uNearPx: { value: 7.5 },
      /** How much K swings the far size, as a fraction either side. */
      uKSpread: { value: 0.35 },
      /** Cells over which the near bump decays. Quartic, so it dies fast. */
      uNearRadius: { value: 3 },
      uDpr: { value: 1 },
      uFocus: { value: new Vector3() },
      /** Centre of the rendered volume, which the fade is measured from. */
      uCentre: { value: new Vector3() },
      /** Full opacity out to here, then an S-curve to nothing. */
      uFadeStart: { value: VOLUME_RADIUS * 0.45 },
      /** Zero by the inscribed ball, so the cube's faces are never reached. */
      uFadeRadius: { value: VOLUME_RADIUS },
    },
    transparent: true,
    depthWrite: false,
  }), [])

  useEffect(() => () => material.dispose(), [material])

  useFrame((state) => {
    const pts = pointsRef.current
    if (!pts) return
    const mat = pts.material as ShaderMaterial
    if (!mat.uniforms) return

    mat.uniforms.uTime.value = state.clock.elapsedTime

    // The fade-in ages against the same clock buildGeometry stamped births
    // with, which the r3f clock is not: it starts at zero and can be paused.
    mat.uniforms.uNow.value = performance.now() / 1000

    // Focus is what the camera orbits: the cursor. Live, so the magnification
    // under the cursor keeps up with the keypress.
    const [fx, fy, fz] = useCyberspace.getState().cursorOffset()
    mat.uniforms.uFocus.value.set(fx, fy, fz)

    // The volume's own centre, which is where the geometry was built around.
    mat.uniforms.uCentre.value.set(win.right, win.up, win.out)

    mat.uniforms.uDpr.value = state.gl.getPixelRatio()
  })

  return (
    <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
  )
}
