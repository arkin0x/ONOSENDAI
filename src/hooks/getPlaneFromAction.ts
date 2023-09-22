import * as THREE from "three";
import almostEqual from "almost-equal";
import { Action } from "./useCyberspaceStateReconciler";

export const vector3Equal = (a: THREE.Vector3, b: THREE.Vector3): boolean => {
  return almostEqual(a.x, b.x) && almostEqual(a.y, b.y) && almostEqual(a.z, b.z);
};
export const getPlaneFromAction = (action: Action): 'c-space' | 'd-space' => {
  return parseInt(action.tags.find(tag => tag[0] === 'C')![1].substring(63), 16) & 1 ? 'd-space' : 'c-space';
};
