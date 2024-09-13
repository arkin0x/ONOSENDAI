import { useState } from 'react'
import { Text } from '@react-three/drei'
import COLORS from '../data/Colors'
import useNDKStore from '../store/NDKStore'

export const SignUpButton = () => {
  const { initLocalKeyUser } = useNDKStore()
  const [color, setColor] = useState(COLORS.ORANGE)

  return (
    <group onClick={initLocalKeyUser}>
      <mesh
        position={[0.3, 0, 0]}
        onPointerOver={() => setColor(COLORS.GREEN)}
        onPointerOut={() => setColor(COLORS.ORANGE)}
      >
        <boxGeometry args={[0.5, 0.2, 0.1]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Text position={[0.3, 0, 0.07]} color={COLORS.BLACK} fontSize={0.09} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
        NEW ID
      </Text>
    </group>
  )
}