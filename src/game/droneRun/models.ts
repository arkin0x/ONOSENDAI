/**
 * models.ts - DRONE RUN's drones, guns and effects, from the original SNO
 * payloads bundled beside this file (models/, made for the game; rig.json
 * says where each part pivots, how fast a rotor spins, where a muzzle is and
 * where a gun sits in first person).
 *
 * Loaded with the game's screen (which is itself loaded only when a DRONE
 * RUN opens), so none of it costs the main bundle anything.
 *
 * Parts (DECK-0003 §1.10). A drone payload places its rotors and its glowing
 * eye by reference, and carries those objects inline in its own `objects`
 * table under the DEV key the game's fixture is signed with. The table counts
 * only under the pubkey of the event a payload came in (sno-core withAuthor),
 * so the payload is read with that author, and sno-core resolveParts finds
 * every placement in the table; the fetch it is handed refuses, so nothing is
 * ever asked of a relay.
 *
 * Frame. rig.json's numbers (pivots, muzzles, the viewmodel's place) are in
 * the payloads' own axes, DECK-0003 §2, which is the frame ONOSENDAI draws a
 * model in: sno-core reads a published (v2) payload into its own frame and
 * flatten / partMatrix hand it back in the render frame, which is the
 * published one. A drone's front is +Z (Object3D.lookAt aims it), a gun's
 * barrel -Z (the camera's forward). These models are drawn by the game's own
 * meshes (instanced drones, a viewmodel), never as world shards.
 */

import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three'
import { expandFaceColors, flatten, fromPayload, type ShardModel } from 'sno-core/shards'
import { partMatrix, resolveParts, withAuthor, type Placed } from 'sno-core/parts'
import { pointLookOf } from '../../lib/pointLook'
import rigJson from './models/rig.json'
import scoutPayload from './models/drones/scout.json'
import sniperPayload from './models/drones/sniper.json'
import heavyPayload from './models/drones/heavy.json'
import swarmerPayload from './models/drones/swarmer.json'
import pulseRiflePayload from './models/weapons/pulse-rifle.json'
import arcScatterPayload from './models/weapons/arc-scatter.json'
import chargeRailPayload from './models/weapons/charge-rail.json'
import muzzlePulsePayload from './models/effects/muzzle-pulse.json'
import muzzleArcPayload from './models/effects/muzzle-arc.json'
import muzzleRailPayload from './models/effects/muzzle-rail.json'
import sniperBoltPayload from './models/effects/sniper-bolt.json'
import heavyShotPayload from './models/effects/heavy-shot.json'
import hitSparkPayload from './models/effects/hit-spark.json'
import droneBurstPayload from './models/effects/drone-burst.json'

type V3 = [number, number, number]

/** A gun's place in first person (rig.json viewmodel): [right, down, forward] gibsons from the eye, turn in degrees about camera X, Y, Z. */
export interface ViewPlace {
  offset: V3
  turn: V3
  scale: number
}

interface RigPart { part: string; object: string; address: string; pivot: V3; turn: V3; spinAxis?: V3; spinRevPerS?: number; glow?: unknown; pointsize?: number }
interface RigDrone { name: string; across: number; hitRadius: number; eye: V3; muzzles: V3[]; parts: RigPart[] }
interface RigWeapon { name: string; grip: V3; muzzle: V3; flash: string; viewmodel: { desktop: ViewPlace; phone: ViewPlace } }
interface RigEffect { name: string; lifeS: number; grow: number }
export interface Rig { format: string; author: string; drones: Record<string, RigDrone>; weapons: Record<string, RigWeapon>; effects: Record<string, RigEffect> }

/** rig.json, typed. */
export const RIG = rigJson as unknown as Rig

/** The payloads by id. */
export const DRONE_PAYLOADS: Record<string, unknown> = { scout: scoutPayload, sniper: sniperPayload, heavy: heavyPayload, swarmer: swarmerPayload }
export const WEAPON_PAYLOADS: Record<string, unknown> = { 'pulse-rifle': pulseRiflePayload, 'arc-scatter': arcScatterPayload, 'charge-rail': chargeRailPayload }
export const EFFECT_PAYLOADS: Record<string, unknown> = {
  'muzzle-pulse': muzzlePulsePayload, 'muzzle-arc': muzzleArcPayload, 'muzzle-rail': muzzleRailPayload,
  'sniper-bolt': sniperBoltPayload, 'heavy-shot': heavyShotPayload, 'hit-spark': hitSparkPayload, 'drone-burst': droneBurstPayload,
}

/** A model's own faces and points in the render frame (the published one), face colours expanded. */
export interface RawMesh {
  positions: Float32Array
  colors: Float32Array
  index: number[]
}

export function rawMesh(model: ShardModel): RawMesh {
  const f = flatten(expandFaceColors(model))
  return { positions: f.positions, colors: f.colors, index: f.index }
}

/** A face geometry with vertex colours and flat normals. Null with no faces. */
export function faceGeometry(m: RawMesh): BufferGeometry | null {
  if (m.index.length === 0) return null
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(m.positions, 3))
  g.setAttribute('color', new BufferAttribute(m.colors, 3))
  g.setIndex(m.index)
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

/** Glowing points: where (model frame, after any placement), their colours, the halo and the point. */
export interface GlowPoints {
  positions: Float32Array
  colors: Float32Array
  /** Halo radius, model units (0 with no glow). */
  radius: number
  /** GLOW STRENGTH 0..1. */
  strength: number
  /** Point diameter, model units. */
  pointSize: number
}

function glowPoints(model: ShardModel, at?: Matrix4): GlowPoints {
  const m = rawMesh(model)
  if (at) {
    const v = new Vector3()
    for (let i = 0; i < m.positions.length; i += 3) {
      v.set(m.positions[i], m.positions[i + 1], m.positions[i + 2]).applyMatrix4(at)
      m.positions[i] = v.x; m.positions[i + 1] = v.y; m.positions[i + 2] = v.z
    }
  }
  const look = pointLookOf(model)
  return { positions: m.positions, colors: m.colors, radius: look.glowRadius, strength: look.glowStrength, pointSize: look.pointSize ?? 0.05 }
}

/** A placement's matrix, render frame (sno-core partMatrix). */
export function rawPartMatrix(parent: ShardModel, p: Placed): Matrix4 {
  return new Matrix4().fromArray(partMatrix(p.part, parent.unit, p.model?.unit ?? 0))
}

/** One spinning part of a drone (a rotor, a fan). */
export interface SpinPart {
  name: string
  /** The object's faces, shared by every placement of it. */
  geometry: BufferGeometry
  /** Where it stands on the drone. */
  matrix: Matrix4
  /** Turns a second about its own +Y. */
  revPerS: number
}

export interface DroneModel {
  id: string
  name: string
  /** The body's own faces. */
  body: BufferGeometry | null
  spin: SpinPart[]
  /** Eyes and charge lights, already at their places on the drone. */
  glows: Array<GlowPoints & { name: string }>
  muzzles: V3[]
  eye: V3
  /** Its size across, gibsons (the burst scales with it). */
  across: number
}

export interface WeaponModel {
  id: string
  name: string
  body: BufferGeometry | null
  muzzle: V3
  grip: V3
  flash: string
  view: { desktop: ViewPlace; phone: ViewPlace }
}

export interface EffectModel extends GlowPoints {
  id: string
  lifeS: number
  grow: number
}

export interface DroneRunModels {
  drones: Record<string, DroneModel>
  weapons: Record<string, WeaponModel>
  effects: Record<string, EffectModel>
  /** References fetched while loading: always 0 (the parts are all carried). */
  fetched: number
}

/** A payload read as a model, or a plain error naming it. */
function read(payload: unknown, id: string): ShardModel {
  const m = fromPayload(JSON.parse(JSON.stringify(payload)), `drone-run:${id}`)
  if (!m) throw new Error(`The ${id} model could not be read.`)
  return m
}

/** Every model, parts resolved from the payloads' own tables. Throws if a part would have to be fetched. */
export async function loadDroneRunModels(): Promise<DroneRunModels> {
  let fetched = 0
  // The fetch handed to sno-core: it never reaches a relay. Asked at all, a part was not carried.
  const refuse = async (): Promise<unknown> => { fetched++; throw new Error('A DRONE RUN model asked for a part it does not carry.') }
  const drones: Record<string, DroneModel> = {}
  const geometryOf = new Map<string, BufferGeometry | null>()
  for (const [id, payload] of Object.entries(DRONE_PAYLOADS)) {
    const rig = RIG.drones[id]
    const model = withAuthor(read(payload, id), RIG.author)
    const placed = await resolveParts(model, refuse, { author: RIG.author })
    const missing = placed.filter((p) => !p.model || p.missing)
    if (missing.length || fetched) throw new Error(`The ${id} model has parts that are not carried.`)
    const spin: SpinPart[] = []
    const glows: DroneModel['glows'] = []
    placed.forEach((p, i) => {
      const part = rig.parts[i]
      const obj = p.model!
      const matrix = rawPartMatrix(model, p)
      if (obj.mode === 'points') { glows.push({ name: part?.part ?? `part-${i}`, ...glowPoints(obj, matrix) }); return }
      const key = obj.id
      if (!geometryOf.has(key)) geometryOf.set(key, faceGeometry(rawMesh(obj)))
      const geometry = geometryOf.get(key)
      if (geometry) spin.push({ name: part?.part ?? `part-${i}`, geometry, matrix, revPerS: part?.spinRevPerS ?? 0 })
    })
    drones[id] = { id, name: rig.name, body: faceGeometry(rawMesh(model)), spin, glows, muzzles: rig.muzzles, eye: rig.eye, across: rig.across }
  }
  const weapons: Record<string, WeaponModel> = {}
  for (const [id, payload] of Object.entries(WEAPON_PAYLOADS)) {
    const rig = RIG.weapons[id]
    weapons[id] = { id, name: rig.name, body: faceGeometry(rawMesh(read(payload, id))), muzzle: rig.muzzle, grip: rig.grip, flash: rig.flash, view: rig.viewmodel }
  }
  const effects: Record<string, EffectModel> = {}
  for (const [id, payload] of Object.entries(EFFECT_PAYLOADS)) {
    const rig = RIG.effects[id]
    effects[id] = { id, lifeS: rig.lifeS, grow: rig.grow, ...glowPoints(read(payload, id)) }
  }
  return { drones, weapons, effects, fetched }
}

let loading: Promise<DroneRunModels> | null = null
/** The models, loaded once for the page. */
export function droneRunModels(): Promise<DroneRunModels> {
  loading ??= loadDroneRunModels().catch((e) => { loading = null; throw e })
  return loading
}

/** The viewmodel's place for a screen: the phone's on an upright screen, the desktop's otherwise. */
export function viewPlaceFor(w: Pick<WeaponModel, 'view'>, width: number, height: number): ViewPlace {
  return width < height ? w.view.phone : w.view.desktop
}
