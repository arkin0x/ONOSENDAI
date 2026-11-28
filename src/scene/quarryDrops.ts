/**
 * quarryDrops.ts - the Quarry Charge's drops on the GPU (scene/QuarryFx.tsx
 * draws them; store/useQuarry.ts holds them; lib/terrain/quarry.ts the
 * rules). Every block a blast took floats as a small copy of itself in its
 * own cell, turning slowly and bobbing, and shrinking and rising as it fades
 * in its last seconds.
 *
 * One InstancedMesh per block kind, in the TERRAIN field's frame. The
 * turning, the bob and the fade are the vertex shader's, from one time
 * uniform shared by every kind and two numbers per drop (its phase and when
 * it evaporates), so a frame only sets the time (`tick`). The instances are
 * written again only when the drops change or the field moves its origin
 * (`update`), and a kind's arrays are made again only when it needs more
 * room than it has (doubling). Nothing is made in a frame that only draws.
 *
 * The drops blend without touching alpha (shardFaces.ts NO_BLOOM_BLEND): they
 * read as blocks, not as light.
 */

import { BoxGeometry, DataTexture, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, NearestFilter, RGBAFormat, ShaderMaterial, Vector3 } from 'three'
import { DECK_TO_KIND, UNKNOWN_KIND, type BlockKind } from '../lib/terrain/blocks'
import { makeTile } from '../lib/terrain/tiles'
import { DROP_FADE_MS, DROP_SIZE, type Drop } from '../lib/terrain/quarry'
import { NO_BLOOM_BLEND } from './shardFaces'

/** The page's clock for the shader, in seconds from when this loaded: small numbers, so a float keeps them exact. */
const EPOCH = Date.now()
export const secondsOf = (wallMs: number): number => (wallMs - EPOCH) / 1000

const DROP_VERTEX = /* glsl */ `
  attribute vec2 aDrop;
  uniform float uTime;
  uniform float uFade;
  varying vec2 vUv;
  varying float vShade;
  varying float vLevel;
  void main() {
    // Turning slowly about the up axis, each drop at its own phase.
    float a = uTime * 0.9 + aDrop.x;
    float c = cos(a), s = sin(a);
    vec3 p = vec3(c * position.x + s * position.z, position.y, -s * position.x + c * position.z);
    vec3 n = vec3(c * normal.x + s * normal.z, normal.y, -s * normal.x + c * normal.z);
    // Whole until its last seconds, then shrinking as it fades.
    vLevel = clamp((aDrop.y - uTime) / uFade, 0.0, 1.0);
    p *= 0.35 + 0.65 * vLevel;
    vec4 w = instanceMatrix * vec4(p, 1.0);
    // The bob, in cells, and a little rise as it evaporates.
    w.y += 0.07 * sin(uTime * 2.1 + aDrop.x * 1.7) + 0.25 * (1.0 - vLevel);
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
export interface KindDrops { mesh: InstancedMesh; drop: InstancedBufferAttribute; material: ShaderMaterial; texture: DataTexture; capacity: number }

const UNIT_BOX = new BoxGeometry(1, 1, 1)
const scratch = new Matrix4()

/** The drops of one scene: made once, updated when the drops change, ticked every frame. */
export class DropField {
  readonly group = new Group()
  readonly kinds = new Map<number, KindDrops>()
  /** The time every kind's shader reads, in seconds (secondsOf). */
  readonly time = { value: 0 }
  /** What the instances were last written for. */
  private built: { version: number; field: unknown; plane: number } = { version: -1, field: null, plane: -1 }
  /** How many times the instances were written (for tests: a frame that only draws writes none). */
  writes = 0

  constructor() {
    this.group.name = 'quarry-drops'
  }

  /**
   * The drops as they are: written again only when `version` or the field
   * (`field`, its `origin` and `plane`) differs from the last time. True when
   * they were written.
   */
  update(field: { world: { origin: { x: bigint; y: bigint; z: bigint } }; plane: number }, drops: readonly Drop[], version: number): boolean {
    const b = this.built
    if (b.version === version && b.field === field && b.plane === field.plane) return false
    b.version = version; b.field = field; b.plane = field.plane
    this.write(field.world.origin, field.plane, drops)
    this.writes++
    return true
  }

  /** The frame: only the time moves. */
  tick(wallMs: number): void {
    this.time.value = secondsOf(wallMs)
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
      uniforms: { uTime: this.time, uFade: { value: DROP_FADE_MS / 1000 }, uMap: { value: texture }, uEdge: { value: raw(kind.edge) } },
      transparent: true, depthWrite: true, toneMapped: false, ...NO_BLOOM_BLEND,
    })
    const geometry = UNIT_BOX.clone()
    const drop = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2)
    drop.setUsage(DynamicDrawUsage)
    geometry.setAttribute('aDrop', drop)
    const mesh = new InstancedMesh(geometry, material, capacity)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    // Its bounds are one box at the origin; where the drops float is the instances'.
    mesh.frustumCulled = false
    mesh.renderOrder = 6
    mesh.name = `quarry-drops-${id}`
    mesh.raycast = () => {}
    mesh.count = 0
    this.group.add(mesh)
    const k = { mesh, drop, material, texture, capacity }
    this.kinds.set(id, k)
    return k
  }

  private free(k: KindDrops): void {
    k.mesh.removeFromParent()
    k.mesh.geometry.dispose()
    k.material.dispose()
    k.texture.dispose()
  }

  /** Every drop's instance: where it floats in this field, its size, its phase and when it evaporates. */
  private write(o: { x: bigint; y: bigint; z: bigint }, plane: number, drops: readonly Drop[]): void {
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
        const x = Number(BigInt(d.x) - o.x), y = Number(BigInt(d.y) - o.y), z = Number(BigInt(d.z) - o.z)
        scratch.makeScale(DROP_SIZE, DROP_SIZE, DROP_SIZE).setPosition(x + 0.5, y + 0.5, z + 0.5)
        k.mesh.setMatrixAt(i, scratch)
        // A phase from its cell, so neighbours never bob in step.
        k.drop.setXY(i, (((x * 12.9898 + y * 78.233 + z * 37.719) % 6.2832) + 6.2832) % 6.2832, secondsOf(d.expires))
      })
      k.mesh.count = list.length
      k.mesh.visible = true
      k.mesh.instanceMatrix.needsUpdate = true
      k.drop.needsUpdate = true
    }
  }

  dispose(): void {
    for (const k of this.kinds.values()) this.free(k)
    this.kinds.clear()
  }
}
