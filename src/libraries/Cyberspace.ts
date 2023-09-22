import * as THREE from "three"
import { Quaternion } from "@react-three/fiber"
import almostEqual from "almost-equal"
import { Action } from "../types/Cyberspace"

export const CYBERSPACE_SIZE = BigInt(2 ** 85)
export const UNIVERSE_DOWNSCALE = BigInt(2 ** 35)
export const UNIVERSE_SIZE = Number(CYBERSPACE_SIZE / UNIVERSE_DOWNSCALE)
export const UNIVERSE_SIZE_HALF = UNIVERSE_SIZE / 2

export const CENTERCOORD = "1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE"

export const FRAME = 1000 / 60
export const DRAG = 0.999
export const IDENTITY_QUATERNION: Quaternion = [0, 0, 0, 1]

export const vector3Equal = (a: THREE.Vector3, b: THREE.Vector3): boolean => {
  return almostEqual(a.x, b.x) && almostEqual(a.y, b.y) && almostEqual(a.z, b.z)
}

export const getPlaneFromAction = (action: Action): 'c-space' | 'd-space' => {
  // 0 = d-space (reality, first)
  // 1 = c-space (cyberreality, second)
  return parseInt(action.tags.find((tag: string[]) => tag[0] === 'C')![1].substring(63), 16) & 1 ? 'c-space' : 'd-space'
}