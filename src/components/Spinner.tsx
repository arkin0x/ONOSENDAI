import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { LineBasicMaterial, LineLoop, Mesh, RingGeometry, Vector3 } from 'three'
import { Text } from '@react-three/drei'
import COLORS from '../data/Colors'

interface SpinnerProps {
  position: [number, number, number] | Vector3
  scale?: [number, number, number] | Vector3
}

export function Spinner({position, scale}: SpinnerProps) {
  const ref = useRef<LineLoop>(null)

  useFrame(() => {
    if (ref.current) {
      ref.current.rotation.z += 0.15
    }
  })

  const ringGeometry = new RingGeometry(1, 3, 3)
  const lineMaterial = new LineBasicMaterial({ color: COLORS.ORANGE })

  return (
    <group position={position} scale={scale}>
      <lineLoop ref={ref} geometry={ringGeometry} material={lineMaterial}/>
      <Text position={[0, -4, 0.07]} color={COLORS.ORANGE} fontSize={.8} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
        MINING
      </Text>
    </group>
  )
}