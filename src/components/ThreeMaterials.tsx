import * as THREE from "three"
import COLORS from "../data/Colors"

// const TealLineMaterial = new THREE.LineBasicMaterial({
//   color: LOGO_TEAL,
// })
export const PurpleLineMaterial = new THREE.LineBasicMaterial({
  color: COLORS.LOGO_PURPLE,

})

export const TealLineMaterial = new THREE.LineBasicMaterial({
  color: COLORS.LOGO_TEAL,

})

export const BlueLineMaterial = new THREE.LineBasicMaterial({
  color: COLORS.LOGO_BLUE,
})

export const SunMaterial = new THREE.MeshBasicMaterial({
 color: COLORS.BLACK_SUN,
 side: THREE.DoubleSide,
})