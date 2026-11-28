/**
 * tvTerrainCamera.ts: how Cyberspace TV's camera takes a TERRAIN shot
 * (lib/tv/terrainShot.ts), for scene/TvLayer.tsx's TvCamera.
 *
 * For now a close orbit: a little faster than an ordinary shot's, at the
 * framing's angle down, so the blocks round the avatar turn in view.
 *
 * The seam for what the owner ruled (2026-11-28, A): an over-the-shoulder
 * camera 1 to 6 blocks behind the avatar as space allows, first person as a
 * variation on long runs, and an "ant farm" cutaway that fades the blocks
 * between the camera and the player out and back in as the camera turns. A
 * chase mode comes here as another TerrainCameraMode, given the avatar's
 * heading and the blocks round it; the cutaway is the TV terrain material's
 * own (scene/TvTerrain.tsx keeps a material apart from the viewer's field
 * for it).
 */

import type { Vector3 } from 'three'
import type { Framing } from '../lib/tv/director'
import type { TerrainCamera } from '../lib/tv/terrainShot'

/** A TERRAIN orbit's turn, radians a second: a circle in under a minute. */
export const TERRAIN_ORBIT_SPEED = 0.12

/** The camera's direction from the avatar for a TERRAIN shot at orbit angle `theta`, into `out` (unit). */
export function terrainCameraDirection(cam: TerrainCamera, f: Framing, theta: number, out: Vector3): Vector3 {
  switch (cam.mode) {
    case 'orbit':
    default:
      return out.set(Math.sin(f.polar) * Math.sin(theta), Math.cos(f.polar), Math.sin(f.polar) * Math.cos(theta)).normalize()
  }
}
