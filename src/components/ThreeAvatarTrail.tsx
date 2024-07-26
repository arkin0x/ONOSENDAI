import { useContext, useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Vector3, LineBasicMaterial, Quaternion, BufferAttribute } from 'three'
import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { DecimalVector3 } from '../libraries/DecimalVector3'
import { AvatarContext } from '../providers/AvatarContext'
import { extractActionState } from '../libraries/Cyberspace'

interface ThreeAvatarTrailProps {
  pubkey: string
  position: DecimalVector3
  rotation: Quaternion
}

const AvatarMaterialEdges = new LineBasicMaterial({ color: 0xff2323 })

export function ThreeAvatarTrail({ pubkey, position, rotation }: ThreeAvatarTrailProps) {
  const { actionState } = useContext(AvatarContext)
  const lineRef = useRef<THREE.Line>(null)
  const positionsRef = useRef<Float32Array | null>(null)

  const actions = actionState[pubkey]

  const trailPoints = useMemo(() => {
    if (!actions || actions.length < 1) return [position.toVector3()]

    return actions.map(action => extractActionState(action).sectorPosition.toVector3())
  }, [actions, position])

  useEffect(() => {
    if (trailPoints.length < 1) return

    const positions = new Float32Array(Math.max(trailPoints.length, 2) * 3)
    trailPoints.forEach((point, index) => {
      positions[index * 3] = point.x
      positions[index * 3 + 1] = point.y
      positions[index * 3 + 2] = point.z
    })

    // If there's only one point, duplicate it to create a valid line
    if (trailPoints.length === 1) {
      positions[3] = positions[0]
      positions[4] = positions[1]
      positions[5] = positions[2]
    }

    positionsRef.current = positions

    if (lineRef.current) {
      lineRef.current.geometry.setAttribute('position', new BufferAttribute(positions, 3))
      lineRef.current.geometry.attributes.position.needsUpdate = true
    }
  }, [trailPoints])

  useFrame(() => {
    if (lineRef.current && positionsRef.current) {
      const positions = positionsRef.current
      const currentPos = position.toVector3()

      // Update the last point to the current position
      positions[positions.length - 3] = currentPos.x
      positions[positions.length - 2] = currentPos.y
      positions[positions.length - 1] = currentPos.z

      lineRef.current.geometry.attributes.position.needsUpdate = true
    }
  })

  const tracerGeometry = useMemo(() => {
    const geometry = new BufferGeometry()
    const positions = new Float32Array([0, 0, 0, 0, 0, 10])
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    return geometry
  }, [])

  if (trailPoints.length < 1) {
    return null // Don't render anything if there are no trail points
  }

  return (
    <>
      <Line
        ref={lineRef}
        points={trailPoints}
        color={AvatarMaterialEdges.color}
        lineWidth={1}
      />
      <group position={position.toVector3()}>
        <line geometry={tracerGeometry} material={AvatarMaterialEdges}>
          <bufferAttribute
            attach="geometry.attributes.position"
            count={2}
            array={tracerGeometry.attributes.position.array}
            itemSize={3}
            onUpdate={self => {
              const positions = self.array as Float32Array
              const direction = new Vector3(0, 0, 10).applyQuaternion(rotation)
              positions[3] = direction.x
              positions[4] = direction.y
              positions[5] = direction.z
              self.needsUpdate = true
            }}
          />
        </line>
      </group>
    </>
  )
}