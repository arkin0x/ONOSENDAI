/**
 * quarryDrops.ts - the Quarry Charge's drops on the GPU (scene/QuarryFx.tsx
 * draws them; store/useQuarry.ts holds them; lib/terrain/quarry.ts the
 * rules). Every block a blast took floats as a small copy of itself in its
 * own cell, turning slowly and bobbing, and shrinking and rising as it fades
 * in its last seconds. A drop flying to you (store/quarryHoming.ts) speeds
 * up from its cell to your body's middle on a slight arc, turning faster and
 * shrinking a little as it arrives; with reduced motion it fades where it is.
 *
 * One InstancedMesh per block kind, in the TERRAIN field's frame. The
 * turning, the bob and the fade are the vertex shader's, from one time
 * uniform shared by every kind and two numbers per drop (its phase and when
 * it evaporates), so a frame only sets the time (`tick`). The instances are
 * written again only when the drops change, a drop sets off, or the field
 * moves its origin (`update`); a flight is worked in the shader from when it
 * set off, how far it had to go and the body's middle (one uniform), with the
 * same numbers lib/terrain/quarry.ts flightShare uses, so it arrives exactly
 * when the store carries it, and a kind's arrays are made again only when it needs more
 * room than it has (doubling). Nothing is made in a frame that only draws.
 *
 * The drops blend without touching alpha (shardFaces.ts NO_BLOOM_BLEND): they
 * read as blocks, not as light.
 */

import { BoxGeometry, DataTexture, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, NearestFilter, RGBAFormat, ShaderMaterial, Vector3 } from 'three'
import { DECK_TO_KIND, UNKNOWN_KIND, type BlockKind } from '../lib/terrain/blocks'
import { makeTile } from '../lib/terrain/tiles'
import { DROP_FADE_MS, DROP_SIZE, HOME_ACCEL, dropPlace, HOME_MAX_SPEED, HOME_REDUCED_MS, type Drop } from '../lib/terrain/quarry'
import type { Flight } from '../store/quarryHoming'
import { NO_BLOOM_BLEND } from './shardFaces'

/** The page's clock for the shader, in seconds from when this loaded: small numbers, so a float keeps them exact. */
const EPOCH = Date.now()
export const secondsOf = (wallMs: number): number => (wallMs - EPOCH) / 1000

const DROP_VERTEX = /* glsl */ `
  attribute vec2 aDrop;
  // A flight: when it set off (seconds, -1 for none), how far it had to go (cells), its arc's lean, and 1 for reduced motion.
  attribute vec4 aHome;
  uniform float uTime;
  uniform float uFade;
  uniform vec3 uBody;
  uniform float uAccel;
  uniform float uVmax;
  uniform float uReduced;
  varying vec2 vUv;
  varying float vShade;
  varying float vLevel;
  float flownAt(float t) {
    float tv = uVmax / uAccel;
    return t < tv ? 0.5 * uAccel * t * t : 0.5 * uAccel * tv * tv + uVmax * (t - tv);
  }
  void main() {
    // How much of its flight it has made (lib/terrain/quarry.ts flightShare), 0 while it floats.
    float prog = 0.0;
    bool reduced = aHome.w > 0.5;
    if (aHome.x >= 0.0) {
      float e = uTime - aHome.x;
      if (e > 0.0) prog = reduced ? clamp(e / uReduced, 0.0, 1.0) : aHome.y > 0.0001 ? clamp(flownAt(e) / aHome.y, 0.0, 1.0) : 1.0;
    }
    float flying = reduced ? 0.0 : prog;
    // Turning slowly about the up axis, each drop at its own phase, and faster as it flies.
    float a = uTime * 0.9 + aDrop.x + flying * flying * 6.0;
    float c = cos(a), s = sin(a);
    vec3 p = vec3(c * position.x + s * position.z, position.y, -s * position.x + c * position.z);
    vec3 n = vec3(c * normal.x + s * normal.z, normal.y, -s * normal.x + c * normal.z);
    // Whole until its last seconds, then shrinking as it fades; gone once it arrives (or, reduced, as it fades out).
    float lv = clamp((aDrop.y - uTime) / uFade, 0.0, 1.0);
    p *= (0.35 + 0.65 * lv) * (1.0 - 0.45 * flying * flying);
    // Reduced motion: only its light goes, where it is (no shrink, no rise).
    vLevel = reduced ? lv * (1.0 - prog) : lv;
    if (prog >= 0.999) vLevel = 0.0;
    vec4 w = instanceMatrix * vec4(p, 1.0);
    // The bob, in cells, and a little rise as it evaporates; the bob settles as it flies.
    w.y += (0.07 * sin(uTime * 2.1 + aDrop.x * 1.7)) * (1.0 - flying) + 0.25 * (1.0 - lv);
    if (flying > 0.0) {
      // From its cell to the body's middle on a slight arc: up, and leaning to one side of the line.
      vec3 p0 = instanceMatrix[3].xyz;
      vec3 d = uBody - p0;
      vec3 across = cross(d, vec3(0.0, 1.0, 0.0));
      float l = length(across);
      across = l > 0.001 ? across / l : vec3(1.0, 0.0, 0.0);
      vec3 mid = p0 + 0.5 * d + vec3(0.0, 0.3 * aHome.y, 0.0) + across * (aHome.z * 0.35 * aHome.y);
      float u = flying, v = 1.0 - flying;
      w.xyz += v * v * p0 + 2.0 * v * u * mid + u * u * uBody - p0;
    }
    vShade = n.y > 0.5 ? 1.0 : n.y < -0.5 ? 0.5 : abs(n.x) > 0.5 ? 0.78 : 0.66;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * w;
  }
`

const DROP_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uEdge;
  varying vec2 vUv;
  varying float vShade;
  varying float vLevel;
  void main() {
    if (vLevel <= 0.01) discard;
    vec4 t = texture2D(uMap, vUv);
    // A bright edge, so a small block reads against the ground it floats over.
    vec2 e = min(vUv, 1.0 - vUv);
    float rim = 1.0 - smoothstep(0.0, 0.09, min(e.x, e.y));
    gl_FragColor = vec4(t.rgb * vShade * 1.2 + uEdge * rim * 0.55, vLevel);
  }
`

/** A kind's side tile as a texture, raw channels as the blocks' own (terrain/terrainMaterial.ts). */
function tileTexture(kind: BlockKind): DataTexture {
  const data = new Uint8Array(16 * 16 * 4)
  makeTile(kind, 1).forEach((p, i) => {
    const g = 1 + p[3] * 0.6
    data[i * 4] = Math.min(255, Math.round(p[0] * g)); data[i * 4 + 1] = Math.min(255, Math.round(p[1] * g)); data[i * 4 + 2] = Math.min(255, Math.round(p[2] * g)); data[i * 4 + 3] = 255
  })
  const t = new DataTexture(data, 16, 16, RGBAFormat)
  t.magFilter = NearestFilter
  t.minFilter = NearestFilter
  // Rows run top down in the tile, a texture's bottom up.
  t.flipY = true
  t.needsUpdate = true
  return t
}

/** A colour's raw channels, 0 to 1. */
function raw(hex: string): Vector3 {
  const n = parseInt(hex.slice(1), 16)
  return new Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/** One kind's drops on the GPU. */
export interface KindDrops { mesh: InstancedMesh; drop: InstancedBufferAttribute; home: InstancedBufferAttribute; material: ShaderMaterial; texture: DataTexture; capacity: number }

const UNIT_BOX = new BoxGeometry(1, 1, 1)
const scratch = new Matrix4()

/** The drops of one scene: made once, updated when the drops change, ticked every frame. */
export class DropField {
  readonly group = new Group()
  readonly kinds = new Map<number, KindDrops>()
  /** The time every kind's shader reads, in seconds (secondsOf). */
  readonly time = { value: 0 }
  /** The body's middle in the field's cells, where a flying drop goes: every kind's shader reads it. */
  readonly body = { value: new Vector3() }
  /** What the instances were last written for. */
  private built: { version: number; field: unknown; plane: number; homing: number } = { version: -1, field: null, plane: -1, homing: -1 }
  /** How many times the instances were written (for tests: a frame that only draws writes none). */
  writes = 0

  constructor() {
    this.group.name = 'quarry-drops'
  }

  /**
   * The drops as they are: written again only when `version`, the flights'
   * `homingVersion` or the field (`field`, its `origin` and `plane`) differs
   * from the last time. True when they were written.
   */
  update(field: { world: { origin: { x: bigint; y: bigint; z: bigint } }; plane: number }, drops: readonly Drop[], version: number, flights?: ReadonlyMap<Drop, Flight>, homingVersion = 0): boolean {
    const b = this.built
    if (b.version === version && b.field === field && b.plane === field.plane && b.homing === homingVersion) return false
    b.version = version; b.field = field; b.plane = field.plane; b.homing = homingVersion
    this.write(field.world.origin, field.plane, drops, flights)
    this.writes++
    return true
  }

  /** The frame: only the time moves, and the body flying drops go to (field cells). */
  tick(wallMs: number, body?: { x: number; y: number; z: number }): void {
    this.time.value = secondsOf(wallMs)
    if (body) this.body.value.set(body.x, body.y, body.z)
  }

  /** A kind's mesh, made or grown to hold `n` drops. */
  private kindFor(id: number, n: number): KindDrops {
    const had = this.kinds.get(id)
    if (had && had.capacity >= n) return had
    if (had) this.free(had)
    const capacity = Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, n))))
    const kind = DECK_TO_KIND[id] ?? UNKNOWN_KIND
    const texture = tileTexture(kind)
    const material = new ShaderMaterial({
      vertexShader: DROP_VERTEX, fragmentShader: DROP_FRAGMENT,
      uniforms: {
        uTime: this.time, uFade: { value: DROP_FADE_MS / 1000 }, uMap: { value: texture }, uEdge: { value: raw(kind.edge) },
        uBody: this.body, uAccel: { value: HOME_ACCEL }, uVmax: { value: HOME_MAX_SPEED }, uReduced: { value: HOME_REDUCED_MS / 1000 },
      },
      transparent: true, depthWrite: true, toneMapped: false, ...NO_BLOOM_BLEND,
    })
    const geometry = UNIT_BOX.clone()
    const drop = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2)
    drop.setUsage(DynamicDrawUsage)
    geometry.setAttribute('aDrop', drop)
    const home = new InstancedBufferAttribute(new Float32Array(capacity * 4).fill(-1), 4)
    home.setUsage(DynamicDrawUsage)
    geometry.setAttribute('aHome', home)
    const mesh = new InstancedMesh(geometry, material, capacity)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    // Its bounds are one box at the origin; where the drops float is the instances'.
    mesh.frustumCulled = false
    mesh.renderOrder = 6
    mesh.name = `quarry-drops-${id}`
    mesh.raycast = () => {}
    mesh.count = 0
    this.group.add(mesh)
    const k = { mesh, drop, home, material, texture, capacity }
    this.kinds.set(id, k)
    return k
  }

  private free(k: KindDrops): void {
    k.mesh.removeFromParent()
    k.mesh.geometry.dispose()
    k.material.dispose()
    k.texture.dispose()
  }

  /** Every drop's instance: where it floats in this field, its size, its phase, when it evaporates and its flight. */
  private write(o: { x: bigint; y: bigint; z: bigint }, plane: number, drops: readonly Drop[], flights?: ReadonlyMap<Drop, Flight>): void {
    const byKind = new Map<number, Drop[]>()
    for (const d of drops) {
      if (d.plane !== plane) continue
      const list = byKind.get(d.id)
      if (list) list.push(d)
      else byKind.set(d.id, [d])
    }
    for (const [id, k] of this.kinds) if (!byKind.has(id)) { k.mesh.count = 0; k.mesh.visible = false }
    for (const [id, list] of byKind) {
      const k = this.kindFor(id, list.length)
      list.forEach((d, i) => {
        // Its cell's middle, worked out once per drop and field (a stream of pickups writes this again every frame).
        const at = dropPlace(d, o)
        const x = at.x - 0.5, y = at.y - 0.5, z = at.z - 0.5
        scratch.makeScale(DROP_SIZE, DROP_SIZE, DROP_SIZE).setPosition(at.x, at.y, at.z)
        k.mesh.setMatrixAt(i, scratch)
        // A phase from its cell, so neighbours never bob in step.
        k.drop.setXY(i, (((x * 12.9898 + y * 78.233 + z * 37.719) % 6.2832) + 6.2832) % 6.2832, secondsOf(d.expires))
        const f = flights?.get(d)
        if (f) k.home.setXYZW(i, Math.max(0, secondsOf(f.start)), f.len, f.side, f.reduced ? 1 : 0)
        else k.home.setXYZW(i, -1, 0, 0, 0)
      })
      k.mesh.count = list.length
      k.mesh.visible = true
      k.mesh.instanceMatrix.needsUpdate = true
      k.drop.needsUpdate = true
      k.home.needsUpdate = true
    }
  }

  dispose(): void {
    for (const k of this.kinds.values()) this.free(k)
    this.kinds.clear()
  }
}
