import React from "react"
import * as THREE from "three"

const AvatarMaterial = new THREE.MeshStandardMaterial({
  color: 0xff2323,
  metalness: 0.8,
  roughness: 0.4,
  emissive: 0xff2323,
  emissiveIntensity: 0.2,
})

const AvatarGeometry = new THREE.IcosahedronGeometry(.5,1)

// Create edges geometry for the golden wireframe
const AvatarGeometryEdges = new THREE.EdgesGeometry(AvatarGeometry)
const AvatarMaterialEdges = new THREE.LineBasicMaterial({ color: 0xff2323 })

// Add the wireframe to your scene

export const ThreeAvatar: React.FC<{ position?: number[]}> = ({position = [0,0,0]}) => {
  return (
    <group position={new THREE.Vector3(...position)}>
      <lineSegments scale={[1,1,1]} geometry={AvatarGeometryEdges} material={AvatarMaterialEdges} />
      <mesh geometry={AvatarGeometry} material={AvatarMaterial} />
    </group>
  )
}
