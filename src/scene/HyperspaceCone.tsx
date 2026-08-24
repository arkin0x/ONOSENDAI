/**
 * HyperspaceCone.tsx — the environment of the line itself.
 *
 * DECK-0001: hyperspace is a one-dimensional transit line threaded through
 * cyberspace by proof of work. While the identity is riding it (transit is
 * live) or the user is browsing it (scrubbing the line for a destination), the
 * space should feel categorically different from ordinary movement, the way a
 * tunnel feels different from a road.
 *
 * Drawn as a camera-pinned open cone the camera sits inside, looking down its
 * throat: the group copies the camera's position AND orientation every frame,
 * the same infinity trick as BlackSun. Pinning both means the tunnel has no
 * parallax and no bearing — it is not at a place, it is a state you are in,
 * which is exactly what being on the line is. The taper (narrow at the eye,
 * wide at the far end) is what sells forward motion without moving anything:
 * the flow bands read as rushing toward a distant mouth.
 *
 * The material is additive, never writes depth, and renders first
 * (renderOrder -10), so the world draws over it and the cone can only ever
 * tint what is behind everything: an aurora, not a wall.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BackSide, CylinderGeometry, Group, ShaderMaterial } from 'three'
import { useCyberspace } from '../store/useCyberspace'
import { useHyperspace } from '../store/useHyperspace'

/**
 * Tube dimensions, in render units, measured from the camera.
 *
 * Bounded by the camera's far plane of 6000 and otherwise arbitrary, like
 * BlackSun's DISTANCE: nothing is ever between the camera and the tunnel wall,
 * so the numbers only set the proportions. Narrow at the eye and wide at the
 * far end, so the wall sweeps past the edges of the view and the flow reads as
 * motion toward a distant mouth.
 */
const NEAR_RADIUS = 250
const FAR_RADIUS = 900
const LENGTH = 3500
const RADIAL_SEGMENTS = 64

/**
 * Vertex shader: hand the fragment stage a cylindrical coordinate.
 *
 * The angle comes from uv.x rather than atan(position.x, position.z). atan
 * jumps from +pi to -pi at the seam, and interpolating across that jump sweeps
 * the varying — and with it the hue — backwards through the whole spectrum in
 * one segment, drawing a rainbow scar down the tube. uv.x runs 0..1 around the
 * same circle, its seam lands on duplicated vertices, and fract() in the hue
 * makes 1.0 and 0.0 the same colour, so the wrap is invisible.
 */
const vertexShader = /* glsl */ `
  varying float vAngle;
  varying float vAlong;

  void main() {
    vAngle = uv.x * 6.28318530718;
    // 0 at the near (camera) end, 1 at the far mouth, from the cylinder's own
    // local Y axis, which the mesh rotation maps onto the view direction.
    vAlong = position.y / ${LENGTH.toFixed(1)} + 0.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/**
 * Fragment shader: a flowing rainbow, kept deliberately faint.
 *
 * Hue spirals: angular position plus distance along the tube minus time, so
 * the colours corkscrew toward the mouth. Two slow sine bands running
 * lengthwise at different rates give the flow a beat frequency, which reads as
 * organic motion rather than a scrolling texture. Alpha peaks around 0.22 and
 * the colour is scaled to about 0.25 before blending: the scene blooms
 * everything above a luminance of 0.001, so an honest rainbow at full
 * brightness would white the whole view out. Both ends fade to zero so the
 * geometry's rims never show; the tunnel appears to continue past the eye and
 * dissolve at the horizon.
 *
 * A custom ShaderMaterial takes no part in scene fog, which matters here: the
 * scene fogs to black within ~96 units and the tube is 3500 long.
 */
const fragmentShader = /* glsl */ `
  uniform float uTime;

  varying float vAngle;
  varying float vAlong;

  vec3 hsl2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
  }

  void main() {
    float h = fract(vAngle / 6.28318530718 + vAlong * 0.25 - uTime * 0.08);
    vec3 color = hsl2rgb(vec3(h, 0.85, 0.55));

    // Two lengthwise bands at incommensurate rates: their beat keeps the flow
    // from ever visibly looping.
    float bandA = 0.5 + 0.5 * sin(vAlong * 12.0 - uTime * 1.5);
    float bandB = 0.5 + 0.5 * sin(vAlong * 5.0 + uTime * 0.9);

    // Zero at both rims, so neither end of the open cylinder ever draws an
    // edge on screen.
    float ends = smoothstep(0.0, 0.18, vAlong) * (1.0 - smoothstep(0.80, 1.0, vAlong));

    float alpha = (0.10 + 0.12 * (0.6 * bandA + 0.4 * bandB)) * ends;
    gl_FragColor = vec4(color * 0.45, alpha);
  }
`

/**
 * The tunnel itself, mounted only while the line is active, so its GPU
 * resources exist exactly as long as they are visible and unmounting is what
 * disposes them.
 */
function Cone(): JSX.Element {
  const group = useRef<Group>(null)

  // Open-ended: the camera looks straight down the tube and capped ends would
  // draw discs across the view. Top of the cylinder (local +Y) becomes the far
  // end under the mesh rotation below, so the top radius is the wide one.
  const geometry = useMemo(
    () => new CylinderGeometry(FAR_RADIUS, NEAR_RADIUS, LENGTH, RADIAL_SEGMENTS, 1, true),
    [],
  )
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo(() => new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uTime: { value: 0 } },
    // BackSide: the camera is inside the tube, so the inward faces are the
    // only ones it can see. Additive and depth-silent, so the tunnel can only
    // brighten what is already there and can never occlude the world.
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  }), [])
  useEffect(() => () => material.dispose(), [material])

  // Per frame rather than per render, for the same reason as BlackSun: the
  // camera moves continuously under orbit and the rig's eased follow, neither
  // of which React sees. Copying the quaternion too is what keeps the tube's
  // axis on the view direction wherever the orbit points.
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime
    const g = group.current
    if (!g) return
    g.position.copy(state.camera.position)
    g.quaternion.copy(state.camera.quaternion)
  })

  return (
    <group ref={group}>
      {/*
        The cylinder's own axis is local Y; rotating -90 degrees about X lays
        +Y along -Z, the camera's view direction, and the position offset puts
        the near rim at the eye and the far mouth LENGTH units down the view.
        Frustum culling is off because the camera lives inside the geometry's
        bounding volume, the case culling gets wrong.
      */}
      <mesh
        geometry={geometry}
        material={material}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, -LENGTH / 2]}
        renderOrder={-10}
        frustumCulled={false}
      />
    </group>
  )
}

export function HyperspaceCone(): JSX.Element | null {
  // "On the line" is either of two states: the identity has boarded and not
  // yet arrived (transit), or the user is scrubbing the line for a destination
  // (scrubHeight). Both are browsing hyperspace, so both get its sky.
  const inTransit = useCyberspace((s) => s.transit) !== null
  const scrubbing = useHyperspace((s) => s.scrubHeight) !== null

  if (!inTransit && !scrubbing) return null
  return <Cone />
}
