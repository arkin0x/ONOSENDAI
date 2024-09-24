import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Shard3DData } from '../Build/Shards'

export function Shard({ shardData }: { shardData: Shard3DData}) {
  
  useEffect(() => {
    // console.log('shardData', shardData)
  }, [shardData])

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(shardData.vertices, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(shardData.colors, 3))
    geo.setIndex(shardData.indices)
    geo.computeVertexNormals()
    return geo
  }, [shardData])

  const position = useMemo(() => {
    const x = shardData.position.x
    const y = shardData.position.y
    const z = shardData.position.z
    return new THREE.Vector3(x, y, z)
  }, [shardData.position])

  if (shardData.display === "solid") {
    return (
      <mesh geometry={geometry} position={position}>
        <meshPhongMaterial vertexColors={true} side={THREE.DoubleSide} />
      </mesh>
    )
  } else if (shardData.display === "wireframe") {
    return (
      <lineSegments geometry={geometry} position={position}>
        <lineBasicMaterial vertexColors={true} />
      </lineSegments>
    )
  } else if (shardData.display === "points") {
    return (
      <points geometry={geometry} position={position}>
        <pointsMaterial vertexColors={true} size={0.1} />
      </points>
    )
  }

}

export default Shard