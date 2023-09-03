import React from "react"
import * as THREE from "three"

const OperatorMaterial = new THREE.MeshStandardMaterial({
  color: 0xff2323,
  metalness: 0.8,
  roughness: 0.4,
  emissive: 0xff2323,
  emissiveIntensity: 0.2,
})

const OperatorGeometry = new THREE.IcosahedronGeometry(.5,1)

// Create edges geometry for the golden wireframe
const OperatorGeometryEdges = new THREE.EdgesGeometry(OperatorGeometry)
const OperatorMaterialEdges = new THREE.LineBasicMaterial({ color: 0xff2323 })

// Add the wireframe to your scene

export const Operator: React.FC<{ position?: number[]}> = ({position = [0,0,0]}) => {
  return (
    <group position={new THREE.Vector3(...position)}>
      <lineSegments scale={[1,1,1]} geometry={OperatorGeometryEdges} material={OperatorMaterialEdges} />
      <mesh geometry={OperatorGeometry} material={OperatorMaterial} />
    </group>
  )
}
