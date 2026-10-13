/**
 * Rooms.tsx — the aligned-subtree lattice, drawn as the building you are in.
 *
 * Per §4.5 an aligned subtree of height h has base `(v >> h) << h` and owns 2^h
 * leaves per axis, so the blocks are fixed and universal: everyone standing in
 * one computes the same root without communicating. They are a property of the
 * SPACE, not of you.
 *
 * This used to draw only the nest containing the avatar, six boxes deep,
 * recomputed on every move. That was egocentric and it read wrong: the boxes
 * looked attached to you, so moving felt like the rooms teleported rather than
 * like you walked into the next one. Worse, it hid the structure that generates
 * them. A cube is three per-axis rulers crossing, and everything you actually
 * want to know (which way is cheap, what leaving costs) lives in the rulers.
 *
 * So the lattice is drawn instead, at two heights, across the whole view whether
 * or not you are inside any given cell. Nothing appears or vanishes when you
 * move. You are simply in a different cell of a grid that was already there.
 *
 * Two heights rather than six because wall density halves with each height, so
 * the fine grid carries the texture and the coarse one carries the structure.
 * Both are measured from the scale floor: at scaleExp s the cheapest possible
 * crossing is already height s+1, so anything below that is sub-cell and cannot
 * be drawn.
 *
 * In WALK the boxes are walls as well as edges (arkinox, 2026-10-13): you are
 * inside them in first person, so each face carries diagonal stripes in its
 * own ramp color, as dense as the wall is hard. A box of height h has h
 * stripes in every 10 cells along its edges (10 gibsons at 2^0), evenly
 * spaced, so an h5 wall is visibly five times as busy as an h1 wall. Faint,
 * never above 20% opacity, and well under it in practice: the bloom adds a
 * glow to every stripe on top of its own alpha, and at 20% a room's walls
 * were a purple wash that hid the room. They say where the walls are
 * without hiding what is behind them.
 *
 * Only one box is striped at a time, the one most relevant to where you are
 * walking (lib/walkWall.ts pickWall): you are inside every box of the nest at
 * once, and three sets of walls on top of each other said nothing. The
 * stripes also move: they scroll slowly down each upright wall, which gives
 * the eye something to fix the wall's place by, and the whole wall breathes,
 * fading to nothing and back to its ceiling on a slow cycle, so it never
 * settles into a fixed screen in front of the room (arkinox, 2026-10-13).
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, type Mesh, ShaderMaterial, Vector3 } from 'three'
import { formatOps, stepFor, type AxisDirection, type ViewAxes } from '../lib/space'
import { subtreeCantorOps } from 'cyberspace-core'
import { AXIS_BITS } from 'cyberspace-core'
import { latticeShade } from '../lib/palette'
import { pickWall } from '../lib/walkWall'
import { walkEye } from '../lib/walkEye'

import { WorldLabel } from './WorldLabel'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'

/**
 * The heights drawn, as an excess above the current scale floor, and how many
 * lattice cells either side of the one you occupy each of them reaches.
 *
 * Three consecutive levels rather than two spaced apart. With only h+3 and h+5
 * the intervening level is missing, so the relationship between them has to be
 * taken on trust; with h+3, h+4 and h+5 each box is visibly twice the last and
 * each costs visibly twice as much to leave. The doubling is the protocol's
 * whole shape, and consecutive levels are what put it on screen rather than in
 * a footnote.
 *
 * `span` is how many lattice cells either side of the one you occupy a level
 * reaches. All are 0, so each level draws exactly the cell you are standing in
 * and the three nest: the room, the room that room is in, and so on outward.
 *
 * It has come down twice. The lattice first ran the full width of the view at
 * two heights, 147 lines each 48 cells long, which under perspective turns into
 * a web of diagonal streaks rather than a building. Bounding the fine level to
 * its immediate neighbours cut that to 60 segments, but 27 cells of grid still
 * competes with the two things that matter, the cell you are in and the box you
 * are about to pay for. Now 24 segments and 480 cells of ink, against 7056 at
 * the start.
 *
 * The cost of drawing only the containing cell is that it jumps to the adjacent
 * one when you cross a boundary, which is the egocentric reading this moved away
 * from. That is survivable now in a way it was not before: the crossing flash
 * marks the moment, the covering box shows the move ahead of time, and the
 * avatar visibly travels, so a box changing is explained by three other things
 * on screen rather than being an unexplained jump.
 */
const LEVELS: Array<{ d: number; span: number; opacity: number; wall: number }> = [
  { d: 3, span: 0, opacity: 0.22, wall: 0.08 },
  { d: 4, span: 0, opacity: 0.28, wall: 0.1 },
  { d: 5, span: 0, opacity: 0.36, wall: 0.12 },
]

/** How many cells the stripe count is given per: h stripes in every this many. */
export const STRIPE_SPAN_CELLS = 10

/**
 * The stripe pitch for a wall of height `height`, in cells along a box edge:
 * `height` stripes in every STRIPE_SPAN_CELLS, evenly spaced.
 */
export function stripePeriod(height: number): number {
  return STRIPE_SPAN_CELLS / Math.max(1, height)
}

/** Seconds for the stripes to scroll down one stripe pitch. */
export const STRIPE_SCROLL_SECONDS = 2.5
/** Seconds for one breath of a wall: from nothing up to its ceiling and back. */
export const WALL_BREATH_SECONDS = 7

/**
 * One shader for every striped wall. The stripe runs along the diagonal of
 * whichever face a fragment is on (the two coordinates in its plane, summed),
 * measured from the box's own corner, so a wall's stripes sit still on it and
 * meet at its edges. Antialiased with the derivative, so a dense wall at a
 * glancing angle greys out rather than shimmering.
 *
 * `time` drives both motions. The scroll adds to the up coordinate (render y
 * is the view's up), so on an upright wall the stripes slide down; a floor or
 * ceiling has no up in its plane and holds still. The breath scales the
 * opacity by a raised cosine, 0 at the start of a cycle and the full ceiling
 * at its middle.
 */
const STRIPE_VERTEX = `
varying vec3 vLocal;
varying vec3 vNormal;
uniform vec3 corner;
void main() {
  // The box is one unit cube scaled and placed by its mesh, so the stripes
  // are measured in the render frame, from the box's own corner.
  vLocal = (modelMatrix * vec4(position, 1.0)).xyz - corner;
  vNormal = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const STRIPE_FRAGMENT = `
varying vec3 vLocal;
varying vec3 vNormal;
uniform vec3 color;
uniform float opacity;
uniform float period;
uniform float width;
uniform float time;
void main() {
  vec3 n = abs(vNormal);
  float up = vLocal.y + time * period / ${STRIPE_SCROLL_SECONDS.toFixed(4)};
  float s = n.x > 0.5 ? up + vLocal.z : (n.y > 0.5 ? vLocal.x + vLocal.z : vLocal.x + up);
  float f = fract(s / period);
  float d = min(f, 1.0 - f) * period;
  float aa = fwidth(s);
  float a = 1.0 - smoothstep(width * 0.5 - aa, width * 0.5 + aa, d);
  if (a <= 0.0) discard;
  float breath = 0.5 - 0.5 * cos(6.2831853 * time / ${WALL_BREATH_SECONDS.toFixed(4)});
  gl_FragColor = vec4(color, opacity * breath * a);
}`

/**
 * The walls' clock, in seconds, written once a frame while walking. It wraps
 * at the least common multiple of the two cycles, so both motions stay
 * continuous across the wrap and the float never grows past what a phone's
 * shader holds precisely.
 */
const WALL_CLOCK_WRAP = 35
const WALL_TIME = { value: 0 }

/**
 * One wall's material, made once per walk and kept: a landing moves the box
 * and changes its numbers, and both are written in place (setStripe). Built
 * fresh on every landing, the old one's disposal released the program and
 * the new one compiled it again, a shader link on the main thread at every
 * step of a walk, which is what the walk's hitch at each landing measured
 * as (2026-10-13).
 */
function stripeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: STRIPE_VERTEX,
    fragmentShader: STRIPE_FRAGMENT,
    uniforms: {
      color: { value: new Color() },
      opacity: { value: 0 },
      period: { value: 1 },
      width: { value: 0.2 },
      corner: { value: new Vector3() },
      // Shared by every wall, so one write a frame moves them all.
      time: WALL_TIME,
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  })
}

/** A wall's numbers for its box: its ramp color, ceiling and stripe pitch. */
function setStripe(m: ShaderMaterial, color: string, opacity: number, height: number, corner: [number, number, number]): void {
  const period = stripePeriod(height)
  ;(m.uniforms.color.value as Color).set(color)
  m.uniforms.opacity.value = Math.min(0.2, opacity)
  m.uniforms.period.value = period
  // Thin lines on an easy wall, closing up on a hard one but never solid.
  m.uniforms.width.value = Math.min(0.2, period * 0.3)
  ;(m.uniforms.corner.value as Vector3).set(corner[0], corner[1], corner[2])
}

/** The one box every wall is drawn from, scaled and placed by its mesh. */
const UNIT_BOX = new BoxGeometry(1, 1, 1)

interface Props {
  axes: ViewAxes
}

/**
 * Offsets, in cells, of the lattice planes bounding a neighbourhood of cells
 * around `here`.
 *
 * The planes sit at world multiples of 2^h. Both those and the render origin are
 * multiples of the cell step, so the division is exact and offsets land on whole
 * cells.
 */
function latticeOffsets(
  here: bigint, origin: bigint, scaleExp: number, height: number, span: number,
): number[] {
  const step = stepFor(scaleExp)
  const h = BigInt(height)
  const stride = 1n << h
  const base = (here >> h) << h

  const out: number[] = []
  for (let k = -span; k <= span + 1; k++) {
    // Half a cell back: a cell drawn at integer index i spans [i - 0.5, i + 0.5]
    // (pointCentre in lib/space.ts is the convention's statement), so a block
    // boundary, which is the FACE between two cells, sits on a half-integer.
    // The sector cage, the covering box and the markers already draw it there;
    // these walls used to sit on the integers, half a cell into the block,
    // cutting through the cell they should have bounded.
    out.push(Number((base + BigInt(k) * stride - origin) / step) - 0.5)
  }
  return out
}

/**
 * A 3D grid of lines at the given lattice offsets, as one merged geometry.
 *
 * Each line runs only between the first and last plane of its own axis, so the
 * whole thing is a closed block of cells rather than an infinite grid.
 */
function gridGeometry(
  right: number[], up: number[], out: number[], axes: ViewAxes,
): BufferGeometry {
  const v: number[] = []
  const dir = (a: AxisDirection, n: number): number => n * a.dir
  const span = (arr: number[]): [number, number] => [arr[0], arr[arr.length - 1]]

  const [r0, r1] = span(right)
  const [u0, u1] = span(up)
  const [o0, o1] = span(out)

  for (const u of up) {
    for (const o of out) {
      v.push(dir(axes.right, r0), dir(axes.up, u), dir(axes.out, o))
      v.push(dir(axes.right, r1), dir(axes.up, u), dir(axes.out, o))
    }
  }
  for (const r of right) {
    for (const o of out) {
      v.push(dir(axes.right, r), dir(axes.up, u0), dir(axes.out, o))
      v.push(dir(axes.right, r), dir(axes.up, u1), dir(axes.out, o))
    }
  }
  for (const r of right) {
    for (const u of up) {
      v.push(dir(axes.right, r), dir(axes.up, u), dir(axes.out, o0))
      v.push(dir(axes.right, r), dir(axes.up, u), dir(axes.out, o1))
    }
  }

  const geom = new BufferGeometry()
  geom.setAttribute('position', new Float32BufferAttribute(v, 3))
  return geom
}

export function Rooms({ axes }: Props): JSX.Element {
  const position = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const walking = useCyberspace((s) => s.walking)

  const levels = useMemo(() => {
    const origin = alignedOrigin(position, scaleExp)
    // Nothing above the axis width exists to be drawn. At scaleExp 84 the three
    // levels would be h87, h88 and h89, which are not boundaries of an 85-bit
    // axis; the whole space is one cell by then and the nest has run out.
    return LEVELS.filter(({ d }) => scaleExp + d <= AXIS_BITS).map(({ d, span, opacity, wall }, i) => {
      const height = scaleExp + d
      const offs = (a: AxisDirection): number[] =>
        latticeOffsets(position[a.axis], origin[a.axis], scaleExp, height, span)
      const [right, up, out] = [offs(axes.right), offs(axes.up), offs(axes.out)]
      return {
        height,
        geometry: gridGeometry(right, up, out, axes),
        wall,
        // The same box as a solid, for WALK's striped walls: its extent on
        // each render axis, signs applied the way gridGeometry applies them.
        walls: (() => {
          const ext = (arr: number[], a: AxisDirection): [number, number] => {
            const p = arr[0] * a.dir, q = arr[arr.length - 1] * a.dir
            return [Math.min(p, q), Math.max(p, q)]
          }
          const [x, y, z] = [ext(right, axes.right), ext(up, axes.up), ext(out, axes.out)]
          return { min: [x[0], y[0], z[0]] as [number, number, number], size: [x[1] - x[0], y[1] - y[0], z[1] - z[0]] as [number, number, number] }
        })(),
        // Hue from the crossing height, lightness from the level. The walls of
        // this grid ARE crossings, so the grid climbs the same ramp the legend
        // documents as you zoom out.
        color: latticeShade(height, i),
        opacity,
        // Named, once, on the cell holding the avatar. An 8-cell box is
        // meaningless until you know it is a height-27 wall costing 134M to
        // cross, and that number changes with zoom while the box does not.
        cells: 2 ** d,
        // What it costs to LEAVE this cell, on one axis, at the cheapest wall.
        //
        // This used to quote subtreeCantorOps(height), which is a different
        // quantity entirely: the priciest move that stays INSIDE the cell. You
        // cannot leave a height-h box without an LCA height above h, since two
        // positions share that box exactly when their crossing height is h or
        // less, so the floor to get out is subtreeCantorOps(h + 1). For the fine
        // grid the label read 7 when the real minimum is 15.
        //
        // A floor rather than a figure, because walls are not all the same
        // height. Every boundary of the height-3 lattice is at least height 4,
        // but the one at a multiple of 128 is height 8, and the ruler of
        // nested walls means a cell's six faces can each cost differently.
        //
        // Except the h85 box, which is the whole of cyberspace: there is no
        // outside to leave to, so a price for leaving it is nonsense, and at
        // the CYBERSPACE view it hung in the middle of the scene saying so.
        label: height === AXIS_BITS ? null : `h${height}  ${formatOps(subtreeCantorOps(height + 1))}+ ops to leave`,
        // Dead centre of the cell. Each level captions its own box rather than
        // the three stacking into one block: a caption sitting inside the volume
        // it describes needs no reading order to connect it to its cell.
        //
        // Centres cannot coincide the way top corners could. A cell sits in one
        // half of its parent on every axis, so its centre is always offset from
        // the parent's by a quarter of the parent's width, whereas their top
        // faces are flush whenever the child is in the upper half.
        labelAt: [axes.right, axes.up, axes.out].map((a) => {
          const base = (position[a.axis] >> BigInt(height)) << BigInt(height)
          const lo = Number((base - origin[a.axis]) / stepFor(scaleExp))
          return (lo + (2 ** d - 1) / 2) * a.dir
        }) as [number, number, number],
      }
    })
  }, [position, scaleExp, axes])
  // A rebuilt lattice replaces the geometry prop; nothing disposes the old
  // one, and a BufferGeometry's GL buffers live until dispose() or context
  // loss. Every anchor change and zoom leaked three of them.
  useEffect(() => () => { for (const l of levels) l.geometry.dispose() }, [levels])

  // WALK's walls: one material per level slot, made when the walk starts and
  // disposed when it ends. A landing re-anchors the boxes and rewrites their
  // numbers in place below; nothing is built or compiled per step.
  const materials = useMemo(() => (walking ? LEVELS.map(() => stripeMaterial()) : []), [walking])
  useEffect(() => () => { for (const m of materials) m.dispose() }, [materials])
  const wallMeshes = useRef<Array<Mesh | null>>([])
  useLayoutEffect(() => {
    levels.forEach((l, i) => {
      const m = materials[i]
      const mesh = wallMeshes.current[i]
      if (!m || !mesh) return
      const { min, size } = l.walls
      mesh.scale.set(size[0], size[1], size[2])
      mesh.position.set(min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2)
      setStripe(m, l.color, l.wall, l.height, min)
    })
  }, [levels, materials])

  // One wall at a time (lib/walkWall.ts), chosen against the eye every frame
  // and shown by visibility alone, so walking re-renders nothing.
  const shownWall = useRef<number | null>(null)
  useFrame(() => {
    if (materials.length === 0) { shownWall.current = null; return }
    WALL_TIME.value = (performance.now() / 1000) % WALL_CLOCK_WRAP
    const pick = pickWall(levels.map((l) => ({ height: l.height, ...l.walls })), [walkEye.x, walkEye.y, walkEye.z], shownWall.current)
    shownWall.current = pick
    levels.forEach((l, i) => { const m = wallMeshes.current[i]; if (m) m.visible = l.height === pick })
  })

  return (
    // Named so the browser harness can tell the boxes are mounted.
    <group name="rooms">
      {materials.length > 0 && levels.map((_, i) => (
        <mesh key={`wall-${i}`} ref={(m) => { wallMeshes.current[i] = m }} visible={false} geometry={UNIT_BOX} material={materials[i]} frustumCulled={false} renderOrder={-1} />
      ))}
      {/* The nest's outlines and captions stand down in WALK, where the one
          striped wall is the box on show and the outlines around it clashed
          with it (arkinox, 2026-10-13). HOP and VIEW keep them. */}
      {!walking && levels.map((l) => (
        <group key={l.height}>
          <lineSegments geometry={l.geometry} frustumCulled={false}>
            <lineBasicMaterial color={l.color} toneMapped={false} transparent opacity={l.opacity} />
          </lineSegments>
          {l.label !== null && (
            <WorldLabel
              text={l.label}
              color={l.color}
              at={l.labelAt}
              align="center"
              px={9}
              opacity={0.75}
            />
          )}
        </group>
      ))}
    </group>
  )
}
