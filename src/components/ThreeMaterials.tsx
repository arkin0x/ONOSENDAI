import * as THREE from "three"

export const LOGO_TEAL = 0x06a4a4
export const LOGO_PURPLE = 0x78004e
export const LOGO_BLUE = 0x0062cd

// const TealLineMaterial = new THREE.LineBasicMaterial({
//   color: LOGO_TEAL,
// })
export const PurpleLineMaterial = new THREE.LineBasicMaterial({
  color: LOGO_PURPLE,

})

export const TealLineMaterial = new THREE.LineBasicMaterial({
  color: LOGO_TEAL,

})

export const BlueLineMaterial = new THREE.LineBasicMaterial({
  color: LOGO_BLUE,
})

export const SunMaterial = new THREE.MeshBasicMaterial({
 color: 0x2b0c40,
 side: THREE.DoubleSide,
})