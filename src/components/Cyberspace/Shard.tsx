import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { ThreeEvent } from '@react-three/fiber'
import { Shard3DData } from '../Build/Shards'
import { Face } from '../../store/BuilderStore'

interface ShardProps {
  shardData: Shard3DData
  onFaceRightClick: (event: ThreeEvent<MouseEvent>, faceId: string) => void
  selectedTool: 'vertex' | 'face' | 'color' | 'move'
  faces: Face[]
}

export function Shard({ shardData, onFaceRightClick, selectedTool, faces }: ShardProps) {
  
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

  const handleHover = (event: ThreeEvent<MouseEvent>) => {
    console.log('faceIndex', event.faceIndex)
  }

  const handleRightClick = (event: ThreeEvent<MouseEvent>) => {
    if (selectedTool === 'face') {
      event.stopPropagation()
      const face = faces[event.faceIndex!]
      if (face) {
        onFaceRightClick(event, face.id)
      }
    }
  }

  if (shardData.display === "solid") {
    return (
      <mesh 
        geometry={geometry} 
        position={position}
        onContextMenu={handleRightClick}
        onPointerOver={handleHover}
      >
        <meshPhongMaterial vertexColors={true} side={THREE.DoubleSide} />
      </mesh>
    )
  } else if (shardData.display === "wireframe") {
    return (
      <lineSegments 
        geometry={geometry} 
        position={position}
        onContextMenu={handleRightClick}
        onPointerOver={handleHover}
      >
        <lineBasicMaterial vertexColors={true} />
      </lineSegments>
    )
  } else if (shardData.display === "points") {
    return (
      <points 
        geometry={geometry} 
        position={position}
        onContextMenu={handleRightClick}
        onPointerOver={handleHover}
      >
        <pointsMaterial vertexColors={true} size={0.1} />
      </points>
    )
  }

  return null
}

export default Shard