/**
 * benchGrid.ts: the bench's grid, every line of it, as one quad and a shader.
 *
 * arkinox, 2026-10-31: "subdivisions beyond 1/10 aren't visually reflected in
 * the change to the grid's subdivisions correctly." They were not: the grid
 * was line geometry, so past twelve lines a unit it drew a divisor of the
 * snap instead (1/20, 1/30 and 1/40 all drew tenths; 1/24, 1/60 and 1/120 all
 * drew twelfths). The cap was there for a reason. True lines at 1/120 are
 * 7,684 vertices at the default extent and 61,444 at extent 64, rebuilt on
 * every change of division, and a solid sheet of aliased lines from any
 * distance.
 *
 * So the lines are not geometry now. One quad covers the grid and its
 * fragment shader works out, for each pixel, how near the nearest line is, in
 * pixels. The cost is four vertices and one draw call at every division and
 * every extent. Nothing runs per frame on the CPU: changing the division is
 * one number, changing the extent rewrites four corners, and the screen-space
 * derivatives make the camera the GPU's business. Every division is drawn as
 * itself, at the place the snap lands (the arithmetic is the same: a whole
 * number of 1/division from the origin).
 *
 * A line finer than the screen cannot be drawn as a line by anything. Where
 * lines come closer than a few pixels (per axis, per pixel, so the near end of
 * a tilted grid can resolve while the far end does not) they fade to an even,
 * faint tint, and zooming in brings them out. The unit grid stays on top
 * throughout, so the tint never reads as a coarser snap, which is exactly
 * what the old divisor lines did.
 */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Mesh, ShaderMaterial } from 'three'
import { ACCENT } from '../lib/palette'

/** The unit grid's line colour when a unit is not divided. */
const UNIT_LINE = '#1d3547'
/**
 * When a unit is divided the unit lines step up toward the axis lines' light
 * blue, and the division lines take the unit lines' old colour, so the unit
 * grid stays the unit grid however fine the snap.
 */
const UNIT_LINE_DIVIDED = '#166c86'

/**
 * How far the quad runs past the outermost lines, in units: enough to hold
 * half a line's width from the farthest the bench's camera can stand. The
 * shader cuts the lattice off at the extent itself.
 */
const QUAD_PAD = 1

/**
 * After opaque faces and before see-through ones (shardFaces.ts draw order).
 * An opaque shard's faces carry three's transparent flag at order 0 and write
 * depth, and the grid is blended and writes none. Drawn before them, at -1, the
 * faces painted over the grid even where the grid stood in front (review of
 * #558). Drawn after, the depth test sorts them: a line in front of a face
 * shows, and one behind it does not. Before order 1, see-through faces still
 * blend over it, as they did when it was opaque lines.
 */
const GRID_ORDER = 0.5

const VERTEX = /* glsl */ `
varying vec2 vGrid;
void main() {
  vGrid = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAGMENT = /* glsl */ `
uniform float uDivision;
uniform float uExtent;
uniform vec3 uDivisionColor;
uniform vec3 uUnitColor;
uniform vec3 uCentreColor;
varying vec2 vGrid;

// Half a line's width plus half a pixel: a one pixel line, box filtered.
const float REACH = 1.0;
// Lines closer than HIGH pixels start to fade; closer than LOW they are the even tint.
const float FADE_LOW = 1.1;
const float FADE_HIGH = 3.0;
const float TINT = 0.28;

// A vector's pixel rate: length, not fwidth, so a line is as wide at any turn.
vec2 cellsPerPixel(vec2 c) {
  vec2 dx = dFdx(c);
  vec2 dy = dFdy(c);
  return vec2(length(vec2(dx.x, dy.x)), length(vec2(dx.y, dy.y)));
}

// One family of lines, a whole number of 1/cells from the origin: how much of this pixel they cover.
float lines(vec2 g, float cells) {
  vec2 c = g * cells;
  vec2 rate = cellsPerPixel(c);
  vec2 px = abs(fract(c - 0.5) - 0.5) / rate;
  vec2 cover = clamp(REACH - px, 0.0, 1.0);
  vec2 fade = mix(vec2(TINT), vec2(1.0), smoothstep(vec2(FADE_LOW), vec2(FADE_HIGH), 1.0 / rate));
  cover *= fade;
  return max(cover.x, cover.y);
}

void main() {
  vec2 rate = cellsPerPixel(vGrid);
  // The lattice stops at the extent: its outermost lines keep their full width.
  vec2 past = (abs(vGrid) - uExtent) / rate;
  float inside = min(clamp(REACH - past.x, 0.0, 1.0), clamp(REACH - past.y, 0.0, 1.0));

  vec3 color = uDivisionColor;
  float alpha = lines(vGrid, uDivision);

  float a = lines(vGrid, 1.0);
  float over = a + alpha * (1.0 - a);
  color = over > 0.0 ? (uUnitColor * a + color * alpha * (1.0 - a)) / over : color;
  alpha = over;

  vec2 centre = clamp(REACH - abs(vGrid) / rate, 0.0, 1.0);
  a = max(centre.x, centre.y);
  over = a + alpha * (1.0 - a);
  color = over > 0.0 ? (uCentreColor * a + color * alpha * (1.0 - a)) / over : color;

  gl_FragColor = vec4(color, over * inside);
  #include <colorspace_fragment>
}
`

/** The bench's grid: one mesh, one material, and four corners for life. */
export class BenchGrid {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>
  private extent = 0

  constructor() {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(12), 3))
    geometry.setIndex([0, 2, 1, 1, 2, 3])
    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uDivision: { value: 1 },
        uExtent: { value: 0 },
        uDivisionColor: { value: new Color(UNIT_LINE) },
        uUnitColor: { value: new Color(UNIT_LINE) },
        uCentreColor: { value: new Color(ACCENT) },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      forceSinglePass: true,
      // Like three's GridHelper, whose colours these are.
      toneMapped: false,
      // A hair toward the camera: a face lying on the grid's own plane neither hides the lines nor fights them.
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: -4,
    })
    this.mesh = new Mesh(geometry, material)
    this.mesh.name = 'bench-grid'
    this.mesh.renderOrder = GRID_ORDER
    // Nothing to tap here: the bench's tap plane is its own mesh (Bench.tsx Grid).
    this.mesh.raycast = () => {}
  }

  /**
   * The grid for this extent and division. A division is one number; only a
   * new extent touches the geometry, and then only its four corners.
   */
  set(extent: number, division: number): void {
    const u = this.mesh.material.uniforms
    u.uDivision.value = division
    ;(u.uUnitColor.value as Color).set(division > 1 ? UNIT_LINE_DIVIDED : UNIT_LINE)
    if (extent === this.extent) return
    this.extent = extent
    u.uExtent.value = extent
    const r = extent + QUAD_PAD
    const g = this.mesh.geometry
    const p = g.getAttribute('position') as Float32BufferAttribute
    p.setXYZ(0, -r, 0, -r); p.setXYZ(1, r, 0, -r); p.setXYZ(2, -r, 0, r); p.setXYZ(3, r, 0, r)
    p.needsUpdate = true
    g.computeBoundingSphere()
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}
